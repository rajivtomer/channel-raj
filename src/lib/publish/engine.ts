import "server-only";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PostStatus, TargetStatus } from "@/db/schema";
import { getChannelAuth } from "../channels";
import { getMediaByIds } from "../media";
import { applyChannelDefaults } from "../rules";
import { publishFacebook } from "./facebook";
import { checkInstagram, startInstagram } from "./instagram";
import type { PublishInput, PublishOutcome } from "./types";
import { publishYouTube } from "./youtube";

/** How long a target may sit in "processing" without a container before we assume the run died. */
const LEASE_MS = 15 * 60 * 1000;

interface RunOptions {
  userId?: string;
  postId?: string;
  limit?: number;
}

export interface RunSummary {
  posts: number;
  published: number;
  failed: number;
  processing: number;
}

/**
 * Publishes everything that is due: scheduled posts whose time has come, and Instagram
 * containers that were still processing. Safe to call concurrently; rows are claimed
 * with conditional updates so each target is attempted once.
 */
export async function runPublisher(opts: RunOptions = {}): Promise<RunSummary> {
  const db = await getDb();
  const now = new Date();
  const summary: RunSummary = { posts: 0, published: 0, failed: 0, processing: 0 };

  const due = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.status, "scheduled"),
        lte(schema.posts.scheduledAt, now),
        opts.userId ? eq(schema.posts.userId, opts.userId) : undefined,
        opts.postId ? eq(schema.posts.id, opts.postId) : undefined,
      ),
    )
    .orderBy(asc(schema.posts.scheduledAt))
    .limit(opts.limit ?? 20);

  for (const { id } of due) {
    const [claimed] = await db
      .update(schema.posts)
      .set({ status: "publishing", updatedAt: new Date() })
      .where(and(eq(schema.posts.id, id), eq(schema.posts.status, "scheduled")))
      .returning();
    if (!claimed) continue;
    summary.posts++;
    const targets = await db
      .select()
      .from(schema.postTargets)
      .where(and(eq(schema.postTargets.postId, id), eq(schema.postTargets.status, "pending")));
    for (const t of targets) tally(summary, await runTarget(t.id, "start"));
    await refreshPostStatus(id);
  }

  // Follow up on targets that were waiting on the platform (or whose run was interrupted).
  const waiting = await db
    .select({ id: schema.postTargets.id, postId: schema.postTargets.postId })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(
      and(
        eq(schema.postTargets.status, "processing"),
        or(isNull(schema.postTargets.nextCheckAt), lte(schema.postTargets.nextCheckAt, now)),
        opts.userId ? eq(schema.posts.userId, opts.userId) : undefined,
        opts.postId ? eq(schema.posts.id, opts.postId) : undefined,
      ),
    )
    .limit(opts.limit ?? 20);
  for (const t of waiting) {
    tally(summary, await runTarget(t.id, "check"));
    await refreshPostStatus(t.postId);
  }
  return summary;
}

function tally(s: RunSummary, status: TargetStatus | null) {
  if (status === "published") s.published++;
  else if (status === "failed") s.failed++;
  else if (status === "processing") s.processing++;
}

/** Runs one target. Returns its new status, or null if another worker had it. */
export async function runTarget(targetId: string, mode: "start" | "check"): Promise<TargetStatus | null> {
  const db = await getDb();
  const lease = new Date(Date.now() + LEASE_MS);
  // Claim: move to processing with a lease, so a crash can't cause a double post.
  const [t] = await db
    .update(schema.postTargets)
    .set({ status: "processing", nextCheckAt: lease, attempts: sql`${schema.postTargets.attempts} + 1` })
    .where(
      and(
        eq(schema.postTargets.id, targetId),
        mode === "start"
          ? eq(schema.postTargets.status, "pending")
          : and(eq(schema.postTargets.status, "processing"), or(isNull(schema.postTargets.nextCheckAt), lte(schema.postTargets.nextCheckAt, new Date()))),
      ),
    )
    .returning();
  if (!t) return null;

  if (mode === "check" && !t.containerId) {
    // A previous run was interrupted mid-publish. Don't retry blindly; it may have gone out.
    return finish(t.id, { state: "failed", error: "Publishing was interrupted. Check the channel before retrying so you don't post twice." });
  }

  try {
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, t.postId)).limit(1);
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, t.channelId)).limit(1);
    if (!post || !channel) return finish(t.id, { state: "failed", error: "The channel was disconnected." });

    const { accessToken, creds } = await getChannelAuth(channel);
    const options = { ...t.options };
    options.firstComment ??= channel.settings.firstComment;
    const mediaIds = [...post.mediaIds];
    const thumbId = options.youtube?.thumbnailAssetId;
    const allMedia = await getMediaByIds(post.userId, thumbId ? [...mediaIds, thumbId] : mediaIds);
    const media = allMedia.filter((m) => mediaIds.includes(m.id));
    if (media.length !== mediaIds.length) return finish(t.id, { state: "failed", error: "Some media was deleted from the library." });

    const input: PublishInput = {
      channel,
      accessToken,
      appSecret: creds.clientSecret,
      caption: applyChannelDefaults(t.caption ?? post.caption, channel.settings),
      media: channel.platform === "youtube" ? allMedia : media,
      options,
    };
    let outcome: PublishOutcome;
    if (channel.platform === "youtube") outcome = await publishYouTube(input);
    else if (channel.platform === "facebook") outcome = await publishFacebook(input);
    else outcome = mode === "check" ? await checkInstagram(input, t.containerId!) : await startInstagram(input);
    return finish(t.id, outcome);
  } catch (err) {
    return finish(t.id, { state: "failed", error: (err as Error).message || String(err) });
  }
}

async function finish(targetId: string, o: PublishOutcome): Promise<TargetStatus> {
  const db = await getDb();
  if (o.state === "published") {
    await db
      .update(schema.postTargets)
      .set({
        status: "published",
        externalId: o.externalId,
        externalUrl: o.externalUrl ?? null,
        error: o.warnings?.length ? o.warnings.join(" ") : null,
        publishedAt: new Date(),
        nextCheckAt: null,
      })
      .where(eq(schema.postTargets.id, targetId));
    return "published";
  }
  if (o.state === "processing") {
    await db
      .update(schema.postTargets)
      .set({ status: "processing", containerId: o.containerId, nextCheckAt: new Date(Date.now() + o.retryInSec * 1000) })
      .where(eq(schema.postTargets.id, targetId));
    return "processing";
  }
  await db
    .update(schema.postTargets)
    .set({ status: "failed", error: o.error.slice(0, 1000), nextCheckAt: null })
    .where(eq(schema.postTargets.id, targetId));
  return "failed";
}

export async function refreshPostStatus(postId: string): Promise<PostStatus> {
  const db = await getDb();
  const targets = await db
    .select({ status: schema.postTargets.status })
    .from(schema.postTargets)
    .where(eq(schema.postTargets.postId, postId));
  const n = (s: TargetStatus) => targets.filter((t) => t.status === s).length;
  let status: PostStatus;
  if (n("pending") || n("processing")) status = "publishing";
  else if (n("published") === targets.length) status = "published";
  else if (n("published")) status = "partial";
  else status = "failed";
  await db
    .update(schema.posts)
    .set({ status, updatedAt: new Date(), ...(status === "published" || status === "partial" ? { publishedAt: new Date() } : {}) })
    .where(and(eq(schema.posts.id, postId), inArray(schema.posts.status, ["publishing", "scheduled", "failed", "partial"])));
  return status;
}

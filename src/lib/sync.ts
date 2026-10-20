import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Channel } from "@/db/schema";
import { runCommentAutomations } from "./automations";
import { checkChannel, getChannelAuth } from "./channels";
import { fetchComments, fetchMetrics, type EngageCtx } from "./engage";
import { utcDay } from "./metrics-math";

const INBOX_EVERY_MS = 10 * 60_000;
const METRICS_EVERY_MS = 60 * 60_000;
/** Metrics are refreshed for posts published in this window. */
const METRICS_WINDOW_MS = 60 * 86400_000;

export async function engageCtx(channel: Channel): Promise<EngageCtx> {
  const { accessToken, creds } = await getChannelAuth(channel);
  return { channel, accessToken, appSecret: creds.clientSecret };
}

/** Pulls new comments into the inbox. Returns the ids of comments seen for the first time. */
export async function syncInbox(channel: Channel): Promise<string[]> {
  const db = await getDb();
  const ctx = await engageCtx(channel);
  const comments = (await fetchComments(ctx)).filter((c) => !c.own && c.text.trim());
  if (!comments.length) return [];
  const existing = await db
    .select({ externalId: schema.inboxItems.externalId })
    .from(schema.inboxItems)
    .where(and(eq(schema.inboxItems.channelId, channel.id), inArray(schema.inboxItems.externalId, comments.map((c) => c.externalId))));
  const known = new Set(existing.map((e) => e.externalId));
  const fresh: string[] = [];
  for (const c of comments) {
    const values = {
      objectTitle: c.objectTitle,
      objectUrl: c.objectUrl,
      authorName: c.authorName.slice(0, 200),
      authorAvatar: c.authorAvatar,
      text: c.text.slice(0, 10_000),
      likeCount: c.likeCount,
    };
    if (known.has(c.externalId)) {
      await db
        .update(schema.inboxItems)
        .set(values)
        .where(and(eq(schema.inboxItems.channelId, channel.id), eq(schema.inboxItems.externalId, c.externalId)));
      continue;
    }
    const [row] = await db
      .insert(schema.inboxItems)
      .values({ userId: channel.userId, channelId: channel.id, externalId: c.externalId, objectId: c.objectId, postedAt: c.postedAt, ...values })
      .onConflictDoNothing()
      .returning({ id: schema.inboxItems.id });
    if (row) fresh.push(row.id);
  }
  return fresh;
}

/** Refreshes follower count (one snapshot per day) and engagement on recent posts. */
export async function syncMetrics(channel: Channel): Promise<void> {
  const db = await getDb();
  const check = await checkChannel(channel.userId, channel.id);
  if (!check.ok) throw new Error(check.message);
  const [fresh] = await db.select({ followers: schema.channels.followers }).from(schema.channels).where(eq(schema.channels.id, channel.id));
  if (fresh?.followers !== null && fresh?.followers !== undefined) {
    await db
      .insert(schema.channelStats)
      .values({ channelId: channel.id, day: utcDay(new Date()), followers: fresh.followers })
      .onConflictDoUpdate({ target: [schema.channelStats.channelId, schema.channelStats.day], set: { followers: fresh.followers } });
  }

  const targets = await db
    .select({ id: schema.postTargets.id, externalId: schema.postTargets.externalId })
    .from(schema.postTargets)
    .where(
      and(
        eq(schema.postTargets.channelId, channel.id),
        eq(schema.postTargets.status, "published"),
        isNotNull(schema.postTargets.externalId),
        gte(schema.postTargets.publishedAt, new Date(Date.now() - METRICS_WINDOW_MS)),
      ),
    )
    .orderBy(desc(schema.postTargets.publishedAt))
    .limit(100);
  if (!targets.length) return;
  const ctx = await engageCtx((await db.select().from(schema.channels).where(eq(schema.channels.id, channel.id)))[0]!);
  const metrics = await fetchMetrics(ctx, targets.map((t) => t.externalId!));
  const now = new Date();
  for (const t of targets) {
    const m = metrics[t.externalId!];
    if (m) await db.update(schema.postTargets).set({ metrics: m, metricsAt: now }).where(eq(schema.postTargets.id, t.id));
  }
}

export interface SyncSummary {
  channels: number;
  newComments: number;
  errors: number;
}

/**
 * Syncs channels that are due: inbox every 10 minutes, metrics every hour. Safe to run
 * concurrently; each channel is claimed by bumping its sync time first.
 */
export async function runSync(opts: { userId?: string; limit?: number; force?: boolean; deadline?: number } = {}): Promise<SyncSummary> {
  const db = await getDb();
  const now = Date.now();
  const summary: SyncSummary = { channels: 0, newComments: 0, errors: 0 };
  const inboxDue = opts.force ? new Date(now + 1000) : new Date(now - INBOX_EVERY_MS);
  const due = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.status, "connected"),
        opts.userId ? eq(schema.channels.userId, opts.userId) : undefined,
        or(isNull(schema.channels.inboxSyncedAt), lt(schema.channels.inboxSyncedAt, inboxDue)),
      ),
    )
    .orderBy(sql`${schema.channels.inboxSyncedAt} asc nulls first`, asc(schema.channels.id))
    .limit(opts.limit ?? 25);

  const freshByUser = new Map<string, string[]>();
  for (const ch of due) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const [claimed] = await db
      .update(schema.channels)
      .set({ inboxSyncedAt: new Date() })
      .where(
        and(
          eq(schema.channels.id, ch.id),
          ch.inboxSyncedAt ? eq(schema.channels.inboxSyncedAt, ch.inboxSyncedAt) : isNull(schema.channels.inboxSyncedAt),
        ),
      )
      .returning({ id: schema.channels.id });
    if (!claimed) continue;
    summary.channels++;
    const errors: string[] = [];
    try {
      const fresh = await syncInbox(ch);
      summary.newComments += fresh.length;
      if (fresh.length) freshByUser.set(ch.userId, [...(freshByUser.get(ch.userId) ?? []), ...fresh]);
    } catch (err) {
      errors.push(`Comments: ${(err as Error).message}`);
    }
    if (opts.force || !ch.metricsSyncedAt || ch.metricsSyncedAt.getTime() < now - METRICS_EVERY_MS) {
      try {
        await syncMetrics(ch);
      } catch (err) {
        errors.push(`Stats: ${(err as Error).message}`);
      }
      await db.update(schema.channels).set({ metricsSyncedAt: new Date() }).where(eq(schema.channels.id, ch.id));
    }
    if (errors.length) summary.errors++;
    await db
      .update(schema.channels)
      .set({ syncError: errors.length ? errors.join(" ").slice(0, 1000) : null })
      .where(eq(schema.channels.id, ch.id));
  }

  for (const [userId, ids] of freshByUser) {
    await runCommentAutomations(userId, ids).catch(() => undefined);
  }
  return summary;
}

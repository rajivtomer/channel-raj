"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getMediaByIds } from "@/lib/media";
import { getPost } from "@/lib/posts";
import { refreshPostStatus, runPublisher, runTarget } from "@/lib/publish/engine";
import { validateTarget } from "@/lib/rules";

const optionsSchema = z.object({
  youtube: z
    .object({
      title: z.string().max(200).optional(),
      tags: z.string().max(1000).optional(),
      privacy: z.enum(["public", "unlisted", "private"]).optional(),
      categoryId: z.string().max(4).optional(),
      madeForKids: z.boolean().optional(),
      playlistId: z.string().max(100).optional(),
      thumbnailAssetId: z.string().uuid().optional(),
      notifySubscribers: z.boolean().optional(),
    })
    .optional(),
  instagram: z.object({ format: z.enum(["feed", "reel", "story"]).optional(), shareToFeed: z.boolean().optional() }).optional(),
  facebook: z.object({ link: z.string().url().max(2000).optional().or(z.literal("").transform(() => undefined)) }).optional(),
  firstComment: z.string().max(2200).optional(),
});

const postSchema = z.object({
  id: z.string().uuid().optional(),
  caption: z.string().max(63206),
  mediaIds: z.array(z.string().uuid()).max(10),
  targets: z
    .array(z.object({ channelId: z.string().uuid(), caption: z.string().max(63206).nullable(), options: optionsSchema }))
    .max(50),
  mode: z.enum(["draft", "schedule", "now"]),
  scheduledAt: z.string().datetime().optional(),
});

export type SavePostInput = z.input<typeof postSchema>;
export type SavePostResult =
  | { ok: true; postId: string; message: string }
  | { ok: false; message: string; targetErrors?: Record<string, string[]> };

export async function savePostAction(input: SavePostInput): Promise<SavePostResult> {
  const user = await requireUser();
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid post." };
  const p = parsed.data;
  const db = await getDb();

  if (p.mode !== "draft" && !p.targets.length) return { ok: false, message: "Pick at least one channel." };
  const scheduledAt = p.mode === "schedule" ? (p.scheduledAt ? new Date(p.scheduledAt) : null) : p.mode === "now" ? new Date() : null;
  if (p.mode === "schedule") {
    if (!scheduledAt) return { ok: false, message: "Pick a date and time." };
    if (scheduledAt.getTime() < Date.now() - 60_000) return { ok: false, message: "That time is in the past." };
  }

  const channels = p.targets.length
    ? await db
        .select()
        .from(schema.channels)
        .where(and(eq(schema.channels.userId, user.id), inArray(schema.channels.id, p.targets.map((t) => t.channelId))))
    : [];
  if (channels.length !== p.targets.length) return { ok: false, message: "One of the channels is no longer connected." };

  const thumbIds = p.targets.map((t) => t.options.youtube?.thumbnailAssetId).filter((x): x is string => Boolean(x));
  const media = await getMediaByIds(user.id, p.mediaIds);
  if (media.length !== p.mediaIds.length) return { ok: false, message: "Some media is missing from your library." };
  if ((await getMediaByIds(user.id, thumbIds)).some((m) => m.kind !== "image")) return { ok: false, message: "Thumbnails must be images." };

  if (p.mode !== "draft") {
    const targetErrors: Record<string, string[]> = {};
    for (const t of p.targets) {
      const ch = channels.find((c) => c.id === t.channelId)!;
      const errs = validateTarget(ch.platform, t.caption ?? p.caption, media, t.options);
      if (errs.length) targetErrors[t.channelId] = errs;
    }
    if (Object.keys(targetErrors).length) return { ok: false, message: "Fix the issues marked on each channel.", targetErrors };
  }

  let postId = p.id;
  if (postId) {
    const existing = await getPost(user.id, postId);
    if (!existing) return { ok: false, message: "Post not found." };
    if (!["draft", "scheduled", "failed"].includes(existing.status)) {
      return { ok: false, message: "This post has already gone out and can't be edited. Duplicate it instead." };
    }
    await db
      .update(schema.posts)
      .set({ caption: p.caption, mediaIds: p.mediaIds, status: p.mode === "draft" ? "draft" : "scheduled", scheduledAt, updatedAt: new Date() })
      .where(eq(schema.posts.id, postId));
    await db
      .delete(schema.postTargets)
      .where(
        and(
          eq(schema.postTargets.postId, postId),
          p.targets.length ? notInArray(schema.postTargets.channelId, p.targets.map((t) => t.channelId)) : undefined,
        ),
      );
  } else {
    const [row] = await db
      .insert(schema.posts)
      .values({ userId: user.id, caption: p.caption, mediaIds: p.mediaIds, status: p.mode === "draft" ? "draft" : "scheduled", scheduledAt })
      .returning({ id: schema.posts.id });
    postId = row!.id;
  }

  for (const t of p.targets) {
    const values = {
      caption: t.caption,
      options: t.options,
      status: "pending" as const,
      error: null,
      containerId: null,
      nextCheckAt: null,
      externalId: null,
      externalUrl: null,
      publishedAt: null,
    };
    await db
      .insert(schema.postTargets)
      .values({ postId, channelId: t.channelId, ...values })
      .onConflictDoUpdate({ target: [schema.postTargets.postId, schema.postTargets.channelId], set: values });
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  if (p.mode === "now") {
    const s = await runPublisher({ postId, userId: user.id });
    const message =
      s.failed && !s.published
        ? "Publishing failed. See the details below."
        : s.failed
          ? `Published to ${s.published}, ${s.failed} failed. See the details below.`
          : s.processing
            ? `Published to ${s.published}. Instagram is still processing and will post shortly.`
            : `Published to ${s.published} ${s.published === 1 ? "channel" : "channels"}.`;
    return { ok: !(s.failed && !s.published), postId, message } as SavePostResult;
  }
  return {
    ok: true,
    postId,
    message: p.mode === "draft" ? "Draft saved." : "Scheduled.",
  };
}

export async function retryTargetAction(targetId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const id = z.string().uuid().parse(targetId);
  const db = await getDb();
  const [row] = await db
    .select({ target: schema.postTargets, post: schema.posts })
    .from(schema.postTargets)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
    .where(and(eq(schema.postTargets.id, id), eq(schema.posts.userId, user.id)))
    .limit(1);
  if (!row || row.target.status !== "failed") return { ok: false, message: "Only failed posts can be retried." };
  await db
    .update(schema.postTargets)
    .set({ status: "pending", error: null, containerId: null, nextCheckAt: null })
    .where(eq(schema.postTargets.id, id));
  const status = await runTarget(id, "start");
  await refreshPostStatus(row.post.id);
  revalidatePath("/calendar");
  revalidatePath(`/compose`);
  return status === "failed" ? { ok: false, message: "It failed again. See the error below." } : { ok: true, message: "Done." };
}

export async function deletePostAction(postId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const db = await getDb();
  await db.delete(schema.posts).where(and(eq(schema.posts.id, z.string().uuid().parse(postId)), eq(schema.posts.userId, user.id)));
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  return { ok: true, message: "Post deleted." };
}

export async function duplicatePostAction(postId: string): Promise<{ ok: boolean; postId?: string; message: string }> {
  const user = await requireUser();
  const post = await getPost(user.id, z.string().uuid().parse(postId));
  if (!post) return { ok: false, message: "Post not found." };
  const db = await getDb();
  const [row] = await db
    .insert(schema.posts)
    .values({ userId: user.id, caption: post.caption, mediaIds: post.mediaIds, status: "draft" })
    .returning({ id: schema.posts.id });
  for (const t of post.targets) {
    await db.insert(schema.postTargets).values({ postId: row!.id, channelId: t.channelId, caption: t.caption, options: t.options });
  }
  revalidatePath("/calendar");
  return { ok: true, postId: row!.id, message: "Copied to a new draft." };
}

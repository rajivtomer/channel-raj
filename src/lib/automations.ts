import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Automation, Channel, InboxItem } from "@/db/schema";
import { refreshCaption, suggestReply } from "./ai";
import { getChannelAuth } from "./channels";
import { hideComment, replyToComment } from "./engage";
import { getMediaByIds } from "./media";
import { engagementOf } from "./metrics-math";
import { validateTarget } from "./rules";
import { bestTimes, nextQueueSlot, safeZone } from "./schedule";

/** Comments older than this when first seen are left alone, so a rule never answers stale threads. */
const MAX_COMMENT_AGE_MS = 48 * 3600_000;
/** Cap per rule per run, so a flood of comments can't trigger a flood of replies. */
const MAX_ACTIONS_PER_RUN = 25;

const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|io|ly|co|xyz|top|ru)\b/i;

export function matchesKeywords(text: string, keywords: string[] | undefined) {
  const words = (keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return null;
  const t = text.toLowerCase();
  return words.find((w) => t.includes(w)) ?? null;
}

async function log(a: Automation, ok: boolean, detail: string) {
  const db = await getDb();
  await db.insert(schema.automationLog).values({ automationId: a.id, userId: a.userId, ok, detail: detail.slice(0, 1000) });
  await db
    .update(schema.automations)
    .set({ runCount: sql`${schema.automations.runCount} + 1`, lastRunAt: new Date() })
    .where(eq(schema.automations.id, a.id));
}

const appliesTo = (a: Automation, channelId: string) => !a.config.channelIds?.length || a.config.channelIds.includes(channelId);

/**
 * Runs auto-hide, then auto-reply rules over newly arrived comments. Each comment is
 * claimed (handledBy) before acting so concurrent runs never act twice.
 */
export async function runCommentAutomations(userId: string, itemIds: string[]) {
  if (!itemIds.length) return;
  const db = await getDb();
  const rules = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.userId, userId), eq(schema.automations.enabled, true), inArray(schema.automations.kind, ["auto_hide", "auto_reply"])));
  if (!rules.length) return;
  const items = await db
    .select({ item: schema.inboxItems, channel: schema.channels })
    .from(schema.inboxItems)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.inboxItems.channelId))
    .where(and(inArray(schema.inboxItems.id, itemIds), eq(schema.inboxItems.status, "open"), isNull(schema.inboxItems.handledBy)));

  const ordered = [...rules.filter((r) => r.kind === "auto_hide"), ...rules.filter((r) => r.kind === "auto_reply")];
  const used = new Map<string, number>();
  for (const { item, channel } of items) {
    if (Date.now() - item.postedAt.getTime() > MAX_COMMENT_AGE_MS) continue;
    for (const rule of ordered) {
      if (!appliesTo(rule, channel.id) || item.firstSeenAt < rule.activeSince) continue;
      if ((used.get(rule.id) ?? 0) >= MAX_ACTIONS_PER_RUN) continue;
      const hit =
        rule.kind === "auto_hide"
          ? matchesKeywords(item.text, rule.config.keywords) ?? (rule.config.hideLinks && URL_RE.test(item.text) ? "a link" : null)
          : rule.config.keywords?.length
            ? matchesKeywords(item.text, rule.config.keywords)
            : "any comment";
      if (!hit) continue;
      const [claimed] = await db
        .update(schema.inboxItems)
        .set({ handledBy: rule.id })
        .where(and(eq(schema.inboxItems.id, item.id), isNull(schema.inboxItems.handledBy)))
        .returning({ id: schema.inboxItems.id });
      if (!claimed) break;
      used.set(rule.id, (used.get(rule.id) ?? 0) + 1);
      await (rule.kind === "auto_hide" ? applyHide(rule, item, channel, hit) : applyReply(rule, item, channel, hit));
      break;
    }
  }
}

async function applyHide(rule: Automation, item: InboxItem, channel: Channel, hit: string) {
  const db = await getDb();
  try {
    const { accessToken, creds } = await getChannelAuth(channel);
    await hideComment({ channel, accessToken, appSecret: creds.clientSecret }, item.externalId);
    await db.update(schema.inboxItems).set({ status: "hidden" }).where(eq(schema.inboxItems.id, item.id));
    await log(rule, true, `Hid ${item.authorName}'s comment on ${channel.name} (matched ${hit}).`);
  } catch (err) {
    // Release the claim so a person can deal with it from the inbox.
    await db.update(schema.inboxItems).set({ handledBy: null }).where(eq(schema.inboxItems.id, item.id));
    await log(rule, false, `Couldn't hide ${item.authorName}'s comment on ${channel.name}: ${(err as Error).message}`);
  }
}

async function applyReply(rule: Automation, item: InboxItem, channel: Channel, hit: string) {
  const db = await getDb();
  try {
    const text = rule.config.useAi
      ? await suggestReply(rule.userId, {
          platform: channel.platform,
          channelName: channel.name,
          postTitle: item.objectTitle,
          author: item.authorName,
          comment: item.text,
          guidance: rule.config.replyText,
        })
      : (rule.config.replyText ?? "").replaceAll("{name}", item.authorName.replace(/^@/, "")).trim();
    if (!text) {
      await log(rule, true, `Skipped ${item.authorName}'s comment on ${channel.name}: no reply was appropriate.`);
      return;
    }
    const { accessToken, creds } = await getChannelAuth(channel);
    await replyToComment({ channel, accessToken, appSecret: creds.clientSecret }, item.externalId, text);
    await db.update(schema.inboxItems).set({ status: "done", replyText: text, repliedAt: new Date() }).where(eq(schema.inboxItems.id, item.id));
    await log(rule, true, `Replied to ${item.authorName} on ${channel.name} (matched ${hit}): “${text.slice(0, 120)}”`);
  } catch (err) {
    await db.update(schema.inboxItems).set({ handledBy: null }).where(eq(schema.inboxItems.id, item.id));
    await log(rule, false, `Couldn't reply to ${item.authorName} on ${channel.name}: ${(err as Error).message}`);
  }
}

// ---------------- Recycling ----------------

/** Runs every recycle rule whose interval has passed. */
export async function runRecycleDue(opts: { userId?: string; limit?: number } = {}) {
  const db = await getDb();
  const rules = await db
    .select()
    .from(schema.automations)
    .where(
      and(
        eq(schema.automations.kind, "recycle"),
        eq(schema.automations.enabled, true),
        opts.userId ? eq(schema.automations.userId, opts.userId) : undefined,
      ),
    )
    .limit(200);
  let ran = 0;
  for (const rule of rules) {
    const every = Math.max(1, rule.config.everyDays ?? 7) * 86400_000;
    const last = rule.lastRunAt?.getTime() ?? rule.activeSince.getTime() - every;
    if (Date.now() - last < every) continue;
    // Claim by stamping lastRunAt; a concurrent run sees the new value and skips.
    const [claimed] = await db
      .update(schema.automations)
      .set({ lastRunAt: new Date() })
      .where(
        and(
          eq(schema.automations.id, rule.id),
          rule.lastRunAt ? eq(schema.automations.lastRunAt, rule.lastRunAt) : isNull(schema.automations.lastRunAt),
        ),
      )
      .returning({ id: schema.automations.id });
    if (!claimed) continue;
    const r = await recycleOnce(rule);
    // Nothing eligible yet: look again tomorrow rather than waiting out the whole interval.
    if (!r.ok && every > 86400_000)
      await db.update(schema.automations).set({ lastRunAt: new Date(Date.now() - every + 86400_000) }).where(eq(schema.automations.id, rule.id));
    if (++ran >= (opts.limit ?? 20)) break;
  }
  return ran;
}

/** Picks the best-performing evergreen post and books it again into the queue. */
export async function recycleOnce(rule: Automation): Promise<{ ok: boolean; message: string; postId?: string }> {
  const db = await getDb();
  const minAge = Math.max(1, rule.config.minAgeDays ?? 30) * 86400_000;
  const candidates = await db
    .select({ post: schema.posts })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.userId, rule.userId),
        inArray(schema.posts.status, ["published", "partial"]),
        isNull(schema.posts.recycledFrom),
        lte(schema.posts.publishedAt, new Date(Date.now() - minAge)),
      ),
    )
    .orderBy(desc(schema.posts.publishedAt))
    .limit(200);
  if (!candidates.length) {
    const r = { ok: true, message: "No posts are old enough to re-share yet." };
    await log(rule, true, r.message);
    return r;
  }
  const ids = candidates.map((c) => c.post.id);
  const targets = await db.select().from(schema.postTargets).where(inArray(schema.postTargets.postId, ids));
  // Posts already re-shared recently are skipped so the same post doesn't loop.
  const recent = await db
    .select({ from: schema.posts.recycledFrom })
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, rule.userId), gte(schema.posts.createdAt, new Date(Date.now() - minAge))));
  const skip = new Set(recent.map((r) => r.from));

  const scored = candidates
    .filter((c) => !skip.has(c.post.id))
    .map((c) => {
      const ts = targets.filter((t) => t.postId === c.post.id && t.status === "published" && appliesTo(rule, t.channelId));
      return { post: c.post, targets: ts, score: ts.reduce((s, t) => s + engagementOf(t.metrics), 0) };
    })
    .filter((c) => c.targets.length)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    const r = { ok: true, message: "Every eligible post was re-shared recently. Nothing to do this time." };
    await log(rule, true, r.message);
    return r;
  }

  const channelIds = best.targets.map((t) => t.channelId);
  const channels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, rule.userId), inArray(schema.channels.id, channelIds), eq(schema.channels.status, "connected")));
  if (!channels.length) {
    const r = { ok: false, message: "The channels this post went to are no longer connected." };
    await log(rule, false, r.message);
    return r;
  }
  const media = await getMediaByIds(rule.userId, best.post.mediaIds);
  if (media.length !== best.post.mediaIds.length) {
    const r = { ok: false, message: "The best post's media was deleted from the library, so it can't be re-shared." };
    await log(rule, false, r.message);
    return r;
  }

  const [user] = await db.select({ prefs: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, rule.userId));
  const tz = safeZone(user?.prefs.timezone);
  const at =
    (await nextQueueSlot(rule.userId, channels.map((c) => c.id), tz)) ??
    new Date((await bestTimes(rule.userId, channels.map((c) => c.id), tz, 1))[0]?.at ?? Date.now() + 3600_000);

  const newTargets: { channelId: string; caption: string | null; options: (typeof best.targets)[number]["options"] }[] = [];
  const notes: string[] = [];
  for (const ch of channels) {
    const t = best.targets.find((x) => x.channelId === ch.id)!;
    let caption = t.caption;
    if (rule.config.refreshCaption) {
      try {
        caption = await refreshCaption(rule.userId, { platform: ch.platform, caption: t.caption ?? best.post.caption });
      } catch (err) {
        notes.push(`kept the original caption on ${ch.name} (${(err as Error).message})`);
      }
    }
    const errs = validateTarget(ch.platform, caption ?? best.post.caption, media, t.options);
    if (errs.length) {
      notes.push(`skipped ${ch.name}: ${errs[0]}`);
      continue;
    }
    newTargets.push({ channelId: ch.id, caption, options: t.options });
  }
  if (!newTargets.length) {
    const r = { ok: false, message: `Couldn't re-share: ${notes.join("; ")}.` };
    await log(rule, false, r.message);
    return r;
  }
  const [row] = await db
    .insert(schema.posts)
    .values({ userId: rule.userId, caption: best.post.caption, mediaIds: best.post.mediaIds, status: "scheduled", scheduledAt: at, recycledFrom: best.post.id })
    .returning({ id: schema.posts.id });
  for (const t of newTargets) await db.insert(schema.postTargets).values({ postId: row!.id, ...t });
  const message =
    `Booked “${(best.post.caption || "Untitled").slice(0, 60)}” again for ${new Intl.DateTimeFormat("en", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(at)} on ${newTargets.length} ${newTargets.length === 1 ? "channel" : "channels"}` +
    (notes.length ? `; ${notes.join("; ")}.` : ".");
  await log(rule, true, message);
  return { ok: true, message, postId: row!.id };
}

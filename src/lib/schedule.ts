import "server-only";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Platform, TargetMetrics } from "@/db/schema";
import { engagementOf } from "./metrics-math";
import { parseSlot } from "./rules";

// ---- Time zones without a library: Intl gives wall-clock parts, we solve for the instant. ----

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    partsFmt.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function safeZone(tz: string | undefined | null): string {
  if (!tz) return "UTC";
  try {
    fmt(tz);
    return tz;
  } catch {
    return "UTC";
  }
}

/** Wall-clock parts of an instant in a zone. weekday: 0 = Sunday. */
export function wallParts(date: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday!),
  };
}

/** The instant at which the wall clock in `tz` reads the given time. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Correct by the zone offset at the guess, then once more in case we crossed a DST change.
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(t), tz);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    t += guess - asUtc;
  }
  return new Date(t);
}

/** Calendar days starting today in tz, as {year, month, day, weekday}. */
function daysAhead(from: Date, tz: string, n: number) {
  const start = wallParts(from, tz);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
  });
}

// ---- Queue slots ----

export { parseSlot, SLOT_RE } from "./rules";

/**
 * The next free queue slot shared by the chosen channels: the earliest slot (from any of
 * their schedules) after `after` that none of them already has a post booked into.
 */
export async function nextQueueSlot(userId: string, channelIds: string[], tz: string, after = new Date(Date.now() + 5 * 60_000)) {
  const db = await getDb();
  const channels = await db
    .select({ id: schema.channels.id, settings: schema.channels.settings })
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, userId), inArray(schema.channels.id, channelIds)));
  const slots = [...new Set(channels.flatMap((c) => c.settings.queueSlots ?? []))].map(parseSlot).filter((s) => s !== null);
  if (!slots.length) return null;

  const horizon = new Date(after.getTime() + 29 * 86400_000);
  const booked = await db
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .innerJoin(schema.postTargets, eq(schema.postTargets.postId, schema.posts.id))
    .where(
      and(
        eq(schema.posts.userId, userId),
        inArray(schema.posts.status, ["scheduled", "publishing"]),
        inArray(schema.postTargets.channelId, channelIds),
        gte(schema.posts.scheduledAt, after),
        lte(schema.posts.scheduledAt, horizon),
      ),
    );
  const taken = booked.map((b) => b.at!.getTime());

  for (const d of daysAhead(after, tz, 29)) {
    const today = slots.filter((s) => s.weekday === d.weekday).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    for (const s of today) {
      const at = zonedTime(d.year, d.month, d.day, s.hour, s.minute, tz);
      if (at <= after) continue;
      if (taken.some((t) => Math.abs(t - at.getTime()) < 60_000)) continue;
      return at;
    }
  }
  return null;
}

// ---- Best times ----

/**
 * Typical high-engagement windows per platform (local time), used until a channel has
 * enough of its own history. weekday 0 = Sunday.
 */
const TYPICAL: Record<Platform, { days: number[]; hours: number[] }[]> = {
  instagram: [
    { days: [1, 2, 3, 4, 5], hours: [9, 10, 11] },
    { days: [1, 2, 3, 4], hours: [18, 19, 20] },
  ],
  facebook: [{ days: [1, 2, 3, 4, 5], hours: [9, 10, 11, 12, 13] }],
  youtube: [
    { days: [4, 5], hours: [14, 15, 16, 17] },
    { days: [0, 6], hours: [10, 11, 12, 13, 14] },
  ],
};

function typicalScore(platforms: Platform[], weekday: number, hour: number) {
  if (!platforms.length) return 1;
  const hits = platforms.filter((p) => TYPICAL[p].some((w) => w.days.includes(weekday) && w.hours.includes(hour))).length;
  return 0.8 + 0.7 * (hits / platforms.length);
}

export interface HourBucket {
  weekday: number;
  hour: number;
  posts: number;
  /** Mean engagement per post, relative to the channel's follower count. */
  rate: number;
}

/** Published posts' engagement grouped by local weekday and hour. */
export async function engagementBuckets(userId: string, tz: string, channelIds?: string[], since = new Date(Date.now() - 180 * 86400_000)) {
  const db = await getDb();
  const rows = await db
    .select({
      publishedAt: schema.postTargets.publishedAt,
      metrics: schema.postTargets.metrics,
      followers: schema.channels.followers,
      platform: schema.channels.platform,
    })
    .from(schema.postTargets)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.postTargets.channelId))
    .where(
      and(
        eq(schema.channels.userId, userId),
        eq(schema.postTargets.status, "published"),
        isNotNull(schema.postTargets.metrics),
        gte(schema.postTargets.publishedAt, since),
        channelIds?.length ? inArray(schema.postTargets.channelId, channelIds) : undefined,
      ),
    );
  const map = new Map<number, { n: number; sum: number }>();
  for (const r of rows) {
    const w = wallParts(r.publishedAt!, tz);
    const key = w.weekday * 24 + w.hour;
    const rate = engagementOf(r.metrics as TargetMetrics) / Math.max(r.followers ?? 0, 100);
    const b = map.get(key) ?? { n: 0, sum: 0 };
    b.n++;
    b.sum += rate;
    map.set(key, b);
  }
  const buckets: HourBucket[] = [...map].map(([key, b]) => ({ weekday: Math.floor(key / 24), hour: key % 24, posts: b.n, rate: b.sum / b.n }));
  return { buckets, total: rows.length };
}

export interface TimeSuggestion {
  at: string;
  reason: string;
}

/**
 * The best upcoming times to post to these channels in the next week: the user's own
 * engagement history where there is enough of it, blended with typical platform patterns.
 */
export async function bestTimes(userId: string, channelIds: string[], tz: string, count = 3): Promise<TimeSuggestion[]> {
  const db = await getDb();
  const channels = channelIds.length
    ? await db
        .select({ platform: schema.channels.platform })
        .from(schema.channels)
        .where(and(eq(schema.channels.userId, userId), inArray(schema.channels.id, channelIds)))
    : [];
  const platforms = [...new Set(channels.map((c) => c.platform))];
  const { buckets, total } = await engagementBuckets(userId, tz, channelIds.length ? channelIds : undefined);
  const overall = total ? buckets.reduce((s, b) => s + b.rate * b.posts, 0) / total : 0;

  // Bayesian blend: each bucket starts as if it had K posts at the typical score.
  const K = 3;
  const score = (weekday: number, hour: number) => {
    const prior = typicalScore(platforms, weekday, hour);
    const b = buckets.find((x) => x.weekday === weekday && x.hour === hour);
    if (!b || !overall) return { s: prior, own: null as number | null };
    const rel = b.rate / overall;
    return { s: (b.posts * rel + K * prior) / (b.posts + K), own: b.posts >= 2 ? rel : null };
  };

  const after = new Date(Date.now() + 15 * 60_000);
  const candidates: { at: Date; s: number; own: number | null; weekday: number; hour: number }[] = [];
  for (const d of daysAhead(after, tz, 8)) {
    for (let hour = 7; hour <= 22; hour++) {
      const at = zonedTime(d.year, d.month, d.day, hour, 0, tz);
      if (at <= after || at.getTime() > after.getTime() + 7 * 86400_000) continue;
      candidates.push({ at, weekday: d.weekday, hour, ...score(d.weekday, hour) });
    }
  }
  candidates.sort((a, b) => b.s - a.s || +a.at - +b.at);

  // Spread suggestions out: no two within 3 hours of each other.
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.some((p) => Math.abs(+p.at - +c.at) < 3 * 3600_000)) continue;
    picked.push(c);
    if (picked.length === count) break;
  }
  return picked
    .sort((a, b) => +a.at - +b.at)
    .map((c) => ({
      at: c.at.toISOString(),
      reason:
        c.own !== null && c.own > 1.05
          ? `Your posts at this time get ${c.own.toFixed(1)}× your average engagement.`
          : platforms.length
            ? `A typical high-engagement time on ${platforms.map((p) => ({ youtube: "YouTube", facebook: "Facebook", instagram: "Instagram" })[p]).join(" and ")}.`
            : "A typical high-engagement time.",
    }));
}

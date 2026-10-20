import "server-only";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Platform, TargetMetrics } from "@/db/schema";
import { listChannels } from "./channels";
import { engagementOf, utcDay } from "./metrics-math";
import { engagementBuckets, type HourBucket } from "./schedule";

export interface AnalyticsPost {
  targetId: string;
  postId: string;
  channelId: string;
  platform: Platform;
  channelName: string;
  caption: string;
  publishedAt: string;
  url: string | null;
  metrics: TargetMetrics;
  engagement: number;
}

export interface ChannelSeries {
  channelId: string;
  name: string;
  platform: Platform;
  followers: number | null;
  /** Change in followers over the range; null without at least two snapshots. */
  growth: number | null;
  points: { day: string; followers: number }[];
  posts: number;
  engagement: number;
  views: number;
}

export interface Analytics {
  days: number;
  totals: { posts: number; engagement: number; views: number; comments: number; replies: number; followers: number; growth: number | null };
  previous: { posts: number; engagement: number; views: number };
  channels: ChannelSeries[];
  top: AnalyticsPost[];
  heatmap: { buckets: HourBucket[]; total: number };
  lastSync: string | null;
}

export async function getAnalytics(userId: string, days: number, tz: string): Promise<Analytics> {
  const db = await getDb();
  const now = Date.now();
  const since = new Date(now - days * 86400_000);
  const prevSince = new Date(now - 2 * days * 86400_000);
  const channels = await listChannels(userId);

  const [stats, targets, inbox, heatmap] = await Promise.all([
    db
      .select({ channelId: schema.channelStats.channelId, day: schema.channelStats.day, followers: schema.channelStats.followers })
      .from(schema.channelStats)
      .innerJoin(schema.channels, eq(schema.channels.id, schema.channelStats.channelId))
      .where(and(eq(schema.channels.userId, userId), gte(schema.channelStats.day, utcDay(since))))
      .orderBy(schema.channelStats.day),
    db
      .select({ target: schema.postTargets, caption: schema.posts.caption })
      .from(schema.postTargets)
      .innerJoin(schema.posts, eq(schema.posts.id, schema.postTargets.postId))
      .where(and(eq(schema.posts.userId, userId), eq(schema.postTargets.status, "published"), isNotNull(schema.postTargets.publishedAt), gte(schema.postTargets.publishedAt, prevSince))),
    db
      .select({ repliedAt: schema.inboxItems.repliedAt, postedAt: schema.inboxItems.postedAt })
      .from(schema.inboxItems)
      .where(and(eq(schema.inboxItems.userId, userId), gte(schema.inboxItems.postedAt, since))),
    engagementBuckets(userId, tz),
  ]);

  const byId = new Map(channels.map((c) => [c.id, c]));
  const posts: AnalyticsPost[] = [];
  const prev = { posts: 0, engagement: 0, views: 0 };
  for (const { target: t, caption } of targets) {
    const c = byId.get(t.channelId);
    if (!c) continue;
    const m = t.metrics ?? {};
    if (t.publishedAt! < since) {
      prev.posts++;
      prev.engagement += engagementOf(m);
      prev.views += m.views ?? 0;
      continue;
    }
    posts.push({
      targetId: t.id,
      postId: t.postId,
      channelId: c.id,
      platform: c.platform,
      channelName: c.name,
      caption: (t.caption ?? caption).slice(0, 200),
      publishedAt: t.publishedAt!.toISOString(),
      url: t.externalUrl,
      metrics: m,
      engagement: engagementOf(m),
    });
  }

  const series: ChannelSeries[] = channels.map((c) => {
    const points = stats.filter((s) => s.channelId === c.id).map((s) => ({ day: s.day, followers: s.followers }));
    const mine = posts.filter((p) => p.channelId === c.id);
    return {
      channelId: c.id,
      name: c.name,
      platform: c.platform,
      followers: c.followers,
      growth: points.length >= 2 ? points.at(-1)!.followers - points[0]!.followers : null,
      points,
      posts: mine.length,
      engagement: mine.reduce((s, p) => s + p.engagement, 0),
      views: mine.reduce((s, p) => s + (p.metrics.views ?? 0), 0),
    };
  });

  const growths = series.map((s) => s.growth).filter((g): g is number => g !== null);
  const lastSync = channels
    .map((c) => c.metricsSyncedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => +b - +a)[0];

  return {
    days,
    totals: {
      posts: posts.length,
      engagement: posts.reduce((s, p) => s + p.engagement, 0),
      views: posts.reduce((s, p) => s + (p.metrics.views ?? 0), 0),
      comments: inbox.length,
      replies: inbox.filter((i) => i.repliedAt).length,
      followers: channels.reduce((s, c) => s + (c.followers ?? 0), 0),
      growth: growths.length ? growths.reduce((a, b) => a + b, 0) : null,
    },
    previous: prev,
    channels: series,
    top: [...posts].sort((a, b) => b.engagement - a.engagement || (b.metrics.views ?? 0) - (a.metrics.views ?? 0)).slice(0, 10),
    heatmap,
    lastSync: lastSync?.toISOString() ?? null,
  };
}

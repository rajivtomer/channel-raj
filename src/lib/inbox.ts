import "server-only";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { InboxItem, InboxStatus, Platform } from "@/db/schema";

export interface InboxFilter {
  status: InboxStatus;
  platform?: Platform;
  channelId?: string;
  q?: string;
  /** Pagination: only items posted before this. */
  before?: Date;
}

export type InboxRow = InboxItem & { channelName: string; platform: Platform; channelAvatar: string | null };

export async function listInbox(userId: string, f: InboxFilter, limit = 50): Promise<InboxRow[]> {
  const db = await getDb();
  const q = f.q?.trim();
  const rows = await db
    .select({ item: schema.inboxItems, channelName: schema.channels.name, platform: schema.channels.platform, channelAvatar: schema.channels.avatarUrl })
    .from(schema.inboxItems)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.inboxItems.channelId))
    .where(
      and(
        eq(schema.inboxItems.userId, userId),
        eq(schema.inboxItems.status, f.status),
        f.platform ? eq(schema.channels.platform, f.platform) : undefined,
        f.channelId ? eq(schema.inboxItems.channelId, f.channelId) : undefined,
        f.before ? lt(schema.inboxItems.postedAt, f.before) : undefined,
        q
          ? or(
              ilike(schema.inboxItems.text, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
              ilike(schema.inboxItems.authorName, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.inboxItems.postedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.item, channelName: r.channelName, platform: r.platform, channelAvatar: r.channelAvatar }));
}

export async function inboxCounts(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.inboxItems.status, n: sql<number>`count(*)::int` })
    .from(schema.inboxItems)
    .where(eq(schema.inboxItems.userId, userId))
    .groupBy(schema.inboxItems.status);
  const get = (s: InboxStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return { open: get("open"), done: get("done"), hidden: get("hidden") };
}

export async function getInboxItem(userId: string, id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ item: schema.inboxItems, channel: schema.channels })
    .from(schema.inboxItems)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.inboxItems.channelId))
    .where(and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.id, id)))
    .limit(1);
  return row ?? null;
}

export async function setInboxStatus(userId: string, ids: string[], status: InboxStatus) {
  const db = await getDb();
  await db
    .update(schema.inboxItems)
    .set({ status })
    .where(and(eq(schema.inboxItems.userId, userId), inArray(schema.inboxItems.id, ids)));
}

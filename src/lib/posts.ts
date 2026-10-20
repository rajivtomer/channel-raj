import "server-only";
import { and, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Post, PostTarget } from "@/db/schema";

export type PostWithTargets = Post & { targets: PostTarget[] };

async function attachTargets(posts: Post[]): Promise<PostWithTargets[]> {
  if (!posts.length) return [];
  const db = await getDb();
  const targets = await db
    .select()
    .from(schema.postTargets)
    .where(inArray(schema.postTargets.postId, posts.map((p) => p.id)));
  return posts.map((p) => ({ ...p, targets: targets.filter((t) => t.postId === p.id) }));
}

export async function getPost(userId: string, id: string): Promise<PostWithTargets | null> {
  const db = await getDb();
  const [post] = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, userId), eq(schema.posts.id, id)))
    .limit(1);
  if (!post) return null;
  return (await attachTargets([post]))[0]!;
}

/** Posts scheduled or published within [from, to), for the calendar. */
export async function listPostsInRange(userId: string, from: Date, to: Date) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.userId, userId),
        or(
          and(gte(schema.posts.scheduledAt, from), lte(schema.posts.scheduledAt, to)),
          and(gte(schema.posts.publishedAt, from), lte(schema.posts.publishedAt, to)),
        ),
      ),
    )
    .orderBy(schema.posts.scheduledAt);
  return attachTargets(rows);
}

export async function listPostsByStatus(userId: string, statuses: Post["status"][], limit = 100) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, userId), inArray(schema.posts.status, statuses)))
    .orderBy(desc(schema.posts.updatedAt))
    .limit(limit);
  return attachTargets(rows);
}

export async function postCounts(userId: string) {
  const db = await getDb();
  const rows = await db.select({ status: schema.posts.status }).from(schema.posts).where(eq(schema.posts.userId, userId));
  const count = (s: Post["status"]) => rows.filter((r) => r.status === s).length;
  return {
    scheduled: count("scheduled"),
    drafts: count("draft"),
    published: count("published") + count("partial"),
    failed: count("failed") + count("partial"),
  };
}

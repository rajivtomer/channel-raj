import "server-only";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MediaAsset, MediaKind } from "@/db/schema";

/** Vercel Blob is used when its token is configured; otherwise files go to .data/uploads (local development). */
export const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB

export const kindOf = (mime: string): MediaKind => (mime.startsWith("video/") ? "video" : "image");

export async function listMedia(userId: string): Promise<MediaAsset[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.userId, userId))
    .orderBy(desc(schema.mediaAssets.createdAt));
}

export async function getMediaByIds(userId: string, ids: string[]): Promise<MediaAsset[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.userId, userId), inArray(schema.mediaAssets.id, ids)));
  // Keep the caller's order.
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is MediaAsset => Boolean(r));
}

export async function createMedia(values: Omit<typeof schema.mediaAssets.$inferInsert, "id" | "createdAt">) {
  const db = await getDb();
  const [row] = await db.insert(schema.mediaAssets).values(values).returning();
  return row!;
}

export async function deleteMedia(userId: string, id: string) {
  const db = await getDb();
  const [asset] = await db
    .select()
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.userId, userId), eq(schema.mediaAssets.id, id)))
    .limit(1);
  if (!asset) return;
  if (blobEnabled() && /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(asset.url)) {
    const { del } = await import("@vercel/blob");
    await del(asset.url).catch(() => undefined);
  } else {
    await fs.rm(path.join(LOCAL_UPLOAD_DIR, asset.pathname), { force: true });
  }
  await db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.id, id));
}

/** Reads the file bytes as a stream, for uploads to platforms that need the raw file (YouTube). */
export async function openMedia(asset: MediaAsset): Promise<ReadableStream<Uint8Array>> {
  if (asset.url.startsWith("http") && !asset.url.includes("/api/media/file/")) {
    const res = await fetch(asset.url);
    if (!res.ok || !res.body) throw new Error(`Could not read ${asset.filename} from storage (HTTP ${res.status}).`);
    return res.body;
  }
  return Readable.toWeb(createReadStream(path.join(LOCAL_UPLOAD_DIR, asset.pathname))) as ReadableStream<Uint8Array>;
}

export const safeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-80) || "file";

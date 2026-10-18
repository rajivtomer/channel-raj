"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { ALLOWED_TYPES, blobEnabled, createMedia, deleteMedia, kindOf, MAX_UPLOAD_BYTES } from "@/lib/media";

const assetSchema = z.object({
  url: z.string().url(),
  pathname: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  mimeType: z.string().refine((t) => ALLOWED_TYPES.includes(t), "Unsupported file type."),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  durationSec: z.number().nonnegative().nullish(),
});

export async function registerMediaAction(input: z.input<typeof assetSchema>) {
  const user = await requireUser();
  const a = assetSchema.parse(input);
  // Only accept files this user uploaded to our own storage.
  if (!a.pathname.startsWith(`${user.id}/`)) throw new Error("Invalid upload.");
  const u = new URL(a.url);
  const ok = blobEnabled()
    ? u.hostname.endsWith(".blob.vercel-storage.com") && decodeURIComponent(u.pathname).slice(1) === a.pathname
    : a.url === `${appUrl()}/api/media/file/${a.pathname}`;
  if (!ok) throw new Error("Invalid upload location.");
  const row = await createMedia({
    userId: user.id,
    url: a.url,
    pathname: a.pathname,
    filename: a.filename,
    mimeType: a.mimeType,
    kind: kindOf(a.mimeType),
    size: a.size,
    width: a.width ?? null,
    height: a.height ?? null,
    durationSec: a.durationSec != null ? Math.round(a.durationSec) : null,
  });
  revalidatePath("/library");
  return row;
}

export async function deleteMediaAction(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const assetId = z.string().uuid().parse(id);
  const db = await getDb();
  const inUse = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.userId, user.id),
        inArray(schema.posts.status, ["scheduled", "publishing"]),
        sql`${schema.posts.mediaIds} @> ${JSON.stringify([assetId])}::jsonb`,
      ),
    )
    .limit(1);
  if (inUse.length) return { ok: false, message: "This file is used by a scheduled post. Remove it from the post first." };
  await deleteMedia(user.id, assetId);
  revalidatePath("/library");
  return { ok: true, message: "Deleted." };
}

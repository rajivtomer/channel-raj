import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { LOCAL_UPLOAD_DIR } from "@/lib/media";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime" };

/** Serves locally stored uploads (development only; production uses Vercel Blob URLs). */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const file = path.resolve(LOCAL_UPLOAD_DIR, rel);
  if (!file.startsWith(LOCAL_UPLOAD_DIR + path.sep) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const stat = fs.statSync(file);
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

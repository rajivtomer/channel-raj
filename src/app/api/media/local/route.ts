import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { ALLOWED_TYPES, blobEnabled, LOCAL_UPLOAD_DIR, MAX_UPLOAD_BYTES, safeName } from "@/lib/media";

/** Local-development upload target used when Vercel Blob isn't configured. */
export async function POST(req: Request) {
  if (blobEnabled()) return NextResponse.json({ error: "Use Blob uploads." }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: `${file.type || "This file type"} isn't supported.` }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File is larger than 1 GB." }, { status: 400 });
  const pathname = `${user.id}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
  const dest = path.join(LOCAL_UPLOAD_DIR, pathname);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: `${appUrl()}/api/media/file/${pathname}`, pathname });
}

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/media";

/** Issues short-lived tokens so the browser uploads straight to Vercel Blob (no 4.5 MB function limit). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`${user.id}/`)) throw new Error("Invalid upload path.");
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_UPLOAD_BYTES, addRandomSuffix: true };
      },
      // Assets are registered by the client after upload, so nothing to do here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

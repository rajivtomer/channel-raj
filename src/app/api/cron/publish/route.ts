import { NextResponse } from "next/server";
import { runPublisher } from "@/lib/publish/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Publishes everything that is due. Called by Vercel Cron and the GitHub Actions
 * scheduler; both send "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runPublisher({ limit: 50 });
  return NextResponse.json({ ok: true, ...summary, at: new Date().toISOString() });
}

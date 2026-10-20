import { NextResponse } from "next/server";
import { runRecycleDue } from "@/lib/automations";
import { runPublisher } from "@/lib/publish/engine";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduler's heartbeat: publishes what is due, then syncs comments and stats and
 * runs automations with the time left. Called by Vercel Cron and the GitHub Actions
 * scheduler; both send "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const publish = await runPublisher({ limit: 50 });
  // Recycled posts are booked into the future, so they're published on a later run.
  const recycled = await runRecycleDue({ limit: 20 }).catch(() => 0);
  const sync = await runSync({ limit: 40, deadline: started + 200_000 }).catch((err) => ({ error: (err as Error).message }));
  return NextResponse.json({ ok: true, ...publish, recycled, sync, at: new Date().toISOString() });
}

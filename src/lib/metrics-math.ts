// Pure helpers shared by server and client.
import type { TargetMetrics } from "@/db/schema";

/** Interactions on a post: likes, comments, shares and saves. Views and reach are not interactions. */
export function engagementOf(m: TargetMetrics | null | undefined): number {
  if (!m) return 0;
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

export function utcDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

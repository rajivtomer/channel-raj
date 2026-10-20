"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { draftPost, type DraftResult } from "@/lib/ai";
import { requireUser, savePreferences } from "@/lib/auth";
import { deleteCredential, getCredential, saveCredential } from "@/lib/credentials";
import { bestTimes, safeZone, type TimeSuggestion } from "@/lib/schedule";

type Result = { ok: boolean; message: string };

export async function saveAiKeyAction(_: Result | undefined, form: FormData): Promise<Result> {
  const user = await requireUser();
  const key = String(form.get("apiKey") ?? "").trim();
  const existing = await getCredential(user.id, "anthropic");
  if (!key && !existing) return { ok: false, message: "Paste your Anthropic API key." };
  if (key.length > 300) return { ok: false, message: "That key is too long." };
  try {
    const r = await saveCredential(user.id, "anthropic", "anthropic", key || null);
    revalidatePath("/settings/api");
    return r;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function deleteAiKeyAction(): Promise<Result> {
  const user = await requireUser();
  await deleteCredential(user.id, "anthropic");
  revalidatePath("/settings/api");
  return { ok: true, message: "API key removed. AI features are off until you add one again." };
}

const prefsSchema = z.object({
  brandVoice: z.string().trim().max(1500).optional(),
  timezone: z.string().trim().max(64).optional(),
});

export async function savePreferencesAction(input: z.input<typeof prefsSchema>): Promise<Result> {
  const user = await requireUser();
  const p = prefsSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]!.message };
  if (p.data.timezone && safeZone(p.data.timezone) !== p.data.timezone) return { ok: false, message: "Unknown time zone." };
  await savePreferences(user.id, p.data);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

/** Records the browser's time zone the first time we see it, so queue times line up with the user's clock. */
export async function adoptTimezoneAction(tz: string) {
  const user = await requireUser();
  if (user.preferences.timezone || safeZone(tz) !== tz) return;
  await savePreferences(user.id, { timezone: tz });
}

const draftSchema = z.object({
  brief: z.string().max(5000),
  current: z.string().max(63206),
  instruction: z.string().max(500),
  channels: z.array(z.object({ id: z.string().uuid(), format: z.string().max(60) })).max(50),
  media: z.string().max(200),
});

export async function draftPostAction(input: z.input<typeof draftSchema>): Promise<{ ok: true; draft: DraftResult } | { ok: false; message: string }> {
  const user = await requireUser();
  const p = draftSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]!.message };
  const db = await getDb();
  const rows = p.data.channels.length
    ? await db
        .select({ id: schema.channels.id, platform: schema.channels.platform, name: schema.channels.name })
        .from(schema.channels)
        .where(and(eq(schema.channels.userId, user.id), inArray(schema.channels.id, p.data.channels.map((c) => c.id))))
    : [];
  try {
    const draft = await draftPost(user.id, {
      brief: p.data.brief,
      current: p.data.current,
      instruction: p.data.instruction,
      media: p.data.media,
      channels: rows.map((r) => ({ ...r, format: p.data.channels.find((c) => c.id === r.id)!.format })),
    });
    return { ok: true, draft };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function bestTimesAction(channelIds: string[]): Promise<TimeSuggestion[]> {
  const user = await requireUser();
  const ids = z.array(z.string().uuid()).max(50).parse(channelIds);
  return bestTimes(user.id, ids, safeZone(user.preferences.timezone));
}

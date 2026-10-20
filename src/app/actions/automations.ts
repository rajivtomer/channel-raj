"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { recycleOnce } from "@/lib/automations";

type Result = { ok: boolean; message: string };

const keywords = z
  .string()
  .max(2000)
  .transform((s) => [...new Set(s.split(/[,\n]/).map((k) => k.trim()).filter(Boolean))].slice(0, 100));

const automationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("auto_reply"),
    name: z.string().trim().min(1, "Give the rule a name.").max(80),
    channelIds: z.array(z.string().uuid()).max(50),
    keywords,
    replyText: z.string().trim().max(2000),
    useAi: z.boolean(),
  }),
  z.object({
    kind: z.literal("auto_hide"),
    name: z.string().trim().min(1, "Give the rule a name.").max(80),
    channelIds: z.array(z.string().uuid()).max(50),
    keywords,
    hideLinks: z.boolean(),
  }),
  z.object({
    kind: z.literal("recycle"),
    name: z.string().trim().min(1, "Give the rule a name.").max(80),
    channelIds: z.array(z.string().uuid()).max(50),
    minAgeDays: z.coerce.number().int().min(1).max(3650),
    everyDays: z.coerce.number().int().min(1).max(365),
    refreshCaption: z.boolean(),
  }),
]);

export type AutomationInput = z.input<typeof automationSchema>;

export async function saveAutomationAction(id: string | null, input: AutomationInput): Promise<Result & { id?: string }> {
  const user = await requireUser();
  const p = automationSchema.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]!.message };
  const d = p.data;
  if (d.kind === "auto_reply" && !d.useAi && !d.replyText) {
    return { ok: false, message: "Write the reply text, or let the AI assistant write each reply." };
  }
  if (d.kind === "auto_hide" && !d.keywords.length && !d.hideLinks) {
    return { ok: false, message: "Add at least one word to hide, or turn on hiding links." };
  }
  const { kind, name, ...config } = d;
  const db = await getDb();
  if (id) {
    const [row] = await db
      .update(schema.automations)
      .set({ name, config })
      .where(and(eq(schema.automations.id, z.string().uuid().parse(id)), eq(schema.automations.userId, user.id), eq(schema.automations.kind, kind)))
      .returning({ id: schema.automations.id });
    if (!row) return { ok: false, message: "Rule not found." };
    revalidatePath("/automations");
    return { ok: true, message: "Rule updated.", id: row.id };
  }
  const [row] = await db.insert(schema.automations).values({ userId: user.id, kind, name, config }).returning({ id: schema.automations.id });
  revalidatePath("/automations");
  return { ok: true, message: "Rule created. It acts on new activity from now on.", id: row!.id };
}

export async function toggleAutomationAction(id: string, enabled: boolean): Promise<Result> {
  const user = await requireUser();
  const db = await getDb();
  await db
    .update(schema.automations)
    // Re-enabling restarts the window, so the rule doesn't act on what arrived while it was off.
    .set(enabled ? { enabled, activeSince: new Date() } : { enabled })
    .where(and(eq(schema.automations.id, z.string().uuid().parse(id)), eq(schema.automations.userId, user.id)));
  revalidatePath("/automations");
  return { ok: true, message: enabled ? "Rule turned on." : "Rule paused." };
}

export async function deleteAutomationAction(id: string): Promise<Result> {
  const user = await requireUser();
  const db = await getDb();
  await db.delete(schema.automations).where(and(eq(schema.automations.id, z.string().uuid().parse(id)), eq(schema.automations.userId, user.id)));
  revalidatePath("/automations");
  return { ok: true, message: "Rule deleted." };
}

/** Runs a recycle rule right away instead of waiting for its interval. */
export async function runRecycleNowAction(id: string): Promise<Result> {
  const user = await requireUser();
  const db = await getDb();
  const [rule] = await db
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.id, z.string().uuid().parse(id)), eq(schema.automations.userId, user.id), eq(schema.automations.kind, "recycle")));
  if (!rule) return { ok: false, message: "Rule not found." };
  const r = await recycleOnce(rule);
  revalidatePath("/automations");
  revalidatePath("/calendar");
  return r;
}

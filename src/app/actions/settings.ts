"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Provider } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { checkChannel, disconnectChannel, listChannels } from "@/lib/channels";
import { deleteCredential, reverifyCredential, saveCredential } from "@/lib/credentials";

export type ActionResult = { ok: boolean; message: string } | undefined;

const providerSchema = z.enum(["google", "meta"]);

const credentialSchema = z.object({
  provider: providerSchema,
  clientId: z.string().trim().min(1, "Enter the ID.").max(300),
  clientSecret: z.string().trim().max(500),
});

export async function saveCredentialAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = credentialSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  try {
    const result = await saveCredential(user.id, parsed.data.provider, parsed.data.clientId, parsed.data.clientSecret || null);
    revalidatePath("/settings/api");
    return result;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function reverifyCredentialAction(provider: Provider): Promise<ActionResult> {
  const user = await requireUser();
  const p = providerSchema.parse(provider);
  try {
    const result = await reverifyCredential(user.id, p);
    revalidatePath("/settings/api");
    return result;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function deleteCredentialAction(provider: Provider): Promise<ActionResult> {
  const user = await requireUser();
  const p = providerSchema.parse(provider);
  await deleteCredential(user.id, p);
  revalidatePath("/settings/api");
  return { ok: true, message: "Credentials removed. Connected channels will stop working until you add them again." };
}

export async function checkChannelAction(channelId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await checkChannel(user.id, z.string().uuid().parse(channelId));
  revalidatePath("/settings/api");
  revalidatePath("/dashboard");
  return result;
}

export async function checkAllChannelsAction(): Promise<ActionResult> {
  const user = await requireUser();
  const channels = await listChannels(user.id);
  const results = await Promise.all(channels.map((c) => checkChannel(user.id, c.id)));
  const failed = results.filter((r) => !r.ok).length;
  revalidatePath("/settings/api");
  revalidatePath("/dashboard");
  return failed
    ? { ok: false, message: `${failed} of ${channels.length} channels need attention.` }
    : { ok: true, message: `All ${channels.length} channels are healthy.` };
}

export async function disconnectChannelAction(channelId: string): Promise<ActionResult> {
  const user = await requireUser();
  await disconnectChannel(user.id, z.string().uuid().parse(channelId));
  revalidatePath("/settings/api");
  revalidatePath("/dashboard");
  return { ok: true, message: "Channel disconnected." };
}


"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { suggestReply } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { getChannelAuth } from "@/lib/channels";
import { hideComment, replyToComment } from "@/lib/engage";
import { getInboxItem, setInboxStatus } from "@/lib/inbox";
import { runSync } from "@/lib/sync";

type Result = { ok: boolean; message: string };

async function owned(itemId: string) {
  const user = await requireUser();
  const row = await getInboxItem(user.id, z.string().uuid().parse(itemId));
  if (!row) throw new Error("Comment not found.");
  return { user, ...row };
}

export async function replyAction(itemId: string, text: string): Promise<Result> {
  const { item, channel } = await owned(itemId);
  const body = z.string().trim().min(1, "Write a reply first.").max(8000).safeParse(text);
  if (!body.success) return { ok: false, message: body.error.issues[0]!.message };
  try {
    const { accessToken, creds } = await getChannelAuth(channel);
    await replyToComment({ channel, accessToken, appSecret: creds.clientSecret }, item.externalId, body.data);
  } catch (err) {
    return { ok: false, message: `${channel.name} didn't accept the reply: ${(err as Error).message}` };
  }
  const db = await getDb();
  await db.update(schema.inboxItems).set({ status: "done", replyText: body.data, repliedAt: new Date() }).where(eq(schema.inboxItems.id, item.id));
  revalidatePath("/inbox");
  return { ok: true, message: "Reply posted." };
}

export async function hideAction(itemId: string): Promise<Result> {
  const { item, channel } = await owned(itemId);
  try {
    const { accessToken, creds } = await getChannelAuth(channel);
    await hideComment({ channel, accessToken, appSecret: creds.clientSecret }, item.externalId);
  } catch (err) {
    return { ok: false, message: `Couldn't hide it on ${channel.name}: ${(err as Error).message}` };
  }
  const db = await getDb();
  await db.update(schema.inboxItems).set({ status: "hidden" }).where(eq(schema.inboxItems.id, item.id));
  revalidatePath("/inbox");
  return { ok: true, message: "Hidden from the public." };
}

export async function setStatusAction(itemIds: string[], status: "open" | "done"): Promise<Result> {
  const user = await requireUser();
  const ids = z.array(z.string().uuid()).min(1).max(200).parse(itemIds);
  await setInboxStatus(user.id, ids, z.enum(["open", "done"]).parse(status));
  revalidatePath("/inbox");
  return { ok: true, message: status === "done" ? `Marked ${ids.length} as done.` : "Moved back to open." };
}

export async function suggestReplyAction(itemId: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const { user, item, channel } = await owned(itemId);
  try {
    const text = await suggestReply(user.id, {
      platform: channel.platform,
      channelName: channel.name,
      postTitle: item.objectTitle,
      author: item.authorName,
      comment: item.text,
    });
    return text ? { ok: true, text } : { ok: false, message: "The assistant suggests not replying to this one." };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function refreshInboxAction(): Promise<Result> {
  const user = await requireUser();
  const s = await runSync({ userId: user.id, force: true, limit: 50, deadline: Date.now() + 50_000 });
  revalidatePath("/inbox");
  revalidatePath("/analytics");
  if (!s.channels) return { ok: true, message: "Everything is already up to date." };
  return s.errors
    ? { ok: false, message: `Checked ${s.channels} channels; ${s.errors} had problems. See API & channels.` }
    : { ok: true, message: s.newComments ? `${s.newComments} new ${s.newComments === 1 ? "comment" : "comments"}.` : "No new comments." };
}

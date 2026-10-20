"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getChannelAuth, getChannelForUser, updateChannelSettings } from "@/lib/channels";
import { getFacebookProfile, updateFacebookProfile } from "@/lib/publish/facebook";
import { getInstagramProfile } from "@/lib/publish/instagram";
import { getYouTubeProfile, listPlaylists, updateYouTubeProfile } from "@/lib/publish/youtube";

async function ownedChannel(channelId: string) {
  const user = await requireUser();
  const channel = await getChannelForUser(user.id, z.string().uuid().parse(channelId));
  if (!channel) throw new Error("Channel not found.");
  return { user, channel };
}

export async function getPlaylistsAction(channelId: string) {
  const { channel } = await ownedChannel(channelId);
  if (channel.platform !== "youtube") return [];
  try {
    const { accessToken } = await getChannelAuth(channel);
    return await listPlaylists(accessToken);
  } catch {
    return [];
  }
}

const settingsSchema = z.object({
  defaultHashtags: z.string().max(1000).optional(),
  captionSuffix: z.string().max(2000).optional(),
  firstComment: z.string().max(2200).optional(),
  youtube: z
    .object({
      privacy: z.enum(["public", "unlisted", "private"]).optional(),
      categoryId: z.string().max(4).optional(),
      tags: z.string().max(500).optional(),
      madeForKids: z.boolean().optional(),
      playlistId: z.string().max(100).optional(),
      notifySubscribers: z.boolean().optional(),
    })
    .optional(),
});

export async function saveChannelSettingsAction(channelId: string, input: z.input<typeof settingsSchema>) {
  const { user, channel } = await ownedChannel(channelId);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const s = parsed.data;
  if (channel.platform !== "youtube") delete s.youtube;
  await updateChannelSettings(user.id, channel.id, s);
  revalidatePath(`/channels/${channel.id}`);
  return { ok: true, message: "Defaults saved." };
}

export type ProfileData =
  | { platform: "youtube"; description: string; keywords: string }
  | { platform: "facebook"; about: string; description: string; website: string; phone: string }
  | { platform: "instagram"; biography: string; website: string; username: string; mediaCount: number | null };

export async function getProfileAction(channelId: string): Promise<{ ok: true; data: ProfileData } | { ok: false; message: string }> {
  const { channel } = await ownedChannel(channelId);
  try {
    const { accessToken, creds } = await getChannelAuth(channel);
    if (channel.platform === "youtube") {
      const b = await getYouTubeProfile(accessToken, channel.externalId);
      return { ok: true, data: { platform: "youtube", description: b.channel?.description ?? "", keywords: b.channel?.keywords ?? "" } };
    }
    if (channel.platform === "facebook") {
      const p = await getFacebookProfile(accessToken, creds.clientSecret, channel.externalId);
      return {
        ok: true,
        data: { platform: "facebook", about: p.about ?? "", description: p.description ?? "", website: p.website ?? "", phone: p.phone ?? "" },
      };
    }
    const p = await getInstagramProfile(accessToken, creds.clientSecret, channel.externalId);
    return {
      ok: true,
      data: { platform: "instagram", biography: p.biography ?? "", website: p.website ?? "", username: p.username ?? "", mediaCount: p.media_count ?? null },
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

const profileSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("youtube"), description: z.string().max(1000), keywords: z.string().max(500) }),
  z.object({
    platform: z.literal("facebook"),
    about: z.string().max(255),
    description: z.string().max(5000),
    website: z.string().max(1000),
    phone: z.string().max(40),
  }),
]);

export async function saveProfileAction(channelId: string, input: z.input<typeof profileSchema>) {
  const { channel } = await ownedChannel(channelId);
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  if (parsed.data.platform !== channel.platform) return { ok: false, message: "Wrong platform." };
  try {
    const { accessToken, creds } = await getChannelAuth(channel);
    if (parsed.data.platform === "youtube") await updateYouTubeProfile(accessToken, channel.externalId, parsed.data);
    else await updateFacebookProfile(accessToken, creds.clientSecret, channel.externalId, parsed.data);
    return { ok: true, message: `Updated on ${channel.platform === "youtube" ? "YouTube" : "Facebook"}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

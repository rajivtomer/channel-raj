import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Channel, ChannelSettings, OAuthProvider, Platform } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { getDecryptedCredential } from "./credentials";
import { checkYouTubeChannel, refreshGoogleToken, revokeGoogleToken } from "./providers/google";
import { ProviderError } from "./providers/http";
import { checkMetaChannel } from "./providers/meta";
import type { DiscoveredChannel } from "./providers/types";

export const providerFor = (platform: Platform): OAuthProvider => (platform === "youtube" ? "google" : "meta");

/** Channel without token columns, safe to hand to UI code. */
export type PublicChannel = Omit<Channel, "accessTokenEnc" | "refreshTokenEnc">;

export async function listChannels(userId: string): Promise<PublicChannel[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.userId, userId))
    .orderBy(asc(schema.channels.platform), asc(schema.channels.name));
  return rows.map(({ accessTokenEnc: _a, refreshTokenEnc: _r, ...rest }) => rest);
}

export async function upsertChannels(userId: string, found: DiscoveredChannel[]): Promise<number> {
  const db = await getDb();
  for (const c of found) {
    const existing = await getChannelByExternal(userId, c.platform, c.externalId);
    const values = {
      name: c.name,
      handle: c.handle ?? null,
      avatarUrl: c.avatarUrl ?? null,
      followers: c.followers ?? null,
      parentExternalId: c.parentExternalId ?? null,
      accessTokenEnc: encrypt(c.accessToken),
      // Google only returns a refresh token on first consent; keep the old one otherwise.
      refreshTokenEnc: c.refreshToken ? encrypt(c.refreshToken) : (existing?.refreshTokenEnc ?? null),
      tokenExpiresAt: c.tokenExpiresAt ?? null,
      scopes: c.scopes ?? null,
      status: "connected" as const,
      statusMessage: null,
      lastCheckedAt: new Date(),
    };
    await db
      .insert(schema.channels)
      .values({ userId, platform: c.platform, externalId: c.externalId, ...values })
      .onConflictDoUpdate({
        target: [schema.channels.userId, schema.channels.platform, schema.channels.externalId],
        set: values,
      });
  }
  return found.length;
}

async function getChannelByExternal(userId: string, platform: Platform, externalId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, userId), eq(schema.channels.platform, platform), eq(schema.channels.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

async function getChannel(userId: string, channelId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.userId, userId), eq(schema.channels.id, channelId)))
    .limit(1);
  return row ?? null;
}

/** Calls the platform to confirm the token still works and refreshes name, avatar and followers. */
export async function checkChannel(userId: string, channelId: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const channel = await getChannel(userId, channelId);
  if (!channel) return { ok: false, message: "Channel not found." };
  const creds = await getDecryptedCredential(userId, providerFor(channel.platform));
  if (!creds) {
    await markChannel(channelId, "error", "API credentials for this platform were removed.");
    return { ok: false, message: "Add API credentials for this platform first." };
  }
  try {
    const accessToken = decrypt(channel.accessTokenEnc);
    const snap =
      channel.platform === "youtube"
        ? await checkYouTubeChannel(creds, {
            externalId: channel.externalId,
            accessToken,
            refreshToken: channel.refreshTokenEnc ? decrypt(channel.refreshTokenEnc) : null,
            tokenExpiresAt: channel.tokenExpiresAt,
          })
        : await checkMetaChannel(creds, { platform: channel.platform, externalId: channel.externalId, accessToken });
    await db
      .update(schema.channels)
      .set({
        name: snap.name,
        handle: snap.handle ?? channel.handle,
        avatarUrl: snap.avatarUrl ?? channel.avatarUrl,
        followers: snap.followers ?? channel.followers,
        ...(snap.accessToken ? { accessTokenEnc: encrypt(snap.accessToken), tokenExpiresAt: snap.tokenExpiresAt ?? null } : {}),
        status: "connected",
        statusMessage: null,
        lastCheckedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));
    return { ok: true, message: `${snap.name} is connected.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expired = err instanceof ProviderError && (err.status === 401 || err.code === "190" || err.code === "invalid_grant");
    await markChannel(channelId, expired ? "expired" : "error", message);
    return { ok: false, message };
  }
}

async function markChannel(channelId: string, status: "expired" | "error", message: string) {
  const db = await getDb();
  await db
    .update(schema.channels)
    .set({ status, statusMessage: message, lastCheckedAt: new Date() })
    .where(eq(schema.channels.id, channelId));
}

export async function disconnectChannel(userId: string, channelId: string): Promise<void> {
  const db = await getDb();
  const channel = await getChannel(userId, channelId);
  if (!channel) return;
  if (channel.platform === "youtube" && channel.refreshTokenEnc) {
    // Only revoke when no other stored YouTube channel shares this grant.
    const others = (await listChannels(userId)).filter((c) => c.platform === "youtube" && c.id !== channelId);
    if (!others.length) await revokeGoogleToken(decrypt(channel.refreshTokenEnc));
  }
  await db.delete(schema.channels).where(and(eq(schema.channels.userId, userId), eq(schema.channels.id, channelId)));
}

export async function getChannelForUser(userId: string, channelId: string) {
  return getChannel(userId, channelId);
}

/**
 * A usable access token for a channel, refreshing (and persisting) YouTube tokens that
 * are about to expire. Meta Page tokens do not expire.
 */
export async function getChannelAuth(channel: Channel) {
  const creds = await getDecryptedCredential(channel.userId, providerFor(channel.platform));
  if (!creds) throw new ProviderError("API credentials for this platform were removed. Add them in API & channels.");
  let accessToken = decrypt(channel.accessTokenEnc);
  if (channel.platform === "youtube") {
    const expiring = !channel.tokenExpiresAt || channel.tokenExpiresAt.getTime() < Date.now() + 120_000;
    if (expiring) {
      if (!channel.refreshTokenEnc) throw new ProviderError("YouTube access expired. Reconnect the channel.", 401);
      const fresh = await refreshGoogleToken(creds, decrypt(channel.refreshTokenEnc));
      accessToken = fresh.accessToken;
      const db = await getDb();
      await db
        .update(schema.channels)
        .set({ accessTokenEnc: encrypt(fresh.accessToken), tokenExpiresAt: fresh.expiresAt })
        .where(eq(schema.channels.id, channel.id));
    }
  }
  return { accessToken, creds };
}

export async function updateChannelSettings(userId: string, channelId: string, settings: ChannelSettings) {
  const db = await getDb();
  await db
    .update(schema.channels)
    .set({ settings })
    .where(and(eq(schema.channels.userId, userId), eq(schema.channels.id, channelId)));
}

import "server-only";
import { GOOGLE_SCOPES, redirectUri } from "../config";
import { fetchJson, ProviderError } from "./http";
import type { ChannelSnapshot, DiscoveredChannel, VerifyResult } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const YT = "https://www.googleapis.com/youtube/v3";

interface Creds {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

interface YtChannel {
  id: string;
  snippet: { title: string; customUrl?: string; thumbnails?: Record<string, { url: string }> };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
}

/**
 * Google has no endpoint that validates a client secret on its own, so we redeem a
 * deliberately invalid code: "invalid_grant" means the client was accepted,
 * "invalid_client"/"unauthorized_client" means the ID or secret is wrong.
 */
export async function verifyGoogle({ clientId, clientSecret }: Creds): Promise<VerifyResult> {
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
    return { ok: false, message: "Client ID should end with .apps.googleusercontent.com." };
  }
  try {
    await fetchJson(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "channel-toolkit-verification",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri("google"),
      }),
    });
    return { ok: true, message: "Credentials accepted by Google." };
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    if (err.code === "invalid_grant") return { ok: true, message: "Credentials accepted by Google." };
    if (err.code === "invalid_client" || err.code === "unauthorized_client") {
      return { ok: false, message: "Google rejected this client ID or secret." };
    }
    if (err.code === "redirect_uri_mismatch") {
      return { ok: false, message: "Credentials are valid, but the redirect URI below is not registered on this OAuth client." };
    }
    return { ok: false, message: err.message };
  }
}

export function googleAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri("google"),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // Always ask, so Google returns a refresh token even on reconnect.
    prompt: "consent select_account",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

function toSnapshot(c: YtChannel): ChannelSnapshot {
  const thumbs = c.snippet.thumbnails ?? {};
  return {
    name: c.snippet.title,
    handle: c.snippet.customUrl ?? null,
    avatarUrl: (thumbs.medium ?? thumbs.default ?? thumbs.high)?.url ?? null,
    followers:
      c.statistics && !c.statistics.hiddenSubscriberCount && c.statistics.subscriberCount
        ? Number(c.statistics.subscriberCount)
        : null,
  };
}

export async function exchangeGoogleCode(creds: Creds, code: string): Promise<DiscoveredChannel[]> {
  const token = await fetchJson<TokenResponse>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri("google"),
    }),
  });
  const list = await fetchJson<{ items?: YtChannel[] }>(`${YT}/channels?part=snippet,statistics&mine=true`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!list.items?.length) {
    throw new ProviderError("This Google account has no YouTube channel. Create one at youtube.com first.");
  }
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  return list.items.map((c) => ({
    platform: "youtube" as const,
    externalId: c.id,
    ...toSnapshot(c),
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    tokenExpiresAt: expiresAt,
    scopes: token.scope ?? null,
  }));
}

export async function refreshGoogleToken(creds: Creds, refreshToken: string) {
  const token = await fetchJson<TokenResponse>(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  return { accessToken: token.access_token, expiresAt: new Date(Date.now() + token.expires_in * 1000) };
}

/** Refreshes the access token if needed and re-reads the channel. */
export async function checkYouTubeChannel(
  creds: Creds,
  channel: { externalId: string; accessToken: string; refreshToken: string | null; tokenExpiresAt: Date | null },
): Promise<ChannelSnapshot> {
  let accessToken = channel.accessToken;
  let refreshed: { accessToken: string; expiresAt: Date } | undefined;
  const expiringSoon = !channel.tokenExpiresAt || channel.tokenExpiresAt.getTime() < Date.now() + 60_000;
  if (expiringSoon) {
    if (!channel.refreshToken) throw new ProviderError("Access expired and no refresh token is stored. Reconnect the channel.", 401);
    refreshed = await refreshGoogleToken(creds, channel.refreshToken);
    accessToken = refreshed.accessToken;
  }
  const list = await fetchJson<{ items?: YtChannel[] }>(
    `${YT}/channels?part=snippet,statistics&id=${encodeURIComponent(channel.externalId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const item = list.items?.[0];
  if (!item) throw new ProviderError("YouTube no longer returns this channel.", 404);
  return { ...toSnapshot(item), accessToken: refreshed?.accessToken, tokenExpiresAt: refreshed?.expiresAt };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetchJson(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

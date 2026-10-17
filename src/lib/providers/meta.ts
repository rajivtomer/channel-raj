import "server-only";
import { createHmac } from "node:crypto";
import { META_GRAPH_VERSION, META_SCOPES, redirectUri } from "../config";
import { fetchJson, ProviderError } from "./http";
import type { ChannelSnapshot, DiscoveredChannel, VerifyResult } from "./types";

const graph = (path: string) => `https://graph.facebook.com/${META_GRAPH_VERSION}${path}`;

interface Creds {
  clientId: string;
  clientSecret: string;
}

interface IgAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

interface Page {
  id: string;
  name: string;
  access_token: string;
  username?: string;
  followers_count?: number;
  fan_count?: number;
  picture?: { data?: { url?: string } };
  instagram_business_account?: IgAccount;
}

/** appsecret_proof hardens server-side Graph calls; Meta can require it per app. */
function proof(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function authed(url: string, token: string, secret: string) {
  const u = new URL(url);
  u.searchParams.set("access_token", token);
  u.searchParams.set("appsecret_proof", proof(token, secret));
  return u.toString();
}

/** An app access token can only be minted with a correct App ID + secret pair. */
export async function verifyMeta({ clientId, clientSecret }: Creds): Promise<VerifyResult> {
  if (!/^\d{6,20}$/.test(clientId)) return { ok: false, message: "App ID should be a number." };
  try {
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
    await fetchJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${params}`);
    const app = await fetchJson<{ name?: string }>(
      graph(`/${clientId}?fields=name&access_token=${encodeURIComponent(`${clientId}|${clientSecret}`)}`),
    ).catch(() => ({ name: undefined }));
    return { ok: true, message: app.name ? `Connected to Meta app “${app.name}”.` : "Credentials accepted by Meta." };
  } catch (err) {
    if (err instanceof ProviderError) return { ok: false, message: `Meta rejected these credentials: ${err.message}` };
    throw err;
  }
}

export function metaAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri("meta"),
    response_type: "code",
    scope: META_SCOPES.join(","),
    auth_type: "rerequest",
    state,
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params}`;
}

const PAGE_FIELDS =
  "id,name,username,access_token,followers_count,fan_count,picture.type(large){url}," +
  "instagram_business_account{id,username,name,profile_picture_url,followers_count}";

export async function exchangeMetaCode(creds: Creds, code: string): Promise<DiscoveredChannel[]> {
  const short = await fetchJson<{ access_token: string }>(
    graph(
      `/oauth/access_token?${new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri("meta"),
        code,
      })}`,
    ),
  );
  // Page tokens derived from a long-lived user token do not expire.
  const long = await fetchJson<{ access_token: string }>(
    graph(
      `/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        fb_exchange_token: short.access_token,
      })}`,
    ),
  );
  const granted = await fetchJson<{ data: { permission: string; status: string }[] }>(
    authed(graph("/me/permissions"), long.access_token, creds.clientSecret),
  );
  const scopes = granted.data.filter((p) => p.status === "granted").map((p) => p.permission).join(",");

  const pages: Page[] = [];
  let next: string | undefined = authed(graph(`/me/accounts?fields=${PAGE_FIELDS}&limit=100`), long.access_token, creds.clientSecret);
  while (next) {
    const res: { data: Page[]; paging?: { next?: string } } = await fetchJson(next);
    pages.push(...res.data);
    next = res.paging?.next;
  }
  if (!pages.length) {
    throw new ProviderError("No Facebook Pages were shared. Reconnect and select at least one Page.");
  }

  const out: DiscoveredChannel[] = [];
  for (const p of pages) {
    out.push({
      platform: "facebook",
      externalId: p.id,
      name: p.name,
      handle: p.username ?? null,
      avatarUrl: p.picture?.data?.url ?? null,
      followers: p.followers_count ?? p.fan_count ?? null,
      accessToken: p.access_token,
      scopes,
    });
    const ig = p.instagram_business_account;
    if (ig) {
      out.push({
        platform: "instagram",
        externalId: ig.id,
        name: ig.name || ig.username || "Instagram account",
        handle: ig.username ?? null,
        avatarUrl: ig.profile_picture_url ?? null,
        followers: ig.followers_count ?? null,
        parentExternalId: p.id,
        accessToken: p.access_token,
        scopes,
      });
    }
  }
  return out;
}

export async function checkMetaChannel(
  creds: Creds,
  channel: { platform: "facebook" | "instagram"; externalId: string; accessToken: string },
): Promise<ChannelSnapshot> {
  if (channel.platform === "facebook") {
    const p = await fetchJson<Page>(
      authed(graph(`/${channel.externalId}?fields=id,name,username,followers_count,fan_count,picture.type(large){url}`), channel.accessToken, creds.clientSecret),
    );
    return { name: p.name, handle: p.username ?? null, avatarUrl: p.picture?.data?.url ?? null, followers: p.followers_count ?? p.fan_count ?? null };
  }
  const ig = await fetchJson<IgAccount>(
    authed(graph(`/${channel.externalId}?fields=id,username,name,profile_picture_url,followers_count`), channel.accessToken, creds.clientSecret),
  );
  return {
    name: ig.name || ig.username || "Instagram account",
    handle: ig.username ?? null,
    avatarUrl: ig.profile_picture_url ?? null,
    followers: ig.followers_count ?? null,
  };
}

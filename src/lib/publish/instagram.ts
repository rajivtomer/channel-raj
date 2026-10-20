import "server-only";
import { fetchJson, ProviderError } from "../providers/http";
import { authed, graph } from "../providers/meta";
import type { PublishInput, PublishOutcome } from "./types";

type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

function post<T>(path: string, token: string, secret: string, fields: Record<string, string>) {
  return fetchJson<T>(authed(graph(path), token, secret), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  }, 60_000);
}

async function containerStatus(id: string, token: string, secret: string) {
  return fetchJson<{ status_code: ContainerStatus; status?: string }>(authed(graph(`/${id}?fields=status_code,status`), token, secret));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates the media container(s). Publishing happens once Instagram finishes processing them. */
export async function startInstagram(input: PublishInput): Promise<PublishOutcome> {
  const { channel, accessToken: token, appSecret: secret, caption, media, options } = input;
  const ig = channel.externalId;
  const format = options.instagram?.format ?? "feed";
  if (!media.length) return { state: "failed", error: "Instagram needs at least one photo or video." };

  const mediaFields = (m: (typeof media)[number]): Record<string, string> =>
    m.kind === "video" ? { video_url: m.url } : { image_url: m.url };
  let containerId: string;

  if (format === "story") {
    const m = media[0]!;
    ({ id: containerId } = await post<{ id: string }>(`/${ig}/media`, token, secret, { media_type: "STORIES", ...mediaFields(m) }));
  } else if (media.length === 1) {
    const m = media[0]!;
    const fields: Record<string, string> =
      m.kind === "video"
        ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: String(options.instagram?.shareToFeed ?? true) }
        : { image_url: m.url, caption };
    ({ id: containerId } = await post<{ id: string }>(`/${ig}/media`, token, secret, fields));
  } else {
    const children = [];
    for (const m of media) {
      const extra: Record<string, string> = m.kind === "video" ? { media_type: "VIDEO", video_url: m.url } : { image_url: m.url };
      children.push((await post<{ id: string }>(`/${ig}/media`, token, secret, { is_carousel_item: "true", ...extra })).id);
    }
    // Carousel children must finish processing before the parent can be created.
    for (const child of children) await waitFinished(child, token, secret, 40_000);
    ({ id: containerId } = await post<{ id: string }>(`/${ig}/media`, token, secret, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    }));
  }
  return checkInstagram(input, containerId, 20_000);
}

async function waitFinished(id: string, token: string, secret: string, budgetMs: number) {
  const until = Date.now() + budgetMs;
  for (;;) {
    const s = await containerStatus(id, token, secret);
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return true;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new ProviderError(`Instagram couldn't process this media: ${s.status ?? s.status_code}`);
    }
    if (Date.now() > until) return false;
    await sleep(3000);
  }
}

/** Publishes the container if Instagram has finished processing it; otherwise asks to be checked again. */
export async function checkInstagram(input: PublishInput, containerId: string, waitMs = 0): Promise<PublishOutcome> {
  const { channel, accessToken: token, appSecret: secret, options } = input;
  let ready: boolean;
  try {
    ready = await waitFinished(containerId, token, secret, waitMs);
  } catch (err) {
    return { state: "failed", error: (err as Error).message };
  }
  if (!ready) return { state: "processing", containerId, retryInSec: 30 };

  const { id: mediaId } = await post<{ id: string }>(`/${channel.externalId}/media_publish`, token, secret, { creation_id: containerId });
  const warnings: string[] = [];
  let permalink: string | null = null;
  try {
    permalink = (await fetchJson<{ permalink?: string }>(authed(graph(`/${mediaId}?fields=permalink`), token, secret))).permalink ?? null;
  } catch {
    // Stories have no permalink; not an error.
  }
  if (options.firstComment?.trim() && options.instagram?.format !== "story") {
    try {
      await post(`/${mediaId}/comments`, token, secret, { message: options.firstComment.trim() });
    } catch (err) {
      warnings.push(`First comment not posted: ${(err as Error).message}`);
    }
  }
  return { state: "published", externalId: mediaId, externalUrl: permalink, warnings };
}

export async function getInstagramProfile(accessToken: string, appSecret: string, igId: string) {
  return fetchJson<{ biography?: string; website?: string; username?: string; media_count?: number }>(
    authed(graph(`/${igId}?fields=biography,website,username,media_count`), accessToken, appSecret),
  );
}

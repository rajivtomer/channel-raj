import "server-only";
import { API } from "../config";
import { openMedia } from "../media";
import { fetchJson, ProviderError } from "../providers/http";
import type { PublishInput, PublishOutcome } from "./types";

const YT = `${API.googleApis}/youtube/v3`;
const UPLOAD = `${API.googleApis}/upload/youtube/v3`;

export async function publishYouTube({ accessToken, caption, media, options }: PublishInput): Promise<PublishOutcome> {
  const video = media.find((m) => m.kind === "video");
  if (!video) return { state: "failed", error: "YouTube needs a video." };
  const yt = options.youtube ?? {};
  const auth = { authorization: `Bearer ${accessToken}` };

  // 1. Start a resumable upload session with the video's metadata.
  const params = new URLSearchParams({ uploadType: "resumable", part: "snippet,status" });
  if (yt.notifySubscribers === false) params.set("notifySubscribers", "false");
  const start = await fetch(`${UPLOAD}/videos?${params}`, {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(video.size),
      "x-upload-content-type": video.mimeType,
    },
    body: JSON.stringify({
      snippet: {
        title: (yt.title ?? "").trim().slice(0, 100),
        description: caption,
        tags: (yt.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        categoryId: yt.categoryId || "22",
      },
      status: { privacyStatus: yt.privacy ?? "public", selfDeclaredMadeForKids: Boolean(yt.madeForKids) },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) {
    const body = await start.json().catch(() => ({}));
    throw new ProviderError(body?.error?.message ?? `YouTube refused the upload (HTTP ${start.status}).`, start.status);
  }

  // 2. Stream the file from storage straight into the session.
  const put = await fetch(session, {
    method: "PUT",
    headers: { ...auth, "content-type": video.mimeType, "content-length": String(video.size) },
    body: await openMedia(video),
    // @ts-expect-error Node's fetch needs duplex for streamed request bodies.
    duplex: "half",
    signal: AbortSignal.timeout(280_000),
  });
  const uploaded = await put.json().catch(() => ({}));
  if (!put.ok || !uploaded.id) {
    throw new ProviderError(uploaded?.error?.message ?? `YouTube upload failed (HTTP ${put.status}).`, put.status);
  }
  const videoId: string = uploaded.id;
  const warnings: string[] = [];

  // 3. Optional extras. These never fail the post, since the video is already up.
  const thumb = yt.thumbnailAssetId ? media.find((m) => m.id === yt.thumbnailAssetId) : undefined;
  if (thumb) {
    try {
      const bytes = await new Response(await openMedia(thumb)).arrayBuffer();
      await fetchJson(`${UPLOAD}/thumbnails/set?videoId=${videoId}`, {
        method: "POST",
        headers: { ...auth, "content-type": thumb.mimeType },
        body: bytes,
      });
    } catch (err) {
      warnings.push(`Thumbnail not set: ${(err as Error).message}`);
    }
  }
  if (yt.playlistId) {
    try {
      await fetchJson(`${YT}/playlistItems?part=snippet`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ snippet: { playlistId: yt.playlistId, resourceId: { kind: "youtube#video", videoId } } }),
      });
    } catch (err) {
      warnings.push(`Not added to playlist: ${(err as Error).message}`);
    }
  }
  if (options.firstComment?.trim()) {
    try {
      await fetchJson(`${YT}/commentThreads?part=snippet`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({
          snippet: { videoId, topLevelComment: { snippet: { textOriginal: options.firstComment.trim() } } },
        }),
      });
    } catch (err) {
      warnings.push(`First comment not posted: ${(err as Error).message}`);
    }
  }
  return { state: "published", externalId: videoId, externalUrl: `https://youtu.be/${videoId}`, warnings };
}

export async function listPlaylists(accessToken: string): Promise<{ id: string; title: string }[]> {
  const res = await fetchJson<{ items?: { id: string; snippet: { title: string } }[] }>(
    `${YT}/playlists?part=snippet&mine=true&maxResults=50`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  return (res.items ?? []).map((p) => ({ id: p.id, title: p.snippet.title }));
}

interface Branding {
  channel?: { description?: string; keywords?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export async function getYouTubeProfile(accessToken: string, channelId: string) {
  const res = await fetchJson<{ items?: { brandingSettings?: Branding }[] }>(
    `${YT}/channels?part=brandingSettings&id=${encodeURIComponent(channelId)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  return res.items?.[0]?.brandingSettings ?? {};
}

/** Updates description and keywords, keeping every other branding field as it was. */
export async function updateYouTubeProfile(accessToken: string, channelId: string, patch: { description: string; keywords: string }) {
  const current = await getYouTubeProfile(accessToken, channelId);
  await fetchJson(`${YT}/channels?part=brandingSettings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: channelId,
      brandingSettings: { ...current, channel: { ...current.channel, description: patch.description, keywords: patch.keywords } },
    }),
  });
}

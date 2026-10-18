import "server-only";
import { fetchJson } from "../providers/http";
import { authed, graph } from "../providers/meta";
import type { PublishInput, PublishOutcome } from "./types";

function post<T>(path: string, token: string, secret: string, fields: Record<string, string>) {
  return fetchJson<T>(authed(graph(path), token, secret), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  }, 120_000);
}

export async function publishFacebook({ channel, accessToken, appSecret, caption, media, options }: PublishInput): Promise<PublishOutcome> {
  const page = channel.externalId;
  const video = media.find((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  let postId: string;
  let url: string;

  if (video) {
    const res = await post<{ id: string }>(`/${page}/videos`, accessToken, appSecret, { file_url: video.url, description: caption });
    postId = res.id;
    url = `https://www.facebook.com/${page}/videos/${res.id}`;
  } else if (images.length === 1) {
    const res = await post<{ id: string; post_id?: string }>(`/${page}/photos`, accessToken, appSecret, { url: images[0]!.url, caption });
    postId = res.post_id ?? res.id;
    url = `https://www.facebook.com/${postId}`;
  } else {
    const fields: Record<string, string> = { message: caption };
    if (images.length > 1) {
      // Upload each photo unpublished, then attach them all to one feed post.
      const ids = await Promise.all(
        images.map((img) => post<{ id: string }>(`/${page}/photos`, accessToken, appSecret, { url: img.url, published: "false" })),
      );
      ids.forEach((r, i) => (fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: r.id })));
    }
    if (options.facebook?.link) fields.link = options.facebook.link;
    const res = await post<{ id: string }>(`/${page}/feed`, accessToken, appSecret, fields);
    postId = res.id;
    url = `https://www.facebook.com/${postId}`;
  }

  const warnings: string[] = [];
  if (options.firstComment?.trim()) {
    try {
      await post(`/${postId}/comments`, accessToken, appSecret, { message: options.firstComment.trim() });
    } catch (err) {
      warnings.push(`First comment not posted: ${(err as Error).message}`);
    }
  }
  return { state: "published", externalId: postId, externalUrl: url, warnings };
}

export async function getFacebookProfile(accessToken: string, appSecret: string, pageId: string) {
  return fetchJson<{ about?: string; description?: string; website?: string; phone?: string; emails?: string[] }>(
    authed(graph(`/${pageId}?fields=about,description,website,phone,emails`), accessToken, appSecret),
  );
}

export async function updateFacebookProfile(
  accessToken: string,
  appSecret: string,
  pageId: string,
  patch: { about: string; description: string; website: string; phone: string },
) {
  const fields: Record<string, string> = { about: patch.about, description: patch.description, website: patch.website, phone: patch.phone };
  await post(`/${pageId}`, accessToken, appSecret, fields);
}

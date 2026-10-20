import "server-only";
import type { Channel, TargetMetrics } from "@/db/schema";
import { API } from "./config";
import { fetchJson } from "./providers/http";
import { authed, graph } from "./providers/meta";

/** Reads and writes comments and engagement numbers on each platform. */

export interface EngageCtx {
  channel: Pick<Channel, "platform" | "externalId" | "handle">;
  accessToken: string;
  appSecret: string;
}

export interface FetchedComment {
  externalId: string;
  objectId: string;
  objectTitle: string | null;
  objectUrl: string | null;
  authorName: string;
  authorAvatar: string | null;
  text: string;
  likeCount: number;
  postedAt: Date;
  /** Written by the channel itself; never shown in the inbox. */
  own: boolean;
}

const YT = `${API.googleApis}/youtube/v3`;
const yt = (token: string) => ({ authorization: `Bearer ${token}` });

function metaPost(ctx: EngageCtx, path: string, fields: Record<string, string>) {
  return fetchJson(authed(graph(path), ctx.accessToken, ctx.appSecret), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
const metaGet = <T>(ctx: EngageCtx, path: string) => fetchJson<T>(authed(graph(path), ctx.accessToken, ctx.appSecret));

const firstLine = (s: string | undefined | null) => (s ? s.split("\n")[0]!.slice(0, 140) : null);

// ---------------- Comments ----------------

export async function fetchComments(ctx: EngageCtx): Promise<FetchedComment[]> {
  if (ctx.channel.platform === "youtube") return youtubeComments(ctx);
  if (ctx.channel.platform === "facebook") return facebookComments(ctx);
  return instagramComments(ctx);
}

interface YtThread {
  id: string;
  snippet: {
    videoId: string;
    topLevelComment: {
      id: string;
      snippet: {
        authorDisplayName: string;
        authorProfileImageUrl?: string;
        authorChannelId?: { value: string };
        textOriginal?: string;
        textDisplay?: string;
        likeCount?: number;
        publishedAt: string;
      };
    };
  };
}

async function youtubeComments(ctx: EngageCtx): Promise<FetchedComment[]> {
  const params = new URLSearchParams({
    part: "snippet",
    allThreadsRelatedToChannelId: ctx.channel.externalId,
    maxResults: "50",
    order: "time",
    textFormat: "plainText",
  });
  const res = await fetchJson<{ items?: YtThread[] }>(`${YT}/commentThreads?${params}`, { headers: yt(ctx.accessToken) });
  const items = res.items ?? [];
  const videoIds = [...new Set(items.map((t) => t.snippet.videoId))];
  const titles = new Map<string, string>();
  if (videoIds.length) {
    const v = await fetchJson<{ items?: { id: string; snippet: { title: string } }[] }>(
      `${YT}/videos?part=snippet&id=${videoIds.slice(0, 50).join(",")}`,
      { headers: yt(ctx.accessToken) },
    ).catch(() => ({ items: [] }));
    for (const x of v.items ?? []) titles.set(x.id, x.snippet.title);
  }
  return items.map((t) => {
    const c = t.snippet.topLevelComment;
    return {
      // Replies go to the top-level comment id.
      externalId: c.id,
      objectId: t.snippet.videoId,
      objectTitle: titles.get(t.snippet.videoId) ?? null,
      objectUrl: `https://www.youtube.com/watch?v=${t.snippet.videoId}&lc=${c.id}`,
      authorName: c.snippet.authorDisplayName,
      authorAvatar: c.snippet.authorProfileImageUrl ?? null,
      text: c.snippet.textOriginal ?? c.snippet.textDisplay ?? "",
      likeCount: c.snippet.likeCount ?? 0,
      postedAt: new Date(c.snippet.publishedAt),
      own: c.snippet.authorChannelId?.value === ctx.channel.externalId,
    };
  });
}

interface FbComment {
  id: string;
  message?: string;
  created_time: string;
  like_count?: number;
  from?: { id: string; name: string; picture?: { data?: { url?: string } } };
}

async function facebookComments(ctx: EngageCtx): Promise<FetchedComment[]> {
  const fields =
    "id,message,permalink_url,created_time,comments.limit(25).order(reverse_chronological){id,message,created_time,like_count,from{id,name,picture}}";
  const res = await metaGet<{ data: { id: string; message?: string; permalink_url?: string; comments?: { data: FbComment[] } }[] }>(
    ctx,
    `/${ctx.channel.externalId}/feed?fields=${encodeURIComponent(fields)}&limit=15`,
  );
  return res.data.flatMap((p) =>
    (p.comments?.data ?? []).map((c) => ({
      externalId: c.id,
      objectId: p.id,
      objectTitle: firstLine(p.message),
      objectUrl: p.permalink_url ?? `https://www.facebook.com/${p.id}`,
      // Meta hides commenter identity from some apps; fall back to a neutral label.
      authorName: c.from?.name ?? "Facebook user",
      authorAvatar: c.from?.picture?.data?.url ?? null,
      text: c.message ?? "",
      likeCount: c.like_count ?? 0,
      postedAt: new Date(c.created_time),
      own: c.from?.id === ctx.channel.externalId,
    })),
  );
}

interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp: string;
  like_count?: number;
}

async function instagramComments(ctx: EngageCtx): Promise<FetchedComment[]> {
  const fields = "id,caption,permalink,timestamp,comments.limit(25){id,text,username,timestamp,like_count}";
  const res = await metaGet<{ data: { id: string; caption?: string; permalink?: string; comments?: { data: IgComment[] } }[] }>(
    ctx,
    `/${ctx.channel.externalId}/media?fields=${encodeURIComponent(fields)}&limit=15`,
  );
  const own = ctx.channel.handle?.replace(/^@/, "").toLowerCase();
  return res.data.flatMap((m) =>
    (m.comments?.data ?? []).map((c) => ({
      externalId: c.id,
      objectId: m.id,
      objectTitle: firstLine(m.caption),
      objectUrl: m.permalink ?? null,
      authorName: c.username ? `@${c.username}` : "Instagram user",
      authorAvatar: null,
      text: c.text ?? "",
      likeCount: c.like_count ?? 0,
      postedAt: new Date(c.timestamp),
      own: Boolean(own && c.username?.toLowerCase() === own),
    })),
  );
}

export async function replyToComment(ctx: EngageCtx, commentId: string, text: string): Promise<void> {
  if (ctx.channel.platform === "youtube") {
    await fetchJson(`${YT}/comments?part=snippet`, {
      method: "POST",
      headers: { ...yt(ctx.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text } }),
    });
  } else if (ctx.channel.platform === "facebook") {
    await metaPost(ctx, `/${commentId}/comments`, { message: text });
  } else {
    await metaPost(ctx, `/${commentId}/replies`, { message: text });
  }
}

/** Hides a comment from the public. YouTube calls this "rejecting" it. */
export async function hideComment(ctx: EngageCtx, commentId: string): Promise<void> {
  if (ctx.channel.platform === "youtube") {
    await fetchJson(`${YT}/comments/setModerationStatus?${new URLSearchParams({ id: commentId, moderationStatus: "rejected" })}`, {
      method: "POST",
      headers: yt(ctx.accessToken),
    });
  } else if (ctx.channel.platform === "facebook") {
    await metaPost(ctx, `/${commentId}`, { is_hidden: "true" });
  } else {
    await metaPost(ctx, `/${commentId}`, { hide: "true" });
  }
}

// ---------------- Metrics ----------------

/** Current numbers for posts this channel published, keyed by the platform's post id. */
export async function fetchMetrics(ctx: EngageCtx, externalIds: string[]): Promise<Record<string, TargetMetrics>> {
  if (!externalIds.length) return {};
  const out: Record<string, TargetMetrics> = {};
  if (ctx.channel.platform === "youtube") {
    for (let i = 0; i < externalIds.length; i += 50) {
      const ids = externalIds.slice(i, i + 50);
      const res = await fetchJson<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
        `${YT}/videos?part=statistics&id=${ids.join(",")}`,
        { headers: yt(ctx.accessToken) },
      );
      for (const v of res.items ?? []) {
        const s = v.statistics ?? {};
        out[v.id] = { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
      }
    }
    return out;
  }
  // Meta: one request per post, so one deleted post doesn't fail the rest.
  await Promise.all(
    externalIds.map(async (id) => {
      try {
        out[id] = ctx.channel.platform === "facebook" ? await facebookMetrics(ctx, id) : await instagramMetrics(ctx, id);
      } catch {
        // Deleted, or the platform no longer reports it. Keep the last numbers we had.
      }
    }),
  );
  return out;
}

const num = (v: string | number | undefined) => (v === undefined || v === null || v === "" ? undefined : Number(v));

async function facebookMetrics(ctx: EngageCtx, id: string): Promise<TargetMetrics> {
  // Page posts are "<page>_<post>"; video uploads are plain ids with a different shape.
  if (id.includes("_")) {
    const p = await metaGet<{ shares?: { count: number }; reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }>(
      ctx,
      `/${id}?fields=${encodeURIComponent("shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)")}`,
    );
    return { likes: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0 };
  }
  const v = await metaGet<{ likes?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }>(
    ctx,
    `/${id}?fields=${encodeURIComponent("likes.summary(total_count).limit(0),comments.summary(total_count).limit(0)")}`,
  );
  return { likes: v.likes?.summary?.total_count ?? 0, comments: v.comments?.summary?.total_count ?? 0 };
}

async function instagramMetrics(ctx: EngageCtx, id: string): Promise<TargetMetrics> {
  const m = await metaGet<{ like_count?: number; comments_count?: number }>(ctx, `/${id}?fields=like_count,comments_count`);
  const out: TargetMetrics = { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 };
  try {
    const ins = await metaGet<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
      ctx,
      `/${id}/insights?metric=reach,saved,shares,views`,
    );
    for (const x of ins.data) {
      const v = x.total_value?.value ?? x.values?.[0]?.value;
      if (v === undefined) continue;
      if (x.name === "reach") out.reach = v;
      if (x.name === "saved") out.saves = v;
      if (x.name === "shares") out.shares = v;
      if (x.name === "views") out.views = v;
    }
  } catch {
    // Insights need instagram_manage_insights and aren't available for every media type.
  }
  return out;
}

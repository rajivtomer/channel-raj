"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { getPlaylistsAction } from "@/app/actions/channels";
import { deletePostAction, duplicatePostAction, retryTargetAction, savePostAction, type SavePostResult } from "@/app/actions/posts";
import type { MediaAsset, Post, PostTarget, TargetOptions } from "@/db/schema";
import type { PublicChannel } from "@/lib/channels";
import { countHashtags, LIMITS, validateTarget, YOUTUBE_CATEGORIES } from "@/lib/rules";
import { PLATFORM_LABEL, PlatformIcon } from "../icons";
import { MediaLibrary } from "../media/MediaLibrary";
import { MediaThumb } from "../media/MediaThumb";
import { StatusBadge } from "../StatusBadge";

interface TargetDraft {
  caption: string | null;
  options: TargetOptions;
}

type PostWithTargets = Post & { targets: PostTarget[] };

const EDITABLE: Post["status"][] = ["draft", "scheduled", "failed"];

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultsFor(channel: PublicChannel): TargetOptions {
  const yt = channel.settings.youtube;
  if (channel.platform === "youtube")
    return {
      youtube: {
        privacy: yt?.privacy ?? "public",
        categoryId: yt?.categoryId ?? "22",
        tags: yt?.tags ?? "",
        madeForKids: yt?.madeForKids ?? false,
        playlistId: yt?.playlistId,
        notifySubscribers: yt?.notifySubscribers ?? true,
      },
    };
  if (channel.platform === "instagram") return { instagram: { format: "feed", shareToFeed: true } };
  return {};
}

export function Composer({
  channels,
  library,
  post,
  userId,
  blob,
  initialDate,
  flash,
}: {
  channels: PublicChannel[];
  library: MediaAsset[];
  post: PostWithTargets | null;
  userId: string;
  blob: boolean;
  initialDate?: string;
  flash?: string;
}) {
  const router = useRouter();
  const readOnly = post ? !EDITABLE.includes(post.status) : false;
  const [known, setKnown] = useState<Record<string, MediaAsset>>(() => Object.fromEntries(library.map((m) => [m.id, m])));
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [mediaIds, setMediaIds] = useState<string[]>(post?.mediaIds ?? []);
  const [targets, setTargets] = useState<Record<string, TargetDraft>>(() =>
    Object.fromEntries((post?.targets ?? []).map((t) => [t.channelId, { caption: t.caption, options: t.options }])),
  );
  const [mode, setMode] = useState<"now" | "schedule" | "draft">(post?.status === "scheduled" || initialDate ? "schedule" : "now");
  const [when, setWhen] = useState(() => {
    if (post?.scheduledAt && new Date(post.scheduledAt) > new Date()) return toLocalInput(new Date(post.scheduledAt));
    const picked = initialDate ? new Date(`${initialDate}T10:00`) : null;
    return toLocalInput(picked && picked > new Date() ? picked : new Date(Date.now() + 3600_000));
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [result, setResult] = useState<SavePostResult | undefined>(flash ? { ok: true, postId: post?.id ?? "", message: flash } : undefined);
  const [pending, start] = useTransition();
  const [previewId, setPreviewId] = useState<string>();

  const media = mediaIds.map((id) => known[id]).filter((m): m is MediaAsset => Boolean(m));
  const selected = channels.filter((c) => targets[c.id]);
  const errorsFor = (c: PublicChannel) => {
    const t = targets[c.id]!;
    return validateTarget(c.platform, t.caption ?? caption, media, t.options);
  };
  const allErrors = useMemo(() => Object.fromEntries(selected.map((c) => [c.id, errorsFor(c)])), [selected, caption, media, targets]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocking = mode !== "draft" && (selected.length === 0 || Object.values(allErrors).some((e) => e.length));

  function toggleChannel(c: PublicChannel) {
    setTargets((cur) => {
      const next = { ...cur };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = { caption: null, options: defaultsFor(c) };
      return next;
    });
  }
  const patchTarget = (id: string, patch: Partial<TargetDraft>) => setTargets((cur) => ({ ...cur, [id]: { ...cur[id]!, ...patch } }));
  const patchOptions = (id: string, fn: (o: TargetOptions) => TargetOptions) =>
    setTargets((cur) => ({ ...cur, [id]: { ...cur[id]!, options: fn(cur[id]!.options) } }));

  function submit() {
    setResult(undefined);
    start(async () => {
      const res = await savePostAction({
        id: post?.id,
        caption,
        mediaIds,
        targets: selected.map((c) => ({ channelId: c.id, caption: targets[c.id]!.caption, options: targets[c.id]!.options })),
        mode,
        scheduledAt: mode === "schedule" ? new Date(when).toISOString() : undefined,
      });
      const message =
        res.ok && mode === "schedule"
          ? `Scheduled for ${new Date(when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`
          : res.message;
      setResult({ ...res, message });
      if (res.ok || "postId" in res) {
        const id = (res as { postId?: string }).postId;
        if (id) router.replace(`/compose?id=${id}&saved=${encodeURIComponent(message)}`);
        router.refresh();
      }
    });
  }

  if (readOnly && post) return <PostStatusView post={post} channels={channels} media={media} flash={flash} />;

  const previewChannel = selected.find((c) => c.id === previewId) ?? selected[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        {/* Channels */}
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Post to</h2>
          {channels.length ? (
            <div className="flex flex-wrap gap-2">
              {channels.map((c) => {
                const on = Boolean(targets[c.id]);
                const bad = on && allErrors[c.id]?.length && mode !== "draft";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    aria-pressed={on}
                    className={`flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition ${
                      on ? (bad ? "border-red-500/60 bg-red-500/5" : "border-brand bg-brand/10") : "border-line bg-panel opacity-70 hover:opacity-100"
                    }`}
                  >
                    <span className="relative">
                      {c.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
                      ) : (
                        <span className="block size-7 rounded-full bg-bg" />
                      )}
                      <PlatformIcon platform={c.platform} className="absolute -right-1 -bottom-1 size-3.5" />
                    </span>
                    <span className="max-w-40 truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No channels connected yet. <Link className="text-brand hover:underline" href="/settings/api">Connect one</Link> first.
            </p>
          )}
        </section>

        {/* Media */}
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Media</h2>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setPickerOpen(true)}>
              {media.length ? "Change" : "Add photos or video"}
            </button>
          </div>
          {media.length ? (
            <ol className="flex gap-3 overflow-x-auto pb-1">
              {media.map((m, i) => (
                <li key={m.id} className="relative w-28 shrink-0">
                  <MediaThumb asset={m} className="aspect-square rounded-lg" />
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted">{i + 1}</span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Move left"
                        disabled={i === 0}
                        className="px-1 disabled:opacity-30"
                        onClick={() => setMediaIds((ids) => { const n = [...ids]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; })}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="Move right"
                        disabled={i === media.length - 1}
                        className="px-1 disabled:opacity-30"
                        onClick={() => setMediaIds((ids) => { const n = [...ids]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n; })}
                      >
                        →
                      </button>
                      <button type="button" aria-label="Remove" className="px-1 text-red-600 dark:text-red-400" onClick={() => setMediaIds((ids) => ids.filter((x) => x !== m.id))}>
                        ✕
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">YouTube needs one video. Instagram needs at least one photo or video. Facebook can post text only.</p>
          )}
        </section>

        {/* Caption */}
        <section className="card p-5">
          <label htmlFor="caption" className="mb-2 block text-sm font-semibold">Caption</label>
          <textarea
            id="caption"
            className="input min-h-36 resize-y"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write once. Customize per platform below if you need to."
          />
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-muted">
            <span>{caption.length} characters</span>
            <span className={countHashtags(caption) > LIMITS.instagramHashtags ? "text-red-600" : ""}>{countHashtags(caption)} hashtags</span>
            {selected.some((c) => c.settings.defaultHashtags || c.settings.captionSuffix) && <span>Channel default hashtags are added when posting.</span>}
          </p>
        </section>

        {/* Per channel */}
        {selected.map((c) => (
          <TargetCard
            key={c.id}
            channel={c}
            draft={targets[c.id]!}
            mainCaption={caption}
            errors={mode === "draft" ? [] : (result && !result.ok && result.targetErrors?.[c.id]) || allErrors[c.id] || []}
            library={Object.values(known)}
            onCaption={(v) => patchTarget(c.id, { caption: v })}
            onOptions={(fn) => patchOptions(c.id, fn)}
          />
        ))}
      </div>

      {/* Side panel */}
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">When</h2>
          <div className="space-y-2 text-sm">
            {(["now", "schedule", "draft"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === "now" ? "Publish now" : m === "schedule" ? "Schedule" : "Save as draft"}
              </label>
            ))}
          </div>
          {mode === "schedule" && (
            <input type="datetime-local" className="input mt-3" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
          )}
          {result && (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}
            >
              {result.message}
            </p>
          )}
          <button type="button" className="btn-primary mt-4 w-full" disabled={pending || blocking} onClick={submit}>
            {pending ? (mode === "now" ? "Publishing…" : "Saving…") : mode === "now" ? `Publish to ${selected.length || ""} ${selected.length === 1 ? "channel" : "channels"}` : mode === "schedule" ? "Schedule" : "Save draft"}
          </button>
          {blocking && selected.length > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Fix the issues marked on each channel first.</p>}
          {post && (
            <div className="mt-4 flex gap-2 border-t border-line pt-4">
              <DuplicateButton postId={post.id} />
              <DeleteButton postId={post.id} />
            </div>
          )}
        </section>

        {previewChannel && (
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Preview</h2>
              {selected.length > 1 && (
                <select className="input w-auto py-1 text-xs" value={previewChannel.id} onChange={(e) => setPreviewId(e.target.value)}>
                  {selected.map((c) => (
                    <option key={c.id} value={c.id}>{PLATFORM_LABEL[c.platform]} · {c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <Preview channel={previewChannel} caption={targets[previewChannel.id]?.caption ?? caption} media={media} options={targets[previewChannel.id]!.options} />
          </section>
        )}
        {post && post.targets.some((t) => t.status !== "pending") && <TargetStatusList post={post} channels={channels} />}
      </aside>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={() => setPickerOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-bg p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Choose media <span className="text-sm font-normal text-muted">({mediaIds.length} selected)</span></h2>
              <button type="button" className="btn-primary" onClick={() => setPickerOpen(false)}>Done</button>
            </div>
            <MediaLibrary
              initial={Object.values(known).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))}
              userId={userId}
              blob={blob}
              selectable
              selected={mediaIds}
              onToggle={(a) => {
                setKnown((k) => ({ ...k, [a.id]: a }));
                setMediaIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id].slice(0, 10)));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TargetCard({
  channel,
  draft,
  mainCaption,
  errors,
  library,
  onCaption,
  onOptions,
}: {
  channel: PublicChannel;
  draft: TargetDraft;
  mainCaption: string;
  errors: string[];
  library: MediaAsset[];
  onCaption: (v: string | null) => void;
  onOptions: (fn: (o: TargetOptions) => TargetOptions) => void;
}) {
  const custom = draft.caption !== null;
  const o = draft.options;
  const limit = channel.platform === "instagram" ? LIMITS.instagramCaption : channel.platform === "youtube" ? LIMITS.youtubeDescription : LIMITS.facebookCaption;
  const text = draft.caption ?? mainCaption;
  return (
    <section className={`card overflow-hidden ${errors.length ? "border-red-500/40" : ""}`}>
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <PlatformIcon platform={channel.platform} />
        <h3 className="flex-1 truncate text-sm font-semibold">{channel.name}</h3>
        <span className={`text-xs tabular-nums ${text.length > limit ? "text-red-600" : "text-muted"}`}>{text.length}/{limit}</span>
      </header>
      <div className="space-y-4 p-5">
        {errors.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        {channel.platform === "youtube" && (
          <YouTubeFields channelId={channel.id} o={o} library={library} onOptions={onOptions} />
        )}

        {channel.platform === "instagram" && (
          <div>
            <span className="label">Post as</span>
            <div className="flex flex-wrap gap-2">
              {(["feed", "reel", "story"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onOptions((x) => ({ ...x, instagram: { ...x.instagram, format: f } }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${ (o.instagram?.format ?? "feed") === f ? "border-brand bg-brand/10 text-brand" : "border-line"}`}
                >
                  {f === "feed" ? "Post / carousel" : f === "reel" ? "Reel" : "Story"}
                </button>
              ))}
            </div>
            {o.instagram?.format === "reel" && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={o.instagram?.shareToFeed ?? true}
                  onChange={(e) => onOptions((x) => ({ ...x, instagram: { ...x.instagram, shareToFeed: e.target.checked } }))}
                />
                Also show in the main feed
              </label>
            )}
          </div>
        )}

        {channel.platform === "facebook" && (
          <div>
            <label className="label" htmlFor={`${channel.id}-link`}>Link (optional, text posts only)</label>
            <input
              id={`${channel.id}-link`}
              className="input"
              placeholder="https://"
              value={o.facebook?.link ?? ""}
              onChange={(e) => onOptions((x) => ({ ...x, facebook: { link: e.target.value } }))}
            />
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={custom} onChange={(e) => onCaption(e.target.checked ? mainCaption : null)} />
            {channel.platform === "youtube" ? "Custom description for this channel" : "Custom caption for this channel"}
          </label>
          {custom && <textarea className="input mt-2 min-h-28" value={draft.caption ?? ""} onChange={(e) => onCaption(e.target.value)} />}
        </div>

        {!(channel.platform === "instagram" && o.instagram?.format === "story") && (
          <div>
            <label className="label" htmlFor={`${channel.id}-comment`}>First comment (optional)</label>
            <input
              id={`${channel.id}-comment`}
              className="input"
              placeholder={channel.settings.firstComment ? `Default: ${channel.settings.firstComment}` : "Posted right after publishing"}
              value={o.firstComment ?? ""}
              onChange={(e) => onOptions((x) => ({ ...x, firstComment: e.target.value || undefined }))}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function YouTubeFields({
  channelId,
  o,
  library,
  onOptions,
}: {
  channelId: string;
  o: TargetOptions;
  library: MediaAsset[];
  onOptions: (fn: (o: TargetOptions) => TargetOptions) => void;
}) {
  const yt = o.youtube ?? {};
  const set = (patch: Partial<NonNullable<TargetOptions["youtube"]>>) => onOptions((x) => ({ ...x, youtube: { ...x.youtube, ...patch } }));
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[] | null>(null);
  useEffect(() => {
    getPlaylistsAction(channelId).then(setPlaylists).catch(() => setPlaylists([]));
  }, [channelId]);
  const images = library.filter((m) => m.kind === "image");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${channelId}-title`}>Title</label>
        <input id={`${channelId}-title`} className="input" maxLength={100} value={yt.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
        <p className="mt-1 text-right text-xs text-muted">{(yt.title ?? "").length}/100</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${channelId}-tags`}>Tags (comma separated)</label>
        <input id={`${channelId}-tags`} className="input" value={yt.tags ?? ""} onChange={(e) => set({ tags: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`${channelId}-privacy`}>Visibility</label>
        <select id={`${channelId}-privacy`} className="input" value={yt.privacy ?? "public"} onChange={(e) => set({ privacy: e.target.value as "public" })}>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${channelId}-cat`}>Category</label>
        <select id={`${channelId}-cat`} className="input" value={yt.categoryId ?? "22"} onChange={(e) => set({ categoryId: e.target.value })}>
          {YOUTUBE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${channelId}-pl`}>Playlist</label>
        <select id={`${channelId}-pl`} className="input" value={yt.playlistId ?? ""} onChange={(e) => set({ playlistId: e.target.value || undefined })}>
          <option value="">{playlists === null ? "Loading…" : "None"}</option>
          {playlists?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={`${channelId}-thumb`}>Custom thumbnail</label>
        <select id={`${channelId}-thumb`} className="input" value={yt.thumbnailAssetId ?? ""} onChange={(e) => set({ thumbnailAssetId: e.target.value || undefined })}>
          <option value="">Auto (from video)</option>
          {images.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(yt.madeForKids)} onChange={(e) => set({ madeForKids: e.target.checked })} />
        Made for kids
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={yt.notifySubscribers ?? true} onChange={(e) => set({ notifySubscribers: e.target.checked })} />
        Notify subscribers
      </label>
    </div>
  );
}

function Preview({ channel, caption, media, options }: { channel: PublicChannel; caption: string; media: MediaAsset[]; options: TargetOptions }) {
  const [expanded, setExpanded] = useState(false);
  const first = media[0];
  const short = caption.length > 140 && !expanded;
  const handle = channel.handle ? (channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`) : channel.name;
  const story = channel.platform === "instagram" && options.instagram?.format === "story";
  const vertical = story || (channel.platform === "instagram" && options.instagram?.format === "reel");
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        {channel.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
        ) : (
          <span className="size-7 rounded-full bg-bg" />
        )}
        <span className="truncate font-medium">{channel.platform === "instagram" ? handle.replace("@", "") : channel.name}</span>
        <PlatformIcon platform={channel.platform} className="ml-auto size-4" />
      </div>
      {channel.platform === "youtube" && first && <MediaThumb asset={first} className="aspect-video" />}
      {channel.platform !== "youtube" && first && <MediaThumb asset={first} className={vertical ? "aspect-[9/16] max-h-96 w-full" : "aspect-square"} />}
      {media.length > 1 && channel.platform !== "youtube" && <p className="px-3 pt-1 text-center text-xs text-muted">1 of {media.length}</p>}
      <div className="space-y-1 px-3 py-2">
        {channel.platform === "youtube" && <p className="font-semibold">{options.youtube?.title || "Untitled video"}</p>}
        {!story && (
          <p className="whitespace-pre-wrap break-words text-[13px]">
            {short ? caption.slice(0, 140) + "… " : caption}
            {short && <button type="button" className="text-muted" onClick={() => setExpanded(true)}>more</button>}
            {!caption && <span className="text-muted">No caption</span>}
          </p>
        )}
      </div>
    </div>
  );
}

const TARGET_TONE = { pending: "gray", processing: "amber", published: "green", failed: "red" } as const;
const TARGET_LABEL = { pending: "Waiting", processing: "Processing", published: "Published", failed: "Failed" } as const;

function TargetStatusList({ post, channels }: { post: PostWithTargets; channels: PublicChannel[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState<string>();
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Delivery</h2>
      <ul className="divide-y divide-line">
        {post.targets.map((t) => {
          const c = channels.find((x) => x.id === t.channelId);
          return (
            <li key={t.id} className="space-y-1 px-5 py-3 text-sm">
              <div className="flex items-center gap-2">
                {c && <PlatformIcon platform={c.platform} className="size-4" />}
                <span className="min-w-0 flex-1 truncate">{c?.name ?? "Disconnected channel"}</span>
                <StatusBadge tone={TARGET_TONE[t.status]}>{TARGET_LABEL[t.status]}</StatusBadge>
              </div>
              {t.error && <p className={`text-xs ${t.status === "failed" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{t.error}</p>}
              <div className="flex gap-3 text-xs">
                {t.externalUrl && <a className="text-brand hover:underline" href={t.externalUrl} target="_blank" rel="noreferrer">View post ↗</a>}
                {t.status === "failed" && (
                  <button
                    type="button"
                    className="text-brand hover:underline disabled:opacity-50"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await retryTargetAction(t.id);
                        setNote(r.message);
                        router.refresh();
                      })
                    }
                  >
                    {pending ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {note && <p className="border-t border-line px-5 py-2 text-xs text-muted">{note}</p>}
    </section>
  );
}

function PostStatusView({ post, channels, media, flash }: { post: PostWithTargets; channels: PublicChannel[]; media: MediaAsset[]; flash?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="card space-y-4 p-5">
        {flash && <p role="status" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{flash}</p>}
        <p className="text-sm text-muted">
          {post.publishedAt ? `Published ${new Date(post.publishedAt).toLocaleString()}` : "Publishing in progress"}. Posts that have gone out can’t be edited here; duplicate to reuse it.
        </p>
        {media.length > 0 && (
          <div className="flex gap-3 overflow-x-auto">
            {media.map((m) => <MediaThumb key={m.id} asset={m} className="aspect-square w-28 shrink-0 rounded-lg" />)}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm">{post.caption || <span className="text-muted">No caption</span>}</p>
        <div className="flex gap-2 border-t border-line pt-4">
          <DuplicateButton postId={post.id} />
          <DeleteButton postId={post.id} label="Remove from history" />
        </div>
      </section>
      <aside><TargetStatusList post={post} channels={channels} /></aside>
    </div>
  );
}

function DuplicateButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-ghost flex-1"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await duplicatePostAction(postId);
          if (r.postId) router.push(`/compose?id=${r.postId}`);
        })
      }
    >
      Duplicate
    </button>
  );
}

function DeleteButton({ postId, label = "Delete" }: { postId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-danger flex-1"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this post from Channel Toolkit? Anything already published stays on the platforms.")) return;
        start(async () => {
          await deletePostAction(postId);
          router.push("/calendar?view=queue");
        });
      }}
    >
      {label}
    </button>
  );
}


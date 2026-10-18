"use client";

import { useEffect, useState, useTransition } from "react";
import { getPlaylistsAction, getProfileAction, saveChannelSettingsAction, saveProfileAction, type ProfileData } from "@/app/actions/channels";
import type { ChannelSettings } from "@/db/schema";
import type { PublicChannel } from "@/lib/channels";
import { YOUTUBE_CATEGORIES } from "@/lib/rules";

type Result = { ok: boolean; message: string } | undefined;

function Flash({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}>
      {r.message}
    </p>
  );
}

export function ChannelSettingsForm({ channel }: { channel: PublicChannel }) {
  const [s, setS] = useState<ChannelSettings>(channel.settings);
  const [result, setResult] = useState<Result>();
  const [pending, start] = useTransition();
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (channel.platform === "youtube") getPlaylistsAction(channel.id).then(setPlaylists).catch(() => undefined);
  }, [channel]);
  const yt = s.youtube ?? {};
  const setYt = (patch: Partial<NonNullable<ChannelSettings["youtube"]>>) => setS((x) => ({ ...x, youtube: { ...x.youtube, ...patch } }));

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await saveChannelSettingsAction(channel.id, s)));
      }}
    >
      <div>
        <h2 className="font-semibold">Posting defaults</h2>
        <p className="text-sm text-muted">Applied to every post on this channel.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tags">Hashtags to add to every post</label>
          <input id="tags" className="input" placeholder="#brand #daily" value={s.defaultHashtags ?? ""} onChange={(e) => setS({ ...s, defaultHashtags: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="suffix">Text to add at the end (signature, links)</label>
          <textarea id="suffix" className="input min-h-20" value={s.captionSuffix ?? ""} onChange={(e) => setS({ ...s, captionSuffix: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="fc">Default first comment</label>
          <input id="fc" className="input" value={s.firstComment ?? ""} onChange={(e) => setS({ ...s, firstComment: e.target.value })} />
        </div>
        {channel.platform === "youtube" && (
          <>
            <div>
              <label className="label" htmlFor="privacy">Default visibility</label>
              <select id="privacy" className="input" value={yt.privacy ?? "public"} onChange={(e) => setYt({ privacy: e.target.value as "public" })}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cat">Default category</label>
              <select id="cat" className="input" value={yt.categoryId ?? "22"} onChange={(e) => setYt({ categoryId: e.target.value })}>
                {YOUTUBE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pl">Default playlist</label>
              <select id="pl" className="input" value={yt.playlistId ?? ""} onChange={(e) => setYt({ playlistId: e.target.value || undefined })}>
                <option value="">None</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="yttags">Default tags</label>
              <input id="yttags" className="input" value={yt.tags ?? ""} onChange={(e) => setYt({ tags: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(yt.madeForKids)} onChange={(e) => setYt({ madeForKids: e.target.checked })} />
              Videos are made for kids
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={yt.notifySubscribers ?? true} onChange={(e) => setYt({ notifySubscribers: e.target.checked })} />
              Notify subscribers
            </label>
          </>
        )}
      </div>
      <Flash r={result} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save defaults"}</button>
    </form>
  );
}

export function ChannelProfileForm({ channel }: { channel: PublicChannel }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [pending, start] = useTransition();
  useEffect(() => {
    getProfileAction(channel.id).then((r) => (r.ok ? setData(r.data) : setLoadError(r.message)));
  }, [channel.id]);

  const title = channel.platform === "youtube" ? "Channel profile" : channel.platform === "facebook" ? "Page details" : "Profile";
  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">Live from {channel.platform === "youtube" ? "YouTube" : channel.platform === "facebook" ? "Facebook" : "Instagram"}. Changes are saved straight to the platform.</p>
      </div>
      {loadError && <Flash r={{ ok: false, message: `Couldn't load: ${loadError}` }} />}
      {!data && !loadError && <p className="text-sm text-muted">Loading…</p>}
      {data?.platform === "instagram" && (
        <>
          <dl className="space-y-3 text-sm">
            <div><dt className="label">Bio</dt><dd className="whitespace-pre-wrap">{data.biography || "—"}</dd></div>
            <div><dt className="label">Website</dt><dd>{data.website || "—"}</dd></div>
            <div><dt className="label">Posts</dt><dd>{data.mediaCount ?? "—"}</dd></div>
          </dl>
          <p className="text-xs text-muted">Instagram doesn’t allow apps to edit the bio or website. Change them in the Instagram app.</p>
        </>
      )}
      {(data?.platform === "youtube" || data?.platform === "facebook") && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const { platform, ...rest } = data;
            start(async () => setResult(await saveProfileAction(channel.id, { platform, ...rest } as never)));
          }}
        >
          {data.platform === "youtube" ? (
            <>
              <div>
                <label className="label" htmlFor="desc">Channel description</label>
                <textarea id="desc" className="input min-h-32" maxLength={1000} value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="kw">Channel keywords</label>
                <input id="kw" className="input" value={data.keywords} onChange={(e) => setData({ ...data, keywords: e.target.value })} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="about">Short about (255 characters)</label>
                <input id="about" className="input" maxLength={255} value={data.about} onChange={(e) => setData({ ...data, about: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="fdesc">Description</label>
                <textarea id="fdesc" className="input min-h-28" value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="web">Website</label>
                  <input id="web" className="input" value={data.website} onChange={(e) => setData({ ...data, website: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" className="input" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <Flash r={result} />
          <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : `Save to ${data.platform === "youtube" ? "YouTube" : "Facebook"}`}</button>
        </form>
      )}
    </section>
  );
}

import Link from "next/link";
import { InboxList } from "@/components/inbox/InboxList";
import { RefreshInboxButton } from "@/components/inbox/RefreshInboxButton";
import { PLATFORM_LABEL } from "@/components/icons";
import type { InboxStatus, Platform } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { getCredential } from "@/lib/credentials";
import { inboxCounts, listInbox } from "@/lib/inbox";

export const metadata = { title: "Inbox" };
export const maxDuration = 60;

const STATUSES: { key: InboxStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "hidden", label: "Hidden" },
];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string; platform?: string; channel?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = (STATUSES.find((s) => s.key === sp.status)?.key ?? "open") as InboxStatus;
  const platform = (["youtube", "facebook", "instagram"] as Platform[]).find((p) => p === sp.platform);
  const channelId = sp.channel && /^[0-9a-f-]{36}$/.test(sp.channel) ? sp.channel : undefined;
  const q = sp.q?.slice(0, 100);
  const [items, counts, channels, ai] = await Promise.all([
    listInbox(user.id, { status, platform, channelId, q }),
    inboxCounts(user.id),
    listChannels(user.id),
    getCredential(user.id, "anthropic"),
  ]);
  const lastSync = channels
    .map((c) => c.inboxSyncedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => +b - +a)[0];
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status, platform, channel: channelId, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/inbox?${p}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted">
            Comments from every channel in one place.{" "}
            {lastSync ? `Last checked ${lastSync.toLocaleString("en", { timeZone: user.preferences.timezone || "UTC", dateStyle: "medium", timeStyle: "short" })}.` : "Not checked yet."}
          </p>
        </div>
        <RefreshInboxButton />
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex rounded-lg border border-line bg-panel p-0.5 text-sm" aria-label="Status">
          {STATUSES.map((s) => (
            <Link
              key={s.key}
              href={href({ status: s.key })}
              aria-current={status === s.key ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${status === s.key ? "bg-brand/10 font-medium text-brand" : "text-muted hover:text-ink"}`}
            >
              {s.label} <span className="tabular-nums">{counts[s.key]}</span>
            </Link>
          ))}
        </nav>
        <form className="flex flex-1 flex-wrap gap-2" action="/inbox">
          <input type="hidden" name="status" value={status} />
          <select name="platform" defaultValue={platform ?? ""} className="input w-auto" aria-label="Platform">
            <option value="">All platforms</option>
            {(["youtube", "instagram", "facebook"] as Platform[]).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          <select name="channel" defaultValue={channelId ?? ""} className="input w-auto max-w-48" aria-label="Channel">
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="Search comments" className="input min-w-0 flex-1 sm:max-w-56" />
          <button className="btn-ghost">Filter</button>
        </form>
      </div>

      {channels.length === 0 ? (
        <p className="card px-5 py-10 text-center text-sm text-muted">
          Connect a channel in <Link href="/settings/api" className="text-brand hover:underline">API &amp; channels</Link> to start receiving comments here.
        </p>
      ) : (
        <InboxList key={`${status}-${platform}-${channelId}-${q}`} items={items} status={status} aiReady={ai?.status === "valid"} tz={user.preferences.timezone || "UTC"} />
      )}
    </div>
  );
}

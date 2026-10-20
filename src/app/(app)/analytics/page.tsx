import Link from "next/link";
import { FollowerLine, Heatmap } from "@/components/analytics/Charts";
import { PLATFORM_LABEL, PlatformIcon } from "@/components/icons";
import { RefreshInboxButton } from "@/components/inbox/RefreshInboxButton";
import { getAnalytics } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { safeZone } from "@/lib/schedule";

export const metadata = { title: "Analytics" };
export const maxDuration = 60;

const RANGES = [7, 30, 90] as const;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before && !now) return null;
  if (!before) return <p className="text-xs text-muted">No posts in the {label} before</p>;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <p className={`text-xs ${up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> {Math.abs(pct).toFixed(0)}% <span className="text-muted">vs the {label} before</span>
    </p>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const tz = safeZone(user.preferences.timezone);
  const a = await getAnalytics(user.id, days, tz);
  const period = `${days} days`;
  const hasData = a.totals.posts > 0 || a.channels.some((c) => c.points.length);

  const tiles = [
    { label: "Audience", value: compact.format(a.totals.followers), sub: a.totals.growth === null ? <p className="text-xs text-muted">Growth shows after two days of data</p> : <p className="text-xs text-muted"><span className="tabular-nums text-ink">{a.totals.growth >= 0 ? "+" : ""}{full.format(a.totals.growth)}</span> in {period}</p> },
    { label: "Posts published", value: full.format(a.totals.posts), sub: <Delta now={a.totals.posts} before={a.previous.posts} label={period} /> },
    { label: "Engagement", value: compact.format(a.totals.engagement), sub: <Delta now={a.totals.engagement} before={a.previous.engagement} label={period} /> },
    { label: "Video views", value: compact.format(a.totals.views), sub: <Delta now={a.totals.views} before={a.previous.views} label={period} /> },
    { label: "Comments received", value: full.format(a.totals.comments), sub: <p className="text-xs text-muted">{a.totals.replies} answered</p> },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted">
            {a.lastSync ? `Stats updated ${new Date(a.lastSync).toLocaleString("en", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}. Refreshed hourly.` : "Stats are collected hourly once channels are connected."}
          </p>
        </div>
        <RefreshInboxButton label="Refresh stats now" />
      </header>

      <nav className="flex w-fit rounded-lg border border-line bg-panel p-0.5 text-sm" aria-label="Date range">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/analytics?days=${r}`}
            aria-current={r === days ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${r === days ? "bg-brand/10 font-medium text-brand" : "text-muted hover:text-ink"}`}
          >
            Last {r} days
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold">{t.value}</p>
            <div className="mt-1">{t.sub}</div>
          </div>
        ))}
      </div>

      {!hasData && (
        <p className="card px-5 py-8 text-center text-sm text-muted">
          Nothing to chart yet. Publish a few posts and numbers will appear here as the hourly sync collects them.
        </p>
      )}

      {a.channels.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Audience growth</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {a.channels.map((c) => (
              <div key={c.channelId} className="card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <PlatformIcon platform={c.platform} className="size-4" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</p>
                  <p className="text-sm font-semibold tabular-nums">{c.followers === null ? "–" : compact.format(c.followers)}</p>
                </div>
                <FollowerLine points={c.points} label={c.name} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">When your audience engages</h2>
        <p className="mb-4 text-sm text-muted">
          Engagement per post by the day and hour it went out ({tz.replaceAll("_", " ")}), from the last 180 days. Compose uses this to suggest best times.
        </p>
        {a.heatmap.total ? <Heatmap buckets={a.heatmap.buckets} /> : <p className="text-sm text-muted">Appears once published posts have stats.</p>}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Top posts</h2>
        {a.top.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="w-[45%] px-5 py-2 font-medium">Post</th>
                  <th className="px-3 py-2 text-right font-medium">Likes</th>
                  <th className="px-3 py-2 text-right font-medium">Comments</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-5 py-2 text-right font-medium">Engagement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.top.map((p) => (
                  <tr key={p.targetId}>
                    <td className="max-w-0 px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={p.platform} className="size-4 shrink-0" />
                        <Link href={`/compose?id=${p.postId}`} className="truncate hover:text-brand">{p.caption || "Untitled"}</Link>
                      </div>
                      <p className="truncate pl-6 text-xs text-muted">
                        {p.channelName} · {new Date(p.publishedAt).toLocaleDateString("en", { timeZone: tz, dateStyle: "medium" })}
                        {p.url && <> · <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-brand">View ↗</a></>}
                      </p>
                    </td>
                    {(["likes", "comments", "shares", "views"] as const).map((k) => (
                      <td key={k} className="px-3 py-2.5 text-right tabular-nums">{p.metrics[k] === undefined ? <span className="text-muted">–</span> : full.format(p.metrics[k]!)}</td>
                    ))}
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">{full.format(p.engagement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">No published posts in this range.</p>
        )}
      </section>

      {a.channels.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 font-semibold">By channel</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Audience</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  <th className="px-3 py-2 text-right font-medium">Posts</th>
                  <th className="px-3 py-2 text-right font-medium">Engagement</th>
                  <th className="px-5 py-2 text-right font-medium">Per post</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.channels.map((c) => (
                  <tr key={c.channelId}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2"><PlatformIcon platform={c.platform} className="size-4" /> {c.name} <span className="text-xs text-muted">{PLATFORM_LABEL[c.platform]}</span></span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.followers === null ? "–" : full.format(c.followers)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.growth === null ? "–" : `${c.growth >= 0 ? "+" : ""}${full.format(c.growth)}`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.posts}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{full.format(c.engagement)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{c.posts ? (c.engagement / c.posts).toFixed(1) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

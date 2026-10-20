import Link from "next/link";
import { MonthGrid, PostList } from "@/components/calendar/CalendarView";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { listPostsByStatus, listPostsInRange } from "@/lib/posts";
import { safeZone } from "@/lib/schedule";
import { dayKey } from "@/lib/tzfmt";

export const metadata = { title: "Calendar & queue" };

const VIEWS = [
  { key: "month", label: "Month" },
  { key: "queue", label: "Queue" },
  { key: "drafts", label: "Drafts" },
  { key: "history", label: "History" },
] as const;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; month?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "month";
  const tz = safeZone(user.preferences.timezone);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : dayKey(new Date(), tz).slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];

  const channels = await listChannels(user.id);
  const platforms = Object.fromEntries(channels.map((c) => [c.id, c.platform]));

  let content: React.ReactNode;
  if (view === "month") {
    // Pad a week either side so time zones and leading/trailing days are covered.
    const posts = await listPostsInRange(user.id, new Date(Date.UTC(y, m - 1, 1) - 8 * 864e5), new Date(Date.UTC(y, m, 1) + 8 * 864e5));
    content = <MonthGrid month={month} posts={posts} platforms={platforms} tz={tz} />;
  } else if (view === "queue") {
    const posts = (await listPostsByStatus(user.id, ["scheduled", "publishing"])).sort(
      (a, b) => +new Date(a.scheduledAt ?? 0) - +new Date(b.scheduledAt ?? 0),
    );
    content = <PostList posts={posts} platforms={platforms} tz={tz} empty="Nothing scheduled. Create a post and pick a time." />;
  } else if (view === "drafts") {
    content = <PostList posts={await listPostsByStatus(user.id, ["draft"])} platforms={platforms} tz={tz} empty="No drafts." />;
  } else {
    const posts = (await listPostsByStatus(user.id, ["published", "partial", "failed"], 200)).sort(
      (a, b) => +new Date(b.publishedAt ?? b.updatedAt) - +new Date(a.publishedAt ?? a.updatedAt),
    );
    content = <PostList posts={posts} platforms={platforms} tz={tz} empty="Nothing published yet." />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar & queue</h1>
          <p className="mt-1 text-sm text-muted">Everything planned and published, across all channels.</p>
        </div>
        <Link href="/compose" className="btn-primary">New post</Link>
      </header>
      <nav className="flex rounded-lg border border-line bg-panel p-0.5 text-sm sm:w-fit">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/calendar?view=${v.key}${v.key === "month" ? `&month=${month}` : ""}`}
            className={`flex-1 rounded-md px-3 py-1.5 text-center sm:flex-none ${view === v.key ? "bg-brand/10 font-medium text-brand" : "text-muted"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {content}
    </div>
  );
}

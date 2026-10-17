import Link from "next/link";
import { ChannelRow } from "@/components/ChannelRow";
import { PLATFORM_LABEL, PlatformIcon } from "@/components/icons";
import type { Platform } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { listCredentials } from "@/lib/credentials";

export const metadata = { title: "Overview" };

const fmt = new Intl.NumberFormat("en", { notation: "compact" });

export default async function Dashboard() {
  const user = await requireUser();
  const [channels, creds] = await Promise.all([listChannels(user.id), listCredentials(user.id)]);
  const platforms: Platform[] = ["youtube", "instagram", "facebook"];
  const needsAttention = channels.filter((c) => c.status !== "connected").length;

  const steps = [
    { done: creds.some((c) => c.status === "valid"), text: "Add and verify your API keys" },
    { done: channels.length > 0, text: "Connect your first channel" },
    { done: platforms.every((p) => channels.some((c) => c.platform === p)), text: "Connect all three platforms" },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hi {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-muted">Here’s how your channels look right now.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {platforms.map((p) => {
          const list = channels.filter((c) => c.platform === p);
          const total = list.reduce((sum, c) => sum + (c.followers ?? 0), 0);
          return (
            <div key={p} className="card p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <PlatformIcon platform={p} /> {PLATFORM_LABEL[p]}
              </div>
              <p className="mt-4 text-3xl font-semibold tabular-nums">{list.length ? fmt.format(total) : "–"}</p>
              <p className="text-xs text-muted">
                {list.length
                  ? `${p === "youtube" ? "subscribers" : "followers"} across ${list.length} ${list.length === 1 ? "account" : "accounts"}`
                  : "Not connected"}
              </p>
            </div>
          );
        })}
      </div>

      {steps.some((s) => !s.done) && (
        <section className="card p-5">
          <h2 className="font-semibold">Get set up</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {steps.map((s) => (
              <li key={s.text} className="flex items-center gap-2">
                <span className={`flex size-5 items-center justify-center rounded-full text-[11px] ${s.done ? "bg-emerald-500 text-white" : "border border-line"}`}>
                  {s.done ? "✓" : ""}
                </span>
                <span className={s.done ? "text-muted line-through" : ""}>{s.text}</span>
              </li>
            ))}
          </ol>
          <Link href="/settings/api" className="btn-primary mt-4">Open API & channels</Link>
        </section>
      )}

      <section className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">Channels</h2>
          {needsAttention > 0 && <span className="text-xs text-red-600 dark:text-red-400">{needsAttention} need attention</span>}
        </header>
        {channels.length ? (
          <ul className="divide-y divide-line">
            {channels.map((c) => (
              <ChannelRow key={c.id} channel={c} manage={false} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">No channels connected yet.</p>
        )}
      </section>
    </div>
  );
}

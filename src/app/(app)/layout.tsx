import { after } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { TimezoneSync } from "@/components/TimezoneSync";
import { requireUser } from "@/lib/auth";
import { runRecycleDue } from "@/lib/automations";
import { inboxCounts } from "@/lib/inbox";
import { runPublisher } from "@/lib/publish/engine";
import { runSync } from "@/lib/sync";

// Between scheduler runs, catch up on this user's due work whenever they use the app.
const lastRun = new Map<string, number>();
const lastSync = new Map<string, number>();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const now = Date.now();
  if (now - (lastRun.get(user.id) ?? 0) > 60_000) {
    lastRun.set(user.id, now);
    after(() => runPublisher({ userId: user.id, limit: 5 }).catch(() => undefined));
  }
  if (now - (lastSync.get(user.id) ?? 0) > 5 * 60_000) {
    lastSync.set(user.id, now);
    after(async () => {
      await runRecycleDue({ userId: user.id, limit: 3 }).catch(() => undefined);
      await runSync({ userId: user.id, limit: 5, deadline: Date.now() + 40_000 }).catch(() => undefined);
    });
  }
  const counts = await inboxCounts(user.id);
  return (
    <div className="md:flex">
      <Sidebar user={{ name: user.name, email: user.email }} inboxOpen={counts.open} />
      <TimezoneSync known={Boolean(user.preferences.timezone)} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

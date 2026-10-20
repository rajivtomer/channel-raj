import { after } from "next/server";
import { Sidebar } from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { runPublisher } from "@/lib/publish/engine";

// Between scheduler runs, catch up on this user's due posts whenever they use the app.
const lastRun = new Map<string, number>();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (Date.now() - (lastRun.get(user.id) ?? 0) > 60_000) {
    lastRun.set(user.id, Date.now());
    after(() => runPublisher({ userId: user.id, limit: 5 }).catch(() => undefined));
  }
  return (
    <div className="md:flex">
      <Sidebar user={{ name: user.name, email: user.email }} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

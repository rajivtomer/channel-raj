import { desc, eq } from "drizzle-orm";
import { AutomationsView } from "@/components/automations/AutomationsView";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { listChannels } from "@/lib/channels";
import { getCredential } from "@/lib/credentials";

export const metadata = { title: "Automations" };
export const maxDuration = 120;

export default async function AutomationsPage() {
  const user = await requireUser();
  const db = await getDb();
  const [rules, log, channels, ai] = await Promise.all([
    db.select().from(schema.automations).where(eq(schema.automations.userId, user.id)).orderBy(schema.automations.createdAt),
    db.select().from(schema.automationLog).where(eq(schema.automationLog.userId, user.id)).orderBy(desc(schema.automationLog.createdAt)).limit(40),
    listChannels(user.id),
    getCredential(user.id, "anthropic"),
  ]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="mt-1 text-sm text-muted">
          Rules that run on their own, around the clock. Comment rules act on new comments within minutes; they never touch comments from before a rule was turned on.
        </p>
      </header>
      <AutomationsView
        rules={rules}
        log={log}
        channels={channels.map((c) => ({ id: c.id, name: c.name, platform: c.platform }))}
        aiReady={ai?.status === "valid"}
        tz={user.preferences.timezone || "UTC"}
      />
    </div>
  );
}

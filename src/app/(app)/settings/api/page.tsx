import { ChannelRow } from "@/components/ChannelRow";
import { CheckAllButton } from "@/components/CheckAllButton";
import { AiSettingsCard } from "@/components/AiSettingsCard";
import { CredentialCard, type CredentialView } from "@/components/CredentialCard";
import type { OAuthProvider } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { listChannels, providerFor } from "@/lib/channels";
import { PROVIDERS, redirectUri } from "@/lib/config";
import { decrypt, mask } from "@/lib/crypto";
import { listCredentials } from "@/lib/credentials";
import { safeZone } from "@/lib/schedule";

export const metadata = { title: "API & channels" };

export default async function ApiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; provider?: string; error?: string; welcome?: string }>;
}) {
  const user = await requireUser();
  const [creds, channels, sp] = await Promise.all([listCredentials(user.id), listChannels(user.id), searchParams]);

  const views: CredentialView[] = (Object.keys(PROVIDERS) as OAuthProvider[]).map((provider) => {
    const meta = PROVIDERS[provider];
    const row = creds.find((c) => c.provider === provider);
    return {
      provider,
      ...meta,
      redirectUri: redirectUri(provider),
      saved: row
        ? {
            clientId: row.clientId,
            secretHint: mask(decrypt(row.clientSecretEnc)),
            status: row.status,
            statusMessage: row.statusMessage,
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
          }
        : null,
      channelCount: channels.filter((c) => providerFor(c.platform) === provider).length,
    };
  });

  const ai = creds.find((c) => c.provider === "anthropic");
  const n = Number(sp.connected);
  const flash = sp.error
    ? { ok: false, text: sp.error }
    : n
      ? { ok: true, text: `Connected ${n} ${n === 1 ? "channel" : "channels"} from ${sp.provider === "google" ? "YouTube" : "Facebook and Instagram"}.` }
      : sp.welcome
        ? { ok: true, text: "Your account is ready. Add your API keys below to connect your first channel." }
        : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">API & channels</h1>
        <p className="mt-1 text-sm text-muted">
          Use your own developer apps to connect channels. Secrets and tokens are encrypted before they are stored.
        </p>
      </header>

      {flash && (
        <p
          role="status"
          className={`rounded-lg px-4 py-3 text-sm ${flash.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}
        >
          {flash.text}
        </p>
      )}

      {views.map((v) => (
        <CredentialCard key={v.provider} view={v} />
      ))}

      <AiSettingsCard
        view={{
          saved: ai ? { hint: mask(decrypt(ai.clientSecretEnc)), status: ai.status, message: ai.statusMessage } : null,
          brandVoice: user.preferences.brandVoice ?? "",
          timezone: safeZone(user.preferences.timezone),
        }}
      />

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Connected channels</h2>
            <p className="text-xs text-muted">Check confirms each token still works and refreshes follower counts.</p>
          </div>
          {channels.length > 0 && <CheckAllButton />}
        </header>
        {channels.length ? (
          <ul className="divide-y divide-line">
            {channels.map((c) => (
              <ChannelRow key={c.id} channel={c} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">
            No channels yet. Save your API keys above, then press Connect.
          </p>
        )}
      </section>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { deleteAiKeyAction, saveAiKeyAction, savePreferencesAction } from "@/app/actions/ai";
import type { CredentialStatus } from "@/db/schema";
import { StatusBadge } from "./StatusBadge";

type Result = { ok: boolean; message: string } | undefined;

export interface AiView {
  saved: null | { hint: string; status: CredentialStatus; message: string | null };
  brandVoice: string;
  timezone: string;
}

function Flash({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}>
      {r.message}
    </p>
  );
}

export function AiSettingsCard({ view }: { view: AiView }) {
  const [state, formAction, saving] = useActionState<Result, FormData>(saveAiKeyAction, undefined);
  const [editing, setEditing] = useState(!view.saved);
  const [note, setNote] = useState<Result>();
  const [busy, start] = useTransition();
  const [voice, setVoice] = useState(view.brandVoice);
  const [tz, setTz] = useState(view.timezone);
  const [prefNote, setPrefNote] = useState<Result>();
  const [zones, setZones] = useState<string[]>([view.timezone]);
  useEffect(() => {
    if (state && view.saved) setEditing(false);
  }, [state, view.saved]);
  useEffect(() => {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    setZones([...new Set(["UTC", view.timezone, ...list])]);
  }, [view.timezone]);

  const s = view.saved;
  const tone = !s ? "gray" : s.status === "valid" ? "green" : s.status === "invalid" ? "red" : "amber";
  const label = !s ? "Not set up" : s.status === "valid" ? "Verified" : s.status === "invalid" ? "Invalid" : "Not verified";

  return (
    <section className="card overflow-hidden" id="ai">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand/15 text-sm text-brand" aria-hidden>✦</span>
        <div className="flex-1">
          <h2 className="font-semibold">AI assistant (Anthropic Claude)</h2>
          <p className="text-xs text-muted">Writes captions, tailors posts per platform, drafts comment replies and powers smart automations.</p>
        </div>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </header>
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          {s && !editing ? (
            <>
              <div>
                <p className="label">API key</p>
                <p className="font-mono text-xs">{s.hint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => setEditing(true)}>Replace key</button>
                <button
                  className="btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Remove your Anthropic key? AI features and AI automations will stop working.")) start(async () => setNote(await deleteAiKeyAction()));
                  }}
                >
                  Remove
                </button>
              </div>
            </>
          ) : (
            <form
              action={(fd) => {
                setNote(undefined);
                formAction(fd);
              }}
              className="space-y-3"
            >
              <div>
                <label className="label" htmlFor="ai-key">Anthropic API key</label>
                <input
                  id="ai-key"
                  name="apiKey"
                  type="password"
                  className="input font-mono"
                  placeholder={s ? `Leave blank to keep ${s.hint}` : "sk-ant-…"}
                  required={!s}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={saving}>{saving ? "Verifying…" : "Save and verify"}</button>
                {s && <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
              </div>
            </form>
          )}
          <Flash r={note ?? state ?? (s?.message ? { ok: s.status === "valid", message: s.message } : undefined)} />
          <p className="text-xs text-muted">
            Get a key at{" "}
            <a className="text-brand hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
            Usage is billed to your Anthropic account. The key is encrypted before it is stored.
          </p>
        </div>

        <form
          className="min-w-0 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => setPrefNote(await savePreferencesAction({ brandVoice: voice, timezone: tz })));
          }}
        >
          <div>
            <label className="label" htmlFor="voice">Brand voice</label>
            <textarea
              id="voice"
              className="input min-h-24"
              maxLength={1500}
              placeholder="e.g. Warm and upbeat, speaks to busy parents, light humour, never salesy. Uses British spelling."
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="tz">Your time zone</label>
            <select id="tz" className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted">Used for queue times, best-time suggestions and analytics.</p>
          </div>
          <Flash r={prefNote} />
          <button className="btn-ghost" disabled={busy}>Save voice and time zone</button>
        </form>
      </div>
    </section>
  );
}

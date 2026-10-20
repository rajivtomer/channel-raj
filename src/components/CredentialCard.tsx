"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  deleteCredentialAction,
  reverifyCredentialAction,
  saveCredentialAction,
  type ActionResult,
} from "@/app/actions/settings";
import type { CredentialStatus, OAuthProvider, Platform } from "@/db/schema";
import { PlatformIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

export interface CredentialView {
  provider: OAuthProvider;
  label: string;
  platforms: Platform[];
  clientIdLabel: string;
  clientSecretLabel: string;
  consoleUrl: string;
  setupSteps: string[];
  redirectUri: string;
  saved: null | {
    clientId: string;
    secretHint: string;
    status: CredentialStatus;
    statusMessage: string | null;
    verifiedAt: string | null;
  };
  channelCount: number;
}

export function CredentialCard({ view }: { view: CredentialView }) {
  const [state, formAction, saving] = useActionState<ActionResult, FormData>(saveCredentialAction, undefined);
  const [busy, start] = useTransition();
  const [note, setNote] = useState<ActionResult>();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(!view.saved);
  const shown = note ?? state;
  // Leave edit mode once a save has gone through, so Connect appears straight away.
  useEffect(() => {
    if (state && view.saved) setEditing(false);
  }, [state, view.saved]);
  const s = view.saved;
  const tone = !s ? "gray" : s.status === "valid" ? "green" : s.status === "invalid" ? "red" : "amber";
  const statusLabel = !s ? "Not set up" : s.status === "valid" ? "Verified" : s.status === "invalid" ? "Invalid" : "Not verified";

  return (
    <section className="card overflow-hidden" id={view.provider}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex -space-x-1.5">
          {view.platforms.map((p) => (
            <PlatformIcon key={p} platform={p} className="size-7 rounded-full ring-2 ring-panel" />
          ))}
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">{view.label}</h2>
          <p className="text-xs text-muted">
            {view.channelCount ? `${view.channelCount} connected` : "No channels connected yet"}
          </p>
        </div>
        <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
      </header>

      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {s && !editing ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="label">{view.clientIdLabel}</dt>
                <dd className="truncate font-mono text-xs">{s.clientId}</dd>
              </div>
              <div>
                <dt className="label">{view.clientSecretLabel}</dt>
                <dd className="font-mono text-xs">{s.secretHint}</dd>
              </div>
            </dl>
          ) : (
            <form
              action={(fd) => {
                setNote(undefined);
                formAction(fd);
              }}
              className="space-y-3"
            >
              <input type="hidden" name="provider" value={view.provider} />
              <div>
                <label className="label" htmlFor={`${view.provider}-id`}>{view.clientIdLabel}</label>
                <input id={`${view.provider}-id`} name="clientId" className="input font-mono" defaultValue={s?.clientId} required autoComplete="off" spellCheck={false} />
              </div>
              <div>
                <label className="label" htmlFor={`${view.provider}-secret`}>{view.clientSecretLabel}</label>
                <input
                  id={`${view.provider}-secret`}
                  name="clientSecret"
                  type="password"
                  className="input font-mono"
                  placeholder={s ? `Leave blank to keep ${s.secretHint}` : ""}
                  required={!s}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={saving}>{saving ? "Verifying…" : "Save and verify"}</button>
                {s && (
                  <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                )}
              </div>
            </form>
          )}

          {(shown || s?.statusMessage) && (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                (shown ? shown.ok : s?.status === "valid")
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              {shown?.message ?? s?.statusMessage}
            </p>
          )}

          {s && !editing && (
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/api/oauth/${view.provider}/start`}
                className={`btn-primary ${s.status === "invalid" ? "pointer-events-none opacity-50" : ""}`}
                aria-disabled={s.status === "invalid"}
              >
                {view.channelCount ? "Connect more" : "Connect"} {view.provider === "google" ? "YouTube" : "Facebook & Instagram"}
              </a>
              <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn-ghost" disabled={busy} onClick={() => start(async () => setNote(await reverifyCredentialAction(view.provider)))}>
                {busy ? "Checking…" : "Re-verify"}
              </button>
              <button
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Remove these credentials? Connected channels will stop working until you add them again."))
                    start(async () => {
                      setNote(await deleteCredentialAction(view.provider));
                      setEditing(true);
                    });
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <aside className="min-w-0 rounded-lg bg-bg p-4 text-sm">
          <p className="label">Redirect URI</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-1 text-xs">{view.redirectUri}</code>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(view.redirectUri);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-brand">How to get these keys</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-muted">
              {view.setupSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <a href={view.consoleUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-medium text-brand hover:underline">
              Open developer console ↗
            </a>
          </details>
        </aside>
      </div>
    </section>
  );
}

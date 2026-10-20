"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteAutomationAction,
  runRecycleNowAction,
  saveAutomationAction,
  toggleAutomationAction,
  type AutomationInput,
} from "@/app/actions/automations";
import type { Automation, AutomationKind, AutomationLogEntry, Platform } from "@/db/schema";
import { PlatformIcon } from "../icons";
import { StatusBadge } from "../StatusBadge";

interface ChannelOpt {
  id: string;
  name: string;
  platform: Platform;
}

type Result = { ok: boolean; message: string } | undefined;

const KINDS: { kind: AutomationKind; title: string; blurb: string }[] = [
  { kind: "auto_reply", title: "Auto-reply to comments", blurb: "Answer common questions, or every comment, with your own text or an AI reply in your brand voice." },
  { kind: "auto_hide", title: "Hide spam and abuse", blurb: "Hide comments containing words you choose, or links, the moment they arrive." },
  { kind: "recycle", title: "Re-share top posts", blurb: "Every few days, book your best-performing older post into the queue again." },
];

const KIND_LABEL: Record<AutomationKind, string> = { auto_reply: "Auto-reply", auto_hide: "Auto-hide", recycle: "Re-share" };

function Flash({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400"}`}>
      {r.message}
    </p>
  );
}

function describe(rule: Automation, channels: ChannelOpt[]) {
  const c = rule.config;
  const where = c.channelIds?.length ? channels.filter((x) => c.channelIds!.includes(x.id)).map((x) => x.name).join(", ") || "removed channels" : "all channels";
  const words = c.keywords?.length ? `“${c.keywords.slice(0, 4).join("”, “")}”${c.keywords.length > 4 ? ` +${c.keywords.length - 4}` : ""}` : "";
  if (rule.kind === "auto_reply") return `${words ? `Comments mentioning ${words}` : "Every new comment"} on ${where} get ${c.useAi ? "an AI-written reply" : "your reply"}.`;
  if (rule.kind === "auto_hide") return `Hides comments on ${where} containing ${[words, c.hideLinks ? "links" : ""].filter(Boolean).join(" or ")}.`;
  return `Every ${c.everyDays ?? 7} days, re-shares the best post older than ${c.minAgeDays ?? 30} days on ${where}${c.refreshCaption ? ", with a refreshed caption" : ""}.`;
}

export function AutomationsView({ rules, log, channels, aiReady, tz }: { rules: Automation[]; log: AutomationLogEntry[]; channels: ChannelOpt[]; aiReady: boolean; tz: string }) {
  const [editing, setEditing] = useState<{ id: string | null; kind: AutomationKind } | null>(null);
  const current = editing?.id ? rules.find((r) => r.id === editing.id) : undefined;

  return (
    <div className="space-y-6">
      {editing ? (
        <RuleForm
          key={editing.id ?? editing.kind}
          kind={editing.kind}
          rule={current}
          channels={channels}
          aiReady={aiReady}
          onDone={() => setEditing(null)}
        />
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Add a rule</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button key={k.kind} className="card p-4 text-left transition hover:ring-1 hover:ring-brand/40" onClick={() => setEditing({ id: null, kind: k.kind })}>
                <p className="text-sm font-semibold">{k.title}</p>
                <p className="mt-1 text-xs text-muted">{k.blurb}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Your rules</h2>
        {rules.length ? (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} channels={channels} tz={tz} onEdit={() => setEditing({ id: r.id, kind: r.kind })} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">No rules yet. Pick one above to get started.</p>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Recent activity</h2>
        {log.length ? (
          <ul className="divide-y divide-line text-sm">
            {log.map((l) => (
              <li key={l.id} className="flex gap-3 px-5 py-2.5">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${l.ok ? "bg-emerald-500" : "bg-red-500"}`} aria-label={l.ok ? "Succeeded" : "Failed"} />
                <span className="min-w-0 flex-1 break-words">{l.detail}</span>
                <time className="shrink-0 text-xs text-muted">{new Date(l.createdAt).toLocaleString("en", { timeZone: tz, dateStyle: "short", timeStyle: "short" })}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">Nothing has run yet.</p>
        )}
      </section>
    </div>
  );
}

function RuleRow({ rule, channels, tz, onEdit }: { rule: Automation; channels: ChannelOpt[]; tz: string; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Result>();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setNote(await fn());
      router.refresh();
    });
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{KIND_LABEL[rule.kind]}</span>
        <p className="min-w-0 flex-1 truncate font-medium">{rule.name}</p>
        <StatusBadge tone={rule.enabled ? "green" : "gray"}>{rule.enabled ? "On" : "Paused"}</StatusBadge>
      </div>
      <p className="text-sm text-muted">{describe(rule, channels)}</p>
      <p className="text-xs text-muted">
        {rule.runCount ? `Acted ${rule.runCount} ${rule.runCount === 1 ? "time" : "times"}` : "Hasn't acted yet"}
        {rule.lastRunAt && ` · last ${new Date(rule.lastRunAt).toLocaleString("en", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" disabled={pending} onClick={() => run(() => toggleAutomationAction(rule.id, !rule.enabled))}>
          {rule.enabled ? "Pause" : "Turn on"}
        </button>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onEdit}>Edit</button>
        {rule.kind === "recycle" && (
          <button className="btn-ghost px-3 py-1.5 text-xs" disabled={pending} onClick={() => run(() => runRecycleNowAction(rule.id))}>
            {pending ? "Working…" : "Run now"}
          </button>
        )}
        <button className="btn-danger px-3 py-1.5 text-xs" disabled={pending} onClick={() => confirm(`Delete “${rule.name}”?`) && run(() => deleteAutomationAction(rule.id))}>
          Delete
        </button>
      </div>
      <Flash r={note} />
    </li>
  );
}

function RuleForm({
  kind,
  rule,
  channels,
  aiReady,
  onDone,
}: {
  kind: AutomationKind;
  rule?: Automation;
  channels: ChannelOpt[];
  aiReady: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const c = rule?.config ?? {};
  const [name, setName] = useState(rule?.name ?? KINDS.find((k) => k.kind === kind)!.title);
  const [channelIds, setChannelIds] = useState<string[]>(c.channelIds ?? []);
  const [keywords, setKeywords] = useState((c.keywords ?? []).join(", "));
  const [replyText, setReplyText] = useState(c.replyText ?? "");
  const [useAi, setUseAi] = useState(c.useAi ?? false);
  const [hideLinks, setHideLinks] = useState(c.hideLinks ?? true);
  const [minAgeDays, setMinAgeDays] = useState(String(c.minAgeDays ?? 30));
  const [everyDays, setEveryDays] = useState(String(c.everyDays ?? 7));
  const [refresh, setRefresh] = useState(c.refreshCaption ?? aiReady);
  const [result, setResult] = useState<Result>();
  const [pending, start] = useTransition();

  function save() {
    const base = { name, channelIds };
    const input: AutomationInput =
      kind === "auto_reply"
        ? { kind, ...base, keywords, replyText, useAi }
        : kind === "auto_hide"
          ? { kind, ...base, keywords, hideLinks }
          : { kind, ...base, minAgeDays, everyDays, refreshCaption: refresh };
    start(async () => {
      const r = await saveAutomationAction(rule?.id ?? null, input);
      setResult(r);
      if (r.ok) {
        router.refresh();
        setTimeout(onDone, 700);
      }
    });
  }

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{rule ? "Edit rule" : KINDS.find((k) => k.kind === kind)!.title}</h2>
        <button type="button" className="text-sm text-muted hover:text-ink" onClick={onDone}>Cancel</button>
      </div>
      <div>
        <label className="label" htmlFor="rule-name">Name</label>
        <input id="rule-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <span className="label">Channels</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!channelIds.length}
            onClick={() => setChannelIds([])}
            className={`rounded-full border px-3 py-1 text-sm ${!channelIds.length ? "border-brand bg-brand/10 text-brand" : "border-line"}`}
          >
            All channels
          </button>
          {channels.map((ch) => {
            const on = channelIds.includes(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChannelIds((ids) => (on ? ids.filter((x) => x !== ch.id) : [...ids, ch.id]))}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand/10" : "border-line"}`}
              >
                <PlatformIcon platform={ch.platform} className="size-4" /> {ch.name}
              </button>
            );
          })}
        </div>
      </div>

      {(kind === "auto_reply" || kind === "auto_hide") && (
        <div>
          <label className="label" htmlFor="rule-words">
            {kind === "auto_reply" ? "Only comments containing (leave empty to reply to every comment)" : "Hide comments containing"}
          </label>
          <textarea
            id="rule-words"
            className="input min-h-16"
            placeholder={kind === "auto_reply" ? "price, how much, cost" : "scam, crypto, follow back"}
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">Separate with commas. Matching ignores upper and lower case.</p>
        </div>
      )}

      {kind === "auto_reply" && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={useAi} disabled={!aiReady && !useAi} onChange={(e) => setUseAi(e.target.checked)} />
            <span>
              Let the AI assistant write each reply in your brand voice
              {!aiReady && (
                <span className="block text-xs text-muted">
                  Needs an Anthropic key. <Link href="/settings/api#ai" className="text-brand hover:underline">Add one</Link>
                </span>
              )}
            </span>
          </label>
          <div>
            <label className="label" htmlFor="rule-reply">{useAi ? "Guidance for the AI (optional)" : "Reply text"}</label>
            <textarea
              id="rule-reply"
              className="input min-h-20"
              placeholder={useAi ? "e.g. Prices start at $49. Point people to the link in our bio." : "Thanks {name}! Prices are on our website, link in bio."}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            {!useAi && <p className="mt-1 text-xs text-muted">{"{name}"} is replaced with the commenter&apos;s name.</p>}
          </div>
        </>
      )}

      {kind === "auto_hide" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hideLinks} onChange={(e) => setHideLinks(e.target.checked)} />
          Also hide comments that contain links
        </label>
      )}

      {kind === "recycle" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rule-every">Re-share every (days)</label>
            <input id="rule-every" type="number" min={1} max={365} className="input" value={everyDays} onChange={(e) => setEveryDays(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rule-age">Only posts older than (days)</label>
            <input id="rule-age" type="number" min={1} max={3650} className="input" value={minAgeDays} onChange={(e) => setMinAgeDays(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={refresh} disabled={!aiReady && !refresh} onChange={(e) => setRefresh(e.target.checked)} />
            <span>
              Rewrite the caption with AI so it doesn&apos;t read as a repeat
              {!aiReady && <span className="block text-xs text-muted">Needs an Anthropic key.</span>}
            </span>
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            The post is booked into the next free queue time for its channels, or the best upcoming time if no queue is set. You can edit or cancel it in the calendar before it goes out.
          </p>
        </div>
      )}

      <Flash r={result} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : rule ? "Save changes" : "Create rule"}</button>
    </form>
  );
}

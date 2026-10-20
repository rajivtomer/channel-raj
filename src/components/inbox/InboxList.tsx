"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hideAction, replyAction, setStatusAction, suggestReplyAction } from "@/app/actions/inbox";
import type { InboxStatus } from "@/db/schema";
import type { InboxRow } from "@/lib/inbox";
import { PlatformIcon } from "../icons";

function ago(d: Date) {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return null;
}

export function InboxList({ items, status, aiReady, tz }: { items: InboxRow[]; status: InboxStatus; aiReady: boolean; tz: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string>();
  const visible = items.filter((i) => !gone.has(i.id));
  const drop = (id: string, message: string) => {
    setGone((g) => new Set(g).add(id));
    setToast(message);
  };
  const toastEl = toast && (
    <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{toast}</p>
  );

  if (!visible.length)
    return (
      <div className="space-y-3">
        {toastEl}
        <p className="card px-5 py-10 text-center text-sm text-muted">
          {status === "open" ? "You're all caught up. New comments show up here as they arrive." : status === "done" ? "Nothing marked done yet." : "No hidden comments."}
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      {toastEl}
      {status === "open" && visible.length > 1 && (
        <div className="flex justify-end">
          <button
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setStatusAction(visible.map((i) => i.id), "done");
                setGone(new Set(items.map((i) => i.id)));
                setToast(r.message);
                router.refresh();
              })
            }
          >
            Mark all {visible.length} as done
          </button>
        </div>
      )}
      <ul className="space-y-3">
        {visible.map((item) => (
          <InboxCard key={item.id} item={item} aiReady={aiReady} tz={tz} onGone={(message) => drop(item.id, message)} />
        ))}
      </ul>
    </div>
  );
}

function InboxCard({ item, aiReady, tz, onGone }: { item: InboxRow; aiReady: boolean; tz: string; onGone: (message: string) => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; message: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const posted = new Date(item.postedAt);
  const when = ago(posted) ?? posted.toLocaleDateString("en", { timeZone: tz, dateStyle: "medium" });

  async function act(key: string, fn: () => Promise<{ ok: boolean; message: string }>, removes = true) {
    setBusy(key);
    setNote(undefined);
    const r = await fn().catch((err: Error) => ({ ok: false, message: err.message }));
    setBusy(null);
    if (r.ok && removes) onGone(r.message);
    else setNote(r);
  }

  return (
    <li className="card p-4">
      <div className="flex gap-3">
        <span className="relative shrink-0">
          {item.authorAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.authorAvatar} alt="" className="size-9 rounded-full object-cover" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-full bg-bg text-sm font-medium text-muted">{item.authorName.replace(/^@/, "").slice(0, 1).toUpperCase()}</span>
          )}
          <PlatformIcon platform={item.platform} className="absolute -right-1 -bottom-1 size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{item.authorName}</span>
            <span className="text-xs text-muted" suppressHydrationWarning>on {item.channelName} · {when}</span>
            {item.likeCount > 0 && <span className="text-xs text-muted">♥ {item.likeCount}</span>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>
          {(item.objectTitle || item.objectUrl) && (
            <p className="mt-1 truncate text-xs text-muted">
              {item.objectUrl ? (
                <a href={item.objectUrl} target="_blank" rel="noreferrer" className="hover:text-brand">On: {item.objectTitle || "View post"} ↗</a>
              ) : (
                <>On: {item.objectTitle}</>
              )}
            </p>
          )}
          {item.replyText && (
            <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-xs">
              <span className="font-medium">You replied{item.handledBy ? " (automation)" : ""}:</span> {item.replyText}
            </p>
          )}

          {replying && (
            <div className="mt-3 space-y-2">
              <textarea
                className="input min-h-20"
                aria-label={`Reply to ${item.authorName}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Reply to ${item.authorName}…`}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy !== null || !text.trim()} onClick={() => act("send", () => replyAction(item.id, text))}>
                  {busy === "send" ? "Posting…" : "Post reply"}
                </button>
                {aiReady ? (
                  <button
                    className="btn-ghost px-3 py-1.5 text-xs"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy("ai");
                      setNote(undefined);
                      const r = await suggestReplyAction(item.id).catch((err: Error) => ({ ok: false as const, message: err.message }));
                      setBusy(null);
                      if (r.ok) setText(r.text);
                      else setNote({ ok: false, message: r.message });
                    }}
                  >
                    {busy === "ai" ? "Writing…" : "✦ Suggest reply"}
                  </button>
                ) : (
                  <Link href="/settings/api#ai" className="self-center text-xs text-muted hover:text-brand">Add an AI key for suggested replies</Link>
                )}
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setReplying(false)}>Cancel</button>
              </div>
            </div>
          )}

          {note && <p role="status" className={`mt-2 text-xs ${note.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{note.message}</p>}

          {!replying && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {item.status !== "hidden" && (
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setReplying(true)}>Reply</button>
              )}
              {item.status === "open" && (
                <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => act("done", () => setStatusAction([item.id], "done"))}>
                  Mark done
                </button>
              )}
              {item.status === "done" && (
                <button className="btn-ghost px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => act("open", () => setStatusAction([item.id], "open"))}>
                  Reopen
                </button>
              )}
              {item.status !== "hidden" && (
                <button
                  className="btn-danger px-3 py-1.5 text-xs"
                  disabled={busy !== null}
                  onClick={() => confirm(`Hide this comment from the public on ${item.channelName}?`) && act("hide", () => hideAction(item.id))}
                >
                  {busy === "hide" ? "Hiding…" : "Hide"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

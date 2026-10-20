"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { deleteMediaAction } from "@/app/actions/media";
import type { MediaAsset } from "@/db/schema";
import { MediaThumb } from "./MediaThumb";
import { ACCEPT_ATTR, useUploader } from "./useUploader";

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);

export function MediaLibrary({
  initial,
  userId,
  blob,
  selectable,
  selected = [],
  onToggle,
}: {
  initial: MediaAsset[];
  userId: string;
  blob: boolean;
  selectable?: boolean;
  selected?: string[];
  onToggle?: (asset: MediaAsset) => void;
}) {
  const [assets, setAssets] = useState(initial);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string>();
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const { upload, items, dismiss } = useUploader({
    userId,
    blob,
    onUploaded: (a) => {
      setAssets((cur) => [a, ...cur]);
      if (selectable) onToggle?.(a);
    },
  });
  const shown = useMemo(() => assets.filter((a) => filter === "all" || a.kind === filter), [assets, filter]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      }}
      className={`rounded-xl transition ${dragging ? "ring-2 ring-brand ring-offset-4 ring-offset-bg" : ""}`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5 text-sm">
          {(["all", "image", "video"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 ${filter === f ? "bg-brand/10 font-medium text-brand" : "text-muted"}`}
            >
              {f === "all" ? "All" : f === "image" ? "Photos" : "Videos"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">{assets.length} files</span>
        <div className="flex-1" />
        <input ref={input} type="file" multiple accept={ACCEPT_ATTR} hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        <button type="button" className="btn-primary" onClick={() => input.current?.click()}>
          Upload
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mb-4 space-y-2">
          {items.map((i) => (
            <li key={i.name} className="card flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              {i.error ? (
                <>
                  <span className="text-xs text-red-600 dark:text-red-400">{i.error}</span>
                  <button type="button" className="text-xs text-muted" onClick={() => dismiss(i.name)}>Dismiss</button>
                </>
              ) : (
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg">
                  <div className="h-full bg-brand transition-all" style={{ width: `${i.percent}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{note}</p>}

      {shown.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((a) => {
            const isSel = selected.includes(a.id);
            return (
              <li key={a.id} className={`card group overflow-hidden ${isSel ? "ring-2 ring-brand" : ""}`}>
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => selectable && onToggle?.(a)}
                  disabled={!selectable}
                  aria-pressed={selectable ? isSel : undefined}
                >
                  <MediaThumb asset={a} className="aspect-square" />
                </button>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{a.filename}</p>
                    <p className="text-[11px] text-muted">
                      {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                      {fmtSize(a.size)}
                    </p>
                  </div>
                  {selectable ? (
                    <span className={`flex size-5 items-center justify-center rounded-full border text-[11px] ${isSel ? "border-brand bg-brand text-brand-ink" : "border-line"}`}>
                      {isSel ? selected.indexOf(a.id) + 1 : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-red-600 opacity-70 hover:opacity-100 dark:text-red-400"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Delete ${a.filename}?`)) return;
                        start(async () => {
                          const r = await deleteMediaAction(a.id);
                          if (r.ok) setAssets((cur) => cur.filter((x) => x.id !== a.id));
                          setNote(r.ok ? undefined : r.message);
                        });
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-6 py-16 text-center text-sm text-muted hover:border-brand/50"
        >
          <span className="text-base font-medium text-ink">Drop photos and videos here</span>
          <span className="mt-1">or click to choose files. JPG, PNG, WebP, MP4 and MOV up to 1 GB.</span>
        </button>
      )}
    </div>
  );
}

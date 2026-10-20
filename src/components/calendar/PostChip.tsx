"use client";

import Link from "next/link";
import type { Platform, Post, PostTarget } from "@/db/schema";
import { PlatformIcon } from "../icons";

export type CalPost = Post & { targets: PostTarget[] };

export const STATUS_DOT: Record<Post["status"], string> = {
  draft: "bg-slate-400",
  scheduled: "bg-brand",
  publishing: "bg-amber-500",
  published: "bg-emerald-500",
  partial: "bg-orange-500",
  failed: "bg-red-500",
};

export const STATUS_LABEL: Record<Post["status"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  partial: "Partly failed",
  failed: "Failed",
};

export const postTime = (p: CalPost) => new Date(p.publishedAt ?? p.scheduledAt ?? p.updatedAt);

export function PostChip({ post, platforms, compact }: { post: CalPost; platforms: Record<string, Platform>; compact?: boolean }) {
  const icons = [...new Set(post.targets.map((t) => platforms[t.channelId]).filter(Boolean))] as Platform[];
  return (
    <Link
      href={`/compose?id=${post.id}`}
      className="flex items-center gap-1.5 rounded-md bg-bg px-1.5 py-1 text-[11px] leading-tight hover:ring-1 hover:ring-brand/40"
      title={`${STATUS_LABEL[post.status]} · ${post.caption.slice(0, 80)}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[post.status]}`} />
      <span className="tabular-nums text-muted">{postTime(post).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      {!compact && <span className="min-w-0 flex-1 truncate">{post.caption || "No caption"}</span>}
      <span className="ml-auto flex shrink-0 -space-x-1">
        {icons.map((p) => <PlatformIcon key={p} platform={p} className="size-3" />)}
      </span>
    </Link>
  );
}

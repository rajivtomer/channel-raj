"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Platform } from "@/db/schema";
import { type CalPost, PostChip, postTime, STATUS_DOT, STATUS_LABEL } from "./PostChip";
import { dayKey, fmtDayHeading, fmtTime } from "@/lib/tzfmt";
import { PlatformIcon } from "../icons";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Grid days are plain calendar dates, so build them in UTC and read them back with getUTC*.
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function MonthGrid({ month, posts, platforms, tz }: { month: string; posts: CalPost[]; platforms: Record<string, Platform>; tz: string }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday first
  const days = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(y, m - 1, 1 - startOffset + i)));
  const weeks = days[35]!.getUTCMonth() !== m - 1 ? 5 : 6;
  const byDay = useMemo(() => {
    const map: Record<string, CalPost[]> = {};
    for (const p of posts) (map[dayKey(postTime(p), tz)] ??= []).push(p);
    for (const k in map) map[k]!.sort((a, b) => +postTime(a) - +postTime(b));
    return map;
  }, [posts, tz]);
  const today = dayKey(new Date(), tz);
  const prev = ymd(new Date(Date.UTC(y, m - 2, 1))).slice(0, 7);
  const next = ymd(new Date(Date.UTC(y, m, 1))).slice(0, 7);

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 font-semibold">{first.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <Link className="btn-ghost px-2.5 py-1 text-xs" href={`/calendar?month=${prev}`} aria-label="Previous month">←</Link>
        <Link className="btn-ghost px-2.5 py-1 text-xs" href="/calendar">Today</Link>
        <Link className="btn-ghost px-2.5 py-1 text-xs" href={`/calendar?month=${next}`} aria-label="Next month">→</Link>
      </header>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div key={d} className="border-b border-line px-2 py-1.5 text-xs font-medium text-muted">{d}</div>
          ))}
          {days.slice(0, weeks * 7).map((d) => {
            const key = ymd(d);
            const list = byDay[key] ?? [];
            const inMonth = d.getUTCMonth() === m - 1;
            const isPast = key < today;
            return (
              <div key={key} className={`group min-h-28 border-r border-b border-line p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0 ${inMonth ? "" : "bg-bg/60"}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={`flex size-6 items-center justify-center rounded-full text-xs ${key === today ? "bg-brand font-semibold text-brand-ink" : inMonth ? "" : "text-muted/60"}`}>
                    {d.getUTCDate()}
                  </span>
                  {!isPast && (
                    <Link href={`/compose?date=${key}`} className="hidden text-xs text-brand group-hover:block" aria-label={`New post on ${key}`}>+</Link>
                  )}
                </div>
                <div className="space-y-1">
                  {list.slice(0, 3).map((p) => <PostChip key={p.id} post={p} platforms={platforms} tz={tz} />)}
                  {list.length > 3 && <p className="px-1 text-[11px] text-muted">+{list.length - 3} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function PostList({ posts, platforms, empty, tz }: { posts: CalPost[]; platforms: Record<string, Platform>; empty: string; tz: string }) {
  if (!posts.length) return <p className="card px-5 py-10 text-center text-sm text-muted">{empty}</p>;
  let lastDay = "";
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {posts.map((p) => {
        const t = postTime(p);
        const day = fmtDayHeading(t, tz);
        const header = p.status !== "draft" && day !== lastDay;
        lastDay = day;
        const icons = [...new Set(p.targets.map((x) => platforms[x.channelId]).filter(Boolean))] as Platform[];
        return (
          <li key={p.id}>
            {header && <p className="bg-bg px-5 py-1.5 text-xs font-medium text-muted">{day}</p>}
            <Link href={`/compose?id=${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-bg/60">
              <span className="w-16 shrink-0 text-xs tabular-nums text-muted">
                {p.status === "draft" ? "Draft" : fmtTime(t, tz)}
              </span>
              <span className="flex shrink-0 -space-x-1">{icons.map((x) => <PlatformIcon key={x} platform={x} className="size-4" />)}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{p.caption || <span className="text-muted">No caption</span>}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <span className={`size-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                {STATUS_LABEL[p.status]}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

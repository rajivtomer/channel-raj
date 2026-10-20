"use client";

import { useMemo, useRef, useState } from "react";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

/** Follower line for one channel or platform. Single series, so the card title names it and no legend is drawn. */
export function FollowerLine({ points, label }: { points: { day: string; followers: number }[]; label: string }) {
  const W = 320;
  const H = 120;
  const pad = { l: 36, r: 8, t: 8, b: 20 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const { min, max, xs, ys, ticks } = useMemo(() => {
    const vals = points.map((p) => p.followers);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo = Math.max(0, lo - 1);
      hi = hi + 1;
    }
    const span = hi - lo;
    lo = Math.max(0, lo - span * 0.1);
    hi = hi + span * 0.1;
    const xs = points.map((_, i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1)));
    const ys = vals.map((v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b));
    return { min: lo, max: hi, xs, ys, ticks: [lo, (lo + hi) / 2, hi] };
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  if (points.length < 2)
    return <p className="flex h-[120px] items-center justify-center text-center text-xs text-muted">Growth appears after a second day of data.</p>;

  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join("");
  const area = `${path}L${xs.at(-1)!.toFixed(1)},${H - pad.b}L${xs[0]!.toFixed(1)},${H - pad.b}Z`;
  const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
    setHover(best);
  }
  const h = hover !== null ? points[hover]! : null;

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`${label} followers from ${full.format(points[0]!.followers)} to ${full.format(points.at(-1)!.followers)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onFocus={() => setHover(points.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? points.length) - 1));
          if (e.key === "ArrowRight") setHover((v) => Math.min(points.length - 1, (v ?? -1) + 1));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted text-[9px] tabular-nums">{compact.format(Math.round(t))}</text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="fill-muted text-[9px]">{fmtDay(points[0]!.day)}</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-muted text-[9px]">{fmtDay(points.at(-1)!.day)}</text>
        <path d={area} className="fill-viz-1" opacity={0.1} />
        <path d={path} fill="none" className="stroke-viz-1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={H - pad.b} className="stroke-muted" strokeWidth={1} />}
        <circle
          cx={xs[hover ?? xs.length - 1]}
          cy={ys[hover ?? ys.length - 1]}
          r={4}
          className="fill-viz-1 stroke-panel"
          strokeWidth={2}
        />
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-line bg-panel px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(xs[hover!]! / W) * 100}%`, transform: `translateX(${hover! > points.length / 2 ? "-105%" : "5%"})` }}
        >
          <p className="font-semibold tabular-nums">{full.format(h.followers)}</p>
          <p className="text-muted">{fmtDay(h.day)}</p>
        </div>
      )}
    </div>
  );
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Engagement by weekday and hour: one hue, opacity carries magnitude. */
export function Heatmap({ buckets }: { buckets: { weekday: number; hour: number; posts: number; rate: number }[] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(...buckets.map((b) => b.rate), 0);
  const get = (d: number, h: number) => buckets.find((b) => b.weekday === d && b.hour === h);
  const avg = buckets.length ? buckets.reduce((s, b) => s + b.rate * b.posts, 0) / buckets.reduce((s, b) => s + b.posts, 0) : 0;
  const hb = hover ? get(hover.d, hover.h) : undefined;
  const hourLabel = (h: number) => new Date(Date.UTC(2024, 0, 1, h)).toLocaleTimeString("en", { hour: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }} onPointerLeave={() => setHover(null)}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[9px] text-muted">{h % 3 === 0 ? hourLabel(h).replace(" ", "") : ""}</span>
          ))}
          {ORDER.map((d) => (
            <div key={d} className="contents">
              <span className="pr-1 text-right text-[10px] leading-5 text-muted">{DAY[d]}</span>
              {Array.from({ length: 24 }, (_, h) => {
                const b = get(d, h);
                const on = hover?.d === d && hover.h === h;
                return (
                  <button
                    key={h}
                    type="button"
                    aria-label={`${DAY[d]} ${hourLabel(h)}: ${b ? `${b.posts} posts, ${(b.rate / (avg || 1)).toFixed(1)}× average engagement` : "no posts"}`}
                    onPointerEnter={() => setHover({ d, h })}
                    onFocus={() => setHover({ d, h })}
                    className={`h-5 rounded-[3px] ${b ? "bg-viz-1" : "bg-bg"} ${on ? "ring-2 ring-ink/40" : ""}`}
                    style={b && max ? { opacity: 0.15 + 0.85 * (b.rate / max) } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          Less
          <span className="flex gap-[2px]">
            {[0.15, 0.36, 0.57, 0.79, 1].map((o) => <span key={o} className="block size-3 rounded-[3px] bg-viz-1" style={{ opacity: o }} />)}
          </span>
          More engagement per post
        </span>
        <span className="flex items-center gap-2"><span className="block size-3 rounded-[3px] bg-bg ring-1 ring-line" /> No posts yet</span>
        <span role="status" className="min-h-4 text-ink">
          {hover && (hb ? <><strong className="tabular-nums">{(hb.rate / (avg || 1)).toFixed(1)}× average</strong> <span className="text-muted">· {DAY[hover.d]} {hourLabel(hover.h)} · {hb.posts} {hb.posts === 1 ? "post" : "posts"}</span></> : <span className="text-muted">{DAY[hover.d]} {hourLabel(hover.h)} · no posts</span>)}
        </span>
      </div>
    </div>
  );
}

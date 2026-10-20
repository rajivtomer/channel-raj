import type { MediaAsset } from "@/db/schema";

export function formatDuration(sec?: number | null) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MediaThumb({ asset, className = "" }: { asset: Pick<MediaAsset, "url" | "kind" | "filename" | "durationSec">; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-bg ${className}`}>
      {asset.kind === "video" ? (
        <video src={`${asset.url}#t=0.5`} className="size-full object-cover" muted playsInline preload="metadata" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.url} alt={asset.filename} className="size-full object-cover" loading="lazy" />
      )}
      {asset.kind === "video" && (
        <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
          ▶ {formatDuration(asset.durationSec)}
        </span>
      )}
    </div>
  );
}

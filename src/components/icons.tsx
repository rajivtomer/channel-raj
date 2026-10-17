import type { Platform } from "@/db/schema";

export function PlatformIcon({ platform, className = "size-5" }: { platform: Platform; className?: string }) {
  if (platform === "youtube")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-label="YouTube">
        <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="var(--color-youtube)" />
        <path d="M10 9v6l5.2-3z" fill="#fff" />
      </svg>
    );
  if (platform === "facebook")
    return (
      <svg viewBox="0 0 24 24" className={className} aria-label="Facebook">
        <circle cx="12" cy="12" r="11" fill="var(--color-facebook)" />
        <path d="M13.3 19v-6h2l.3-2.4h-2.3V9.2c0-.7.2-1.2 1.2-1.2h1.2V5.9a16 16 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3.1v1.7h-2V13h2v6z" fill="#fff" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Instagram">
      <defs>
        <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#feda75" />
          <stop offset=".35" stopColor="#fa7e1e" />
          <stop offset=".65" stopColor="#d62976" />
          <stop offset="1" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#ig)" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.6" cy="7.4" r="1" fill="#fff" />
    </svg>
  );
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
};

export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--color-brand)" />
      <path d="M9 11h14M9 16h10M9 21h6" stroke="var(--color-brand-ink)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

const STYLES = {
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20",
  red: "bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/20",
  gray: "bg-slate-500/10 text-muted ring-slate-500/20",
};

export function StatusBadge({ tone, children }: { tone: keyof typeof STYLES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// Date formatting pinned to the user's saved zone, so server and browser render the same text.

const cache = new Map<string, Intl.DateTimeFormat>();
function f(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let x = cache.get(key);
  if (!x) cache.set(key, (x = new Intl.DateTimeFormat("en", { ...opts, timeZone: tz })));
  return x;
}

/** YYYY-MM-DD of the instant in tz. */
export function dayKey(d: Date, tz: string) {
  const p = Object.fromEntries(f(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** YYYY-MM-DDTHH:MM for a datetime-local input, read in tz. */
export function localInput(d: Date, tz: string) {
  const p = Object.fromEntries(
    f(tz, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The instant a datetime-local value means in tz. */
export function fromLocalInput(v: string, tz: string) {
  const [date, time = "00:00"] = v.split("T");
  const [y, mo, d] = date!.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const back = localInput(new Date(t), tz);
    const [bd, bt] = back.split("T") as [string, string];
    const [by, bmo, bdd] = bd.split("-").map(Number) as [number, number, number];
    const [bh, bmi] = bt.split(":").map(Number) as [number, number];
    t += guess - Date.UTC(by, bmo - 1, bdd, bh, bmi);
  }
  return new Date(t);
}

export const fmtTime = (d: Date, tz: string) => f(tz, { hour: "numeric", minute: "2-digit" }).format(d);
export const fmtDateTime = (d: Date, tz: string) => f(tz, { dateStyle: "medium", timeStyle: "short" }).format(d);
export const fmtDayHeading = (d: Date, tz: string) => f(tz, { weekday: "long", month: "short", day: "numeric" }).format(d);
export const fmtWeekdayTime = (d: Date, tz: string) => f(tz, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);

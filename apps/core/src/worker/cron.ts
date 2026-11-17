// A small 5-field cron (minute hour day-of-month month day-of-week) for the
// one timezone the app uses. Africa/Johannesburg is UTC+2 all year (no DST).
export const SCHEDULE_TZ = "Africa/Johannesburg";
const OFFSET_MS = 2 * 60 * 60 * 1000;
const MINUTE = 60_000;
const LOOKBACK_MS = 7 * 24 * 60 * MINUTE;

type Field = { set: Set<number>; star: boolean };
export type CronSpec = { min: Field; hour: Field; dom: Field; mon: Field; dow: Field };

function field(src: string, lo: number, hi: number, wrap7 = false): Field | null {
  const set = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) return null;
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      a = Number(m[2]);
      b = m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    }
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) set.add(wrap7 && v === 7 ? 0 : v);
  }
  return { set, star: src === "*" || src.startsWith("*/") };
}

export function parseCron(expr: string): CronSpec | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const min = field(p[0]!, 0, 59);
  const hour = field(p[1]!, 0, 23);
  const dom = field(p[2]!, 1, 31);
  const mon = field(p[3]!, 1, 12);
  const dow = field(p[4]!, 0, 7, true);
  return min && hour && dom && mon && dow ? { min, hour, dom, mon, dow } : null;
}

function matches(s: CronSpec, at: Date): boolean {
  const l = new Date(at.getTime() + OFFSET_MS); // read as local time with the UTC getters
  if (!s.min.set.has(l.getUTCMinutes()) || !s.hour.set.has(l.getUTCHours()) || !s.mon.set.has(l.getUTCMonth() + 1)) return false;
  const d = s.dom.set.has(l.getUTCDate());
  const w = s.dow.set.has(l.getUTCDay());
  return !s.dom.star && !s.dow.star ? d || w : d && w;
}

/** The latest due minute in (after, now], or null. Looks back at most 7 days. */
export function latestDue(expr: string, now: Date, after: Date): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;
  const floor = Math.floor(now.getTime() / MINUTE) * MINUTE;
  const stop = Math.max(after.getTime(), floor - LOOKBACK_MS);
  for (let t = floor; t > stop; t -= MINUTE) if (matches(spec, new Date(t))) return new Date(t);
  return null;
}

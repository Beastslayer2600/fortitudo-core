// Strict body validation: unknown fields are rejected, as the contract says.
type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when `o` has only the allowed keys. */
export const onlyKeys = (o: Obj, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
export const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= 2_000_000_000;
export const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length <= max && v.length >= min;
export const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
export const strList = (v: unknown, maxItems: number, maxLen: number): v is string[] =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => isStr(s, maxLen));

/** A stats object of non-negative finite numbers, only the allowed keys. */
export function statsOf(v: unknown, allowed: readonly string[]): Record<string, number> | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || !onlyKeys(v, allowed)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e9) return null;
    out[k] = n;
  }
  return out;
}

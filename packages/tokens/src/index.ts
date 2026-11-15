// Fortitudo design tokens: the root look from the Aesthetic section of the
// architecture document. Every face reads these values and nothing else.
// Change a value here, run `pnpm --filter @fortitudo/tokens build`, and every
// face that imports tokens.css follows.

export const color = {
  /** Matte near-black, not pure black. */
  base: "#0f0e0d",
  /** One step lighter than the base, for cards and panels. */
  surface: "#191816",
  /** Hairline for interface edges (inputs, table rows). Section rules use gold. */
  line: "#2b2926",
  /** The one gold: hairline rules, a single accent word, the signature mark. Never a background, never a glow. */
  gold: "#b8975a",
  /** Warm off-white for body text. */
  text: "#e8e3d9",
  /** Pure white, for the headline only. */
  headline: "#ffffff",
  /** Secondary text and labels. */
  muted: "#8e897f",
} as const;

/** Empty at the root. Each venture sets its own (deep green for advising). */
export const accent: Record<string, string> = {};

export const font = {
  /** The heading face, chosen once: EB Garamond. */
  serif: { family: "EB Garamond", fallback: "Garamond, 'Times New Roman', Georgia, serif" },
  /** The quiet sans. There is never a third typeface. */
  sans: { family: "Inter", fallback: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
} as const;

/** Type scale in rem. */
export const text = {
  label: "0.6875rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.25rem",
  xl: "1.75rem",
  display: "2.75rem",
} as const;

/** Small uppercase labels, wide letter-spacing. */
export const tracking = { label: "0.16em" } as const;

/** Margins twice as wide as feels comfortable. */
export const space = {
  gutter: "clamp(1.5rem, 8vw, 6rem)",
  section: "clamp(3rem, 10vw, 7.5rem)",
} as const;

/** Small and consistent. */
export const radius = { sm: "3px" } as const;

/** Slow and rare: fades and gentle rises, nothing that bounces. */
export const motion = { duration: "600ms", ease: "cubic-bezier(0.22, 0.61, 0.36, 1)" } as const;

/** At most one texture. The root uses none. */
export const texture = "none" as const;

const tokens = { color, accent, font, text, tracking, space, radius, motion, texture };
export default tokens;

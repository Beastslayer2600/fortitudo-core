// Writes tokens.css (a Tailwind v4 @theme block) from src/index.ts.
// `--check` fails if the committed file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { color, font, motion, radius, space, text, tracking } from "../src/index";

const lines = [
  "/* Generated from src/index.ts by scripts/build-css.ts. Do not edit by hand. */",
  "@theme {",
  "  /* Clear Tailwind's defaults so a face can only use Fortitudo tokens. */",
  "  --color-*: initial;",
  "  --font-*: initial;",
  "  --radius-*: initial;",
  "  --shadow-*: initial;",
  "  --inset-shadow-*: initial;",
  "  --drop-shadow-*: initial;",
  "  --text-*: initial;",
  "",
  ...Object.entries(color).map(([k, v]) => `  --color-${k}: ${v};`),
  "",
  `  --font-serif: var(--font-serif-face, "${font.serif.family}"), ${font.serif.fallback};`,
  `  --font-sans: var(--font-sans-face, "${font.sans.family}"), ${font.sans.fallback};`,
  "",
  ...Object.entries(text).map(([k, v]) => `  --text-${k}: ${v};`),
  `  --tracking-label: ${tracking.label};`,
  "",
  ...Object.entries(space).map(([k, v]) => `  --spacing-${k}: ${v};`),
  "",
  `  --radius-sm: ${radius.sm};`,
  "",
  `  --ease-calm: ${motion.ease};`,
  `  --default-transition-duration: ${motion.duration};`,
  `  --default-transition-timing-function: ${motion.ease};`,
  "}",
  "",
];
const css = lines.join("\n");
const out = new URL("../tokens.css", import.meta.url);

if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== css) {
    console.error("tokens.css is out of date: run pnpm --filter @fortitudo/tokens build");
    process.exit(1);
  }
  console.log("tokens.css is up to date");
} else {
  writeFileSync(out, css);
  console.log("wrote tokens.css");
}

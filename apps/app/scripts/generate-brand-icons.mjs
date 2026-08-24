// Render the BASE app icons and favicons from the Solvigo Airways mark.
//
// Division of labour: this owns the base artwork (favicons, apple-touch, and
// the 192/512 tile + maskable icons). `generate-pwa-icons.mjs` then derives the
// eight colour variants and their manifests FROM these files by tinting, so the
// base set must exist first. Both read one source geometry, so no surface can
// drift from the brand sheet.
//
// Usage: node scripts/generate-brand-icons.mjs [--check]

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(appDir, "public");
const checkOnly = process.argv.includes("--check");

// The lockup sheet's plate + facet spec. The jet never changes; only the plate.
const PLATE_DARK = { plate: "#2A2927", border: "#3F3E3C", shadow: "#000000" };
const PLATE_LIGHT = { plate: "#E2E0D9", border: "#D2D0C9", shadow: "#BEBCB4" };
const PLATE_DEV = { plate: "#F54E00", border: "#F54E00", shadow: "#00000055" };

/** The delta jet: rotated 45°, nose to top right, cast shadow running off it. */
function jet(shadow) {
  return `<g transform="translate(2.85 -2.85) rotate(45 32 32)">
    <polygon points="8,48 8,130 56,130 56,48 38,44 32,52 26,44" fill="${shadow}"/>
    <polygon points="32,4 32,52 38,44 56,48" fill="#D7D5D3"/>
    <polygon points="32,4 8,48 26,44 32,52" fill="#FFFFFF"/>
  </g>`;
}

/**
 * `maskable` renders the launcher variant: the plate colour runs full-bleed
 * (the platform supplies its own silhouette and crops hard) and the jet is
 * scaled into the safe zone. Drawing the rounded plate there too would read as
 * a badge inside a badge once the OS rounds it.
 */
function markSvg(tone, { maskable = false } = {}) {
  if (maskable) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${tone.plate}"/>
  <g transform="translate(12.8 12.8) scale(0.6)">${jet(tone.shadow)}</g>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><clipPath id="c"><rect width="64" height="64" rx="4.5"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="64" height="64" fill="${tone.plate}"/>
    ${jet(tone.shadow)}
  </g>
  <rect x="0.5" y="0.5" width="63" height="63" rx="4" fill="none" stroke="${tone.border}"/>
</svg>`;
}

// [filename, svg, pixel size]
const base = [
  // Browser tab. bb swaps -dark when the OS is dark, -dev in development.
  ["favicon-16x16.png", markSvg(PLATE_DARK), 16],
  ["favicon-32x32.png", markSvg(PLATE_DARK), 32],
  ["favicon-16x16-dark.png", markSvg(PLATE_LIGHT), 16],
  ["favicon-32x32-dark.png", markSvg(PLATE_LIGHT), 32],
  // A dev tab wears the orange plate so it is obvious at a glance.
  ["favicon-16x16-dev.png", markSvg(PLATE_DEV), 16],
  ["favicon-32x32-dev.png", markSvg(PLATE_DEV), 32],

  ["apple-touch-icon.png", markSvg(PLATE_DARK), 180],
  ["icon-192.png", markSvg(PLATE_DARK), 192],
  ["icon-512.png", markSvg(PLATE_DARK), 512],
  ["icon-192-maskable.png", markSvg(PLATE_DARK, { maskable: true }), 192],
  ["icon-512-maskable.png", markSvg(PLATE_DARK, { maskable: true }), 512],
];

const mismatches = [];

for (const [fileName, svg, size] of base) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const filePath = join(publicDir, fileName);
  if (!checkOnly) {
    await writeFile(filePath, png);
    continue;
  }
  if (!existsSync(filePath)) {
    mismatches.push(fileName);
    continue;
  }
  const existing = await readFile(filePath);
  if (!existing.equals(png)) mismatches.push(fileName);
}

if (mismatches.length > 0) {
  console.error(
    [
      "Base brand icons are out of date:",
      ...mismatches.map((fileName) => `  ${fileName}`),
      "Run `pnpm --filter @bb/app generate:brand-icons`.",
    ].join("\n"),
  );
  process.exitCode = 1;
} else if (!checkOnly) {
  console.log(`${base.length} base brand icons written to ${publicDir}`);
}

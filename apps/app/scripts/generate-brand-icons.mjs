// Render the BASE app icons and favicons from the Solvigo Airways PNG package.
//
// Division of labour: this owns the base artwork (favicons, apple-touch, and
// the 192/512 tile + maskable icons). `generate-pwa-icons.mjs` then derives the
// eight colour variants and their manifests FROM these files by tinting, so the
// base set must exist first. Both source images come directly from the final
// brand package, so no generated surface can drift from the approved artwork.
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

const brandDir = join(publicDir, "brand");
const brandPngDir = join(brandDir, "png");
// The tab icon is the mono app-icon tile the operator chose. It is a SEPARATE
// source from the mono jet on purpose: that one still draws the sidebar lockup
// and the welcome mark, and swapping the file would have moved those too.
const faviconTile = await readFile(
  join(brandPngDir, "app-icon-mono-favicon-256.png"),
);
const appIcon = await readFile(join(brandPngDir, "app-icon-mono-1024.png"));

// [filename, source image, pixel size]
const base = [
  // The browser tab uses the approved app-icon tile in every scheme. Tint and
  // unread-attention variants are derived from these bases.
  ["favicon-16x16.png", faviconTile, 16],
  ["favicon-32x32.png", faviconTile, 32],
  ["favicon-16x16-dark.png", faviconTile, 16],
  ["favicon-32x32-dark.png", faviconTile, 32],
  ["favicon-16x16-dev.png", faviconTile, 16],
  ["favicon-32x32-dev.png", faviconTile, 32],

  // Larger launch surfaces use the package's dedicated app-icon composition.
  ["apple-touch-icon.png", appIcon, 180],
  ["icon-192.png", appIcon, 192],
  ["icon-512.png", appIcon, 512],
  ["icon-192-maskable.png", appIcon, 192],
  ["icon-512-maskable.png", appIcon, 512],
];

const mismatches = [];

for (const [fileName, sourceImage, size] of base) {
  const png = await sharp(sourceImage).resize(size, size).png().toBuffer();
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

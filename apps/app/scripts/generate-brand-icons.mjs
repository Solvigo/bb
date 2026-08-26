// Render the BASE app icons and favicons from the Solvigo Airways mark.
//
// Division of labour: this owns the base artwork (favicons, apple-touch, and
// the 192/512 tile + maskable icons). `generate-pwa-icons.mjs` then derives the
// eight colour variants and their manifests FROM these files by tinting, so the
// base set must exist first. Both source files come directly from the final
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
const flatIcon = await readFile(join(brandDir, "app-icon-flat-mono.svg"));
const depthIcon = await readFile(join(brandDir, "app-icon-mono.svg"));

// [filename, svg, pixel size]
const base = [
  // The package explicitly provides the flat mark for sizes below 48px.
  ["favicon-16x16.png", flatIcon, 16],
  ["favicon-32x32.png", flatIcon, 32],
  ["favicon-16x16-dark.png", flatIcon, 16],
  ["favicon-32x32-dark.png", flatIcon, 32],
  ["favicon-16x16-dev.png", flatIcon, 16],
  ["favicon-32x32-dev.png", flatIcon, 32],

  // Larger launch surfaces can carry the white depth treatment in full.
  ["apple-touch-icon.png", depthIcon, 180],
  ["icon-192.png", depthIcon, 192],
  ["icon-512.png", depthIcon, 512],
  ["icon-192-maskable.png", depthIcon, 192],
  ["icon-512-maskable.png", depthIcon, 512],
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

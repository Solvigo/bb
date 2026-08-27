const AIRWAYS_BRAND_PNG_BASE_URL = "/brand/png";

/**
 * The complete approved raster brand package. Keeping the filenames typed and
 * centralized makes every supplied variant directly usable without scattering
 * string literals through product UI.
 */
export const AIRWAYS_BRAND_PNG_FILES = [
  "app-icon-ember-1024.png",
  "app-icon-ember-256.png",
  "app-icon-flat-ember-128.png",
  "app-icon-flat-ember-32.png",
  "app-icon-flat-ember-64.png",
  "app-icon-flat-graphite-128.png",
  "app-icon-flat-graphite-32.png",
  "app-icon-flat-graphite-64.png",
  "app-icon-flat-mono-128.png",
  "app-icon-flat-mono-32.png",
  "app-icon-flat-mono-64.png",
  "app-icon-graphite-1024.png",
  "app-icon-graphite-256.png",
  "app-icon-mono-1024.png",
  "app-icon-mono-256.png",
  "app-icon-outline-ember-256.png",
  "app-icon-outline-ember-64.png",
  "app-icon-outline-mono-256.png",
  "app-icon-outline-mono-64.png",
  "jet-embossed-ember-1024.png",
  "jet-embossed-graphite-1024.png",
  "jet-embossed-mono-1024.png",
  "jet-flat-ember-256.png",
  "jet-flat-graphite-256.png",
  "jet-flat-mono-256.png",
  "jet-outline-ember-256.png",
  "jet-outline-ember-64.png",
  "jet-outline-graphite-256.png",
  "jet-outline-graphite-64.png",
  "jet-outline-mono-256.png",
  "jet-outline-mono-64.png",
  "lockup-ember-on-dark.png",
  "lockup-ember-on-light.png",
  "lockup-mono-on-dark.png",
  "lockup-mono-on-light.png",
  "mark-black-1024.png",
  "mark-ember-1024.png",
  "mark-white-1024.png",
  "wordmark-depth-on-dark-nocap.png",
  "wordmark-depth-on-dark.png",
  "wordmark-depth-on-light-nocap.png",
  "wordmark-depth-on-light.png",
  "wordmark-embossed-ember-nocap.png",
  "wordmark-embossed-ember.png",
  "wordmark-embossed-mono-nocap.png",
  "wordmark-embossed-mono.png",
  "wordmark-flat-on-dark-nocap.png",
  "wordmark-flat-on-dark.png",
  "wordmark-flat-on-light-nocap.png",
  "wordmark-flat-on-light.png",
  "wordmark-outline-ember-nocap.png",
  "wordmark-outline-ember.png",
  "wordmark-outline-mono-nocap.png",
  "wordmark-outline-mono.png",
] as const;

export type AirwaysBrandPngFile = (typeof AIRWAYS_BRAND_PNG_FILES)[number];
export type AirwaysBrandPngUrl =
  `${typeof AIRWAYS_BRAND_PNG_BASE_URL}/${AirwaysBrandPngFile}`;

export function getAirwaysBrandPngUrl(
  fileName: AirwaysBrandPngFile,
): AirwaysBrandPngUrl {
  return `${AIRWAYS_BRAND_PNG_BASE_URL}/${fileName}`;
}

/** Semantic defaults currently used by the app shell. */
export const AIRWAYS_BRAND_ASSETS = {
  favicon: getAirwaysBrandPngUrl("jet-embossed-mono-1024.png"),
  largeMark: getAirwaysBrandPngUrl("jet-embossed-mono-1024.png"),
  smallMark: getAirwaysBrandPngUrl("jet-flat-mono-256.png"),
  sidebarWordmark: getAirwaysBrandPngUrl(
    "wordmark-embossed-mono-nocap.png",
  ),
} as const;

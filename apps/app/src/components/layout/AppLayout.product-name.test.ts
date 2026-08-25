import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "@/lib/product";

const APP_LAYOUT_SOURCE = readFileSync(
  fileURLToPath(new URL("./AppLayout.tsx", import.meta.url)),
  "utf8",
);

// The document title is produced in three places here: an explicit entry per
// route, and two fallbacks for routes that have none. Each was renamed on its
// own, and the explicit "/" entry — the route the app opens on — survived two
// rounds of fixing the fallbacks. Naming the product anywhere in this file
// other than through the shared constant is what lets that happen again.
describe("AppLayout document title", () => {
  it("names the product only through the shared constant", () => {
    const literalProductNames =
      APP_LAYOUT_SOURCE.match(/title:\s*"[^"]*"/g)?.filter((match) =>
        match.includes(PRODUCT_NAME),
      ) ?? [];

    expect(literalProductNames).toEqual([]);
  });

  it("gives the app root an explicit product-named title", () => {
    expect(APP_LAYOUT_SOURCE).toMatch(/"\/":\s*\{\s*title:\s*PRODUCT_NAME\s*\}/);
  });
});

import { describe, expect, it } from "vitest";
import {
  ariaLevelFor,
  elbowGeometry,
  railIndentPx,
  spacingBetween,
} from "./treeLayout";

describe("railIndentPx", () => {
  it("indents 22px per level up to the clamp", () => {
    expect(railIndentPx(0)).toBe(0);
    expect(railIndentPx(1)).toBe(22);
    expect(railIndentPx(5)).toBe(110);
  });

  it("degrades to a smaller step past the clamp so a deep chain never blows out horizontally", () => {
    const atClamp = railIndentPx(5);
    const oneDeeper = railIndentPx(6);
    const farDeeper = railIndentPx(40);
    expect(oneDeeper - atClamp).toBe(8);
    // Even 35 levels past the clamp stays well short of what unclamped 22px
    // steps would produce (35 * 22 = 770px).
    expect(farDeeper).toBeLessThan(atClamp + 35 * 22);
    expect(farDeeper).toBeGreaterThan(atClamp);
  });

  it("never decreases as depth grows", () => {
    let previous = railIndentPx(0);
    for (let depth = 1; depth <= 50; depth++) {
      const current = railIndentPx(depth);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe("elbowGeometry", () => {
  it("spans from the parent rail to the row's own indent", () => {
    const { left, width } = elbowGeometry(1);
    expect(left).toBe(10);
    expect(width).toBe(railIndentPx(1) - 10);
  });

  it("keeps a visible stub even where the clamp shrinks the gap below the rail offset", () => {
    const { width } = elbowGeometry(40);
    expect(width).toBeGreaterThanOrEqual(4);
  });
});

describe("ariaLevelFor", () => {
  it("is 1-based, matching the aria-level contract", () => {
    expect(ariaLevelFor(0)).toBe(1);
    expect(ariaLevelFor(3)).toBe(4);
  });
});

describe("spacingBetween", () => {
  it("treats the first row as a tight sibling with nothing above it", () => {
    expect(spacingBetween(0, null)).toBe("sibling");
  });

  it("opens a new family when a row lands back on a root", () => {
    expect(spacingBetween(0, 2)).toBe("family");
  });

  it("opens a new branch when depth drops without returning to a root", () => {
    expect(spacingBetween(1, 2)).toBe("branch");
  });

  it("keeps descendants and next-siblings tight", () => {
    expect(spacingBetween(2, 1)).toBe("sibling");
    expect(spacingBetween(2, 2)).toBe("sibling");
  });
});

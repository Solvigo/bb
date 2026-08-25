import { describe, expect, it } from "vitest";
import { stripRankPrefix } from "./agent-title";

describe("stripRankPrefix", () => {
  it("strips substrate rank prefixes in their stored spellings", () => {
    expect(stripRankPrefix("SP · fixture dispatch")).toBe("fixture dispatch");
    expect(stripRankPrefix("PLT · x")).toBe("x");
    expect(stripRankPrefix("cm_y")).toBe("y");
    expect(stripRankPrefix("sp-shell")).toBe("shell");
  });

  it("leaves operator vocabulary alone", () => {
    expect(stripRankPrefix("Lead · shell")).toBe("Lead · shell");
  });

  it("does not mangle a word that merely starts with a rank's letters", () => {
    // guards the separator character class: no separator, no strip
    expect(stripRankPrefix("Speculative work")).toBe("Speculative work");
    expect(stripRankPrefix("cmd runner")).toBe("cmd runner");
  });
});

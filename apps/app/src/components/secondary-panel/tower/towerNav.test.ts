import { describe, expect, it } from "vitest";
import { parseTowerLink } from "./towerNav";

describe("parseTowerLink", () => {
  it("still navigates to brief", () => {
    expect(parseTowerLink("bb-tower:brief")).toEqual({ view: "brief" });
    expect(parseTowerLink("bb-tower:/brief")).toEqual({ view: "brief" });
  });

  it("does not parse removed crew or SP drill-in routes", () => {
    expect(parseTowerLink("bb-tower:crew")).toBeNull();
    expect(parseTowerLink("bb-tower:sp/thr_sortie")).toBeNull();
  });

  it("ignores unrelated hrefs", () => {
    expect(parseTowerLink("https://example.com")).toBeNull();
    expect(parseTowerLink("bb-tower:clearance")).toBeNull();
  });
});

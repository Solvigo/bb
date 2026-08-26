import { describe, expect, it } from "vitest";
import { createThreadRequestSchema } from "../src/index.js";

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj_1",
    origin: "app",
    environment: { type: "project-default" },
    input: [],
    ...overrides,
  };
}

describe("createThreadRequestSchema empty-input rule", () => {
  it("rejects an input-less handover: it never clones a session, so it needs its own input", () => {
    const result = createThreadRequestSchema.safeParse(
      baseRequest({
        originKind: "handover",
        sourceThreadId: "thr_source",
      }),
    );
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) => issue.message === "input must contain at least one entry",
      ),
    ).toBe(true);
  });

  it("still allows an input-less fork: it clones the source session, so it has history without new input", () => {
    const result = createThreadRequestSchema.safeParse(
      baseRequest({
        originKind: "fork",
        sourceThreadId: "thr_source",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an input-less normal start (no originKind), unchanged from before", () => {
    const result = createThreadRequestSchema.safeParse(baseRequest());
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) => issue.message === "input must contain at least one entry",
      ),
    ).toBe(true);
  });

  it("allows a handover with input", () => {
    const result = createThreadRequestSchema.safeParse(
      baseRequest({
        originKind: "handover",
        sourceThreadId: "thr_source",
        input: [{ type: "text", text: "taking over", mentions: [] }],
      }),
    );
    expect(result.success).toBe(true);
  });
});

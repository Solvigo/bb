import { describe, expect, it } from "vitest";
import {
  BROWSER_VERB,
  CREATED_BY,
  TARGET_FIELD,
} from "../src/api/browser-grammar.js";
import {
  browserClickCoordinatesRequestSchema,
  browserClickRequestSchema,
  browserClickSelectorRequestSchema,
  browserCloseResultSchema,
  browserEvalRequestSchema,
  browserEvalResultSchema,
  browserListResponseSchema,
  browserNavigateRequestSchema,
  browserOpenRequestSchema,
  browserSnapshotSchema,
  browserTargetRefRequestSchema,
  browserTargetSchema,
  browserThreadScopeQuerySchema,
  browserTypeRequestSchema,
} from "../src/api/browser.js";

describe("browser automation contracts", () => {
  const sampleTarget = {
    [TARGET_FIELD.targetId]: "tgt_sample",
    [TARGET_FIELD.threadId]: "thr_sample",
    [TARGET_FIELD.createdBy]: CREATED_BY.agent,
    [TARGET_FIELD.visible]: true,
    [TARGET_FIELD.createdAt]: "2026-08-27T00:00:00.000Z",
    [TARGET_FIELD.lastUsedAt]: "2026-08-27T00:00:00.000Z",
  };

  it("round-trips target ownership rows", () => {
    expect(browserTargetSchema.parse(sampleTarget)).toEqual(sampleTarget);
  });

  it("round-trips snapshot payloads", () => {
    const snapshot = {
      target: sampleTarget,
      url: "https://example.com",
      title: "Example",
      text: "hello",
    };
    expect(browserSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("round-trips list, close, eval, and click shapes", () => {
    expect(
      browserListResponseSchema.parse({ targets: [sampleTarget] }),
    ).toEqual({ targets: [sampleTarget] });
    expect(
      browserCloseResultSchema.parse({ closed: true, target: sampleTarget }),
    ).toEqual({ closed: true, target: sampleTarget });
    expect(
      browserEvalResultSchema.parse({
        target: sampleTarget,
        result: { ok: true },
      }),
    ).toEqual({ target: sampleTarget, result: { ok: true } });
    expect(
      browserClickSelectorRequestSchema.parse({
        targetId: "tgt_sample",
        selector: "button[type=submit]",
      }),
    ).toEqual({
      targetId: "tgt_sample",
      selector: "button[type=submit]",
    });
    expect(
      browserClickCoordinatesRequestSchema.parse({
        targetId: "tgt_sample",
        x: 12,
        y: 24,
      }),
    ).toEqual({ targetId: "tgt_sample", x: 12, y: 24 });
    expect(
      browserClickRequestSchema.parse({
        targetId: "tgt_sample",
        selector: "#email",
      }),
    ).toEqual({ targetId: "tgt_sample", selector: "#email" });
  });

  it("round-trips verb request payloads", () => {
    expect(
      browserOpenRequestSchema.parse({
        url: "https://example.com",
        visible: true,
      }),
    ).toEqual({ url: "https://example.com", visible: true });
    expect(
      browserNavigateRequestSchema.parse({
        targetId: "tgt_sample",
        url: "https://example.org",
      }),
    ).toEqual({ targetId: "tgt_sample", url: "https://example.org" });
    expect(
      browserTargetRefRequestSchema.parse({ targetId: "tgt_sample" }),
    ).toEqual({ targetId: "tgt_sample" });
    expect(
      browserTypeRequestSchema.parse({
        targetId: "tgt_sample",
        selector: "#email",
        text: "user@example.com",
      }),
    ).toEqual({
      targetId: "tgt_sample",
      selector: "#email",
      text: "user@example.com",
    });
    expect(
      browserEvalRequestSchema.parse({
        targetId: "tgt_sample",
        script: "document.title",
      }),
    ).toEqual({ targetId: "tgt_sample", script: "document.title" });
    expect(browserThreadScopeQuerySchema.parse({})).toEqual({});
    expect(browserThreadScopeQuerySchema.parse({ thread: "thr_other" })).toEqual({
      thread: "thr_other",
    });
  });

  it("rejects client-claimed createdBy on targets", () => {
    expect(
      browserTargetSchema.safeParse({
        ...sampleTarget,
        createdBy: CREATED_BY.cli,
      }).success,
    ).toBe(true);
    expect(
      browserOpenRequestSchema.safeParse({
        url: "https://example.com",
        createdBy: CREATED_BY.agent,
      }).success,
    ).toBe(false);
  });

  it("keeps navigate as a shared verb name", () => {
    expect(BROWSER_VERB.navigate).toBe("navigate");
  });
});

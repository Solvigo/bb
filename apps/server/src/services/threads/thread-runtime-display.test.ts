import { describe, expect, it } from "vitest";
import type { Thread } from "@bb/domain";
import { toPublicThread } from "./thread-runtime-display.js";

function threadRow(overrides: Partial<Thread>): Thread {
  return {
    id: "thr_1",
    projectId: "prj_1",
    environmentId: null,
    providerId: "claude",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("toPublicThread", () => {
  it("strips the stored substrate rank prefix from the title", () => {
    const thread = toPublicThread(
      threadRow({ title: "SP · fixture dispatch" }),
    );
    expect(thread.title).toBe("fixture dispatch");
  });

  it("strips titleFallback the same way", () => {
    const thread = toPublicThread(threadRow({ titleFallback: "cm_y" }));
    expect(thread.titleFallback).toBe("y");
  });

  it("preserves null-ness — two consumers read the null as a signal", () => {
    const thread = toPublicThread(
      threadRow({ title: null, titleFallback: "PLT · x" }),
    );
    expect(thread.title).toBeNull();
    expect(thread.titleFallback).toBe("x");
  });

  it("leaves a title that merely starts with a rank's letters alone", () => {
    const thread = toPublicThread(threadRow({ title: "Speculative work" }));
    expect(thread.title).toBe("Speculative work");
  });
});

import { describe, expect, it } from "vitest";
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import {
  hasExpired,
  latestUndoTarget,
  partitionExpired,
  remainingMs,
  remainingSeconds,
  UNDO_SEND_WINDOW_MS,
  withoutEntry,
  type PendingSend,
} from "./undoSendQueue";

function pendingSend(id: string, expiresAt: number, text = id): PendingSend {
  return {
    id,
    draft: { ...emptyPromptDraftState(), text },
    input: [{ type: "text", text, mentions: [] }],
    dispatch: { kind: "auto" },
    expiresAt,
  };
}

describe("remainingMs", () => {
  it("counts down to the expiry", () => {
    expect(remainingMs(pendingSend("a", 3000), 1200)).toBe(1800);
  });

  it("never goes negative once the window has closed", () => {
    expect(remainingMs(pendingSend("a", 3000), 9000)).toBe(0);
  });
});

describe("remainingSeconds", () => {
  it("shows the full window before any time has passed", () => {
    expect(remainingSeconds(pendingSend("a", UNDO_SEND_WINDOW_MS), 0)).toBe(3);
  });

  it("still shows a second while any time is left", () => {
    expect(remainingSeconds(pendingSend("a", 3000), 2999)).toBe(1);
  });

  it("shows zero at expiry", () => {
    expect(remainingSeconds(pendingSend("a", 3000), 3000)).toBe(0);
  });
});

describe("hasExpired", () => {
  it("expires exactly on the boundary", () => {
    expect(hasExpired(pendingSend("a", 3000), 3000)).toBe(true);
    expect(hasExpired(pendingSend("a", 3000), 2999)).toBe(false);
  });
});

describe("partitionExpired", () => {
  it("keeps expired entries in the order they were sent", () => {
    const entries = [
      pendingSend("first", 1000),
      pendingSend("second", 2000),
      pendingSend("third", 9000),
    ];

    const { expired, waiting } = partitionExpired(entries, 2500);

    expect(expired.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(waiting.map((entry) => entry.id)).toEqual(["third"]);
  });

  it("returns nothing to dispatch while every window is open", () => {
    const entries = [pendingSend("a", 5000), pendingSend("b", 6000)];

    const { expired, waiting } = partitionExpired(entries, 100);

    expect(expired).toEqual([]);
    expect(waiting).toHaveLength(2);
  });
});

describe("latestUndoTarget", () => {
  it("undoes the most recent send", () => {
    const entries = [pendingSend("older", 1000), pendingSend("newer", 2000)];

    expect(latestUndoTarget(entries)?.id).toBe("newer");
  });

  it("has nothing to undo on an empty queue", () => {
    expect(latestUndoTarget([])).toBeNull();
  });
});

describe("withoutEntry", () => {
  it("drops only the named entry and keeps order", () => {
    const entries = [
      pendingSend("a", 1000),
      pendingSend("b", 2000),
      pendingSend("c", 3000),
    ];

    expect(withoutEntry(entries, "b").map((entry) => entry.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("is a no-op for an id that is no longer queued", () => {
    const entries = [pendingSend("a", 1000)];

    expect(withoutEntry(entries, "gone")).toHaveLength(1);
  });
});

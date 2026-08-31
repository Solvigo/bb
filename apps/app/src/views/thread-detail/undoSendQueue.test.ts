import { describe, expect, it } from "vitest";
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import {
  escapeShouldUndo,
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
  it("tells the truth about a window that is not a whole number of seconds", () => {
    // It read 2 over a 1.5s window: time the operator never had. Whole
    // seconds cannot describe this window, so the countdown does not try.
    expect(remainingSeconds(pendingSend("a", UNDO_SEND_WINDOW_MS), 0)).toBe(
      1.5,
    );
  });

  it("never claims more time than is left", () => {
    expect(remainingSeconds(pendingSend("a", 3000), 1050)).toBe(1.9);
    expect(remainingSeconds(pendingSend("a", 3000), 1099)).toBe(1.9);
  });

  it("still shows time left while any remains, however little", () => {
    // The older intent, kept: a 0 beside a live Undo says the chance has gone
    // when it has not.
    expect(remainingSeconds(pendingSend("a", 3000), 2999)).toBe(0.1);
    expect(remainingSeconds(pendingSend("a", 3000), 2951)).toBe(0.1);
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

describe("escapeShouldUndo", () => {
  const open = {
    hasPending: true,
    defaultPrevented: false,
    isOverlayOpen: false,
  };

  it("undoes inside an open window", () => {
    expect(escapeShouldUndo(open)).toBe(true);
  });

  it("leaves Escape alone once nothing is pending", () => {
    expect(escapeShouldUndo({ ...open, hasPending: false })).toBe(false);
  });

  it("yields to an overlay that already owns Escape", () => {
    expect(escapeShouldUndo({ ...open, isOverlayOpen: true })).toBe(false);
  });

  it("yields to a handler that already claimed the keypress", () => {
    expect(escapeShouldUndo({ ...open, defaultPrevented: true })).toBe(false);
  });
});

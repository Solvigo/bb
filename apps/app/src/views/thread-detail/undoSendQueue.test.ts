import { describe, expect, it } from "vitest";
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import {
  escapeShouldUndo,
  hasExpired,
  latestUndoTarget,
  partitionExpired,
  remainingMs,
  remainingLabel,
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
  it("floors, so it can never claim time that is not there", () => {
    expect(remainingSeconds(pendingSend("a", UNDO_SEND_WINDOW_MS), 0)).toBe(1.5);
    expect(remainingSeconds(pendingSend("a", 3000), 1050)).toBe(1.9);
    expect(remainingSeconds(pendingSend("a", 3000), 1099)).toBe(1.9);
  });

  it("is honestly zero in the final sliver under a tenth", () => {
    // Not what the countdown SHOWS there — see remainingLabel — but what is
    // actually true to a tenth of a second.
    expect(remainingSeconds(pendingSend("a", 3000), 2999)).toBe(0);
  });
});

describe("remainingLabel", () => {
  it("tells the truth about a window that is not a whole number of seconds", () => {
    // It read "2s" over a 1.5s window: time the operator never had.
    expect(remainingLabel(pendingSend("a", UNDO_SEND_WINDOW_MS), 0)).toBe(
      "1.5s",
    );
  });

  it("never claims more time than remains", () => {
    expect(remainingLabel(pendingSend("a", 3000), 1099)).toBe("1.9s");
  });

  it("names the last sliver instead of rounding it up", () => {
    // "0.1s" here claimed a tenth of a second that was not there — the same
    // overstatement as the old "2s", one order of magnitude down.
    expect(remainingLabel(pendingSend("a", 3000), 2999)).toBe("<0.1s");
    expect(remainingLabel(pendingSend("a", 3000), 2901)).toBe("<0.1s");
  });

  it("never reads zero while any time remains", () => {
    for (const now of [0, 1400, 1499]) {
      expect(remainingLabel(pendingSend("a", UNDO_SEND_WINDOW_MS), now)).not.toBe(
        "0s",
      );
    }
  });

  it("reads zero at expiry", () => {
    expect(remainingLabel(pendingSend("a", 3000), 3000)).toBe("0s");
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

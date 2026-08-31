// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingSendList } from "./PendingSendList";
import type { PendingSend } from "@/views/thread-detail/undoSendQueue";

describe("PendingSendList", () => {
  it("renders a persistent, empty polite live region when idle", () => {
    render(<PendingSendList entries={[]} now={1000} onUndo={vi.fn()} />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.textContent).toBe("");
  });

  it("updates the live region text when a send goes pending", () => {
    const { rerender } = render(
      <PendingSendList entries={[]} now={1000} onUndo={vi.fn()} />
    );

    const pendingSend: PendingSend = {
      id: "send1",
      draft: { text: "hello world", files: [] },
      input: [{ type: "text", text: "hello world" }],
      dispatch: { kind: "auto" },
      expiresAt: 2500,
    };

    rerender(
      <PendingSendList
        entries={[pendingSend]}
        now={1000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
  });

  it("does not update the live region text on every tick", () => {
    const pendingSend: PendingSend = {
      id: "send1",
      draft: { text: "hello world", files: [] },
      input: [{ type: "text", text: "hello world" }],
      dispatch: { kind: "auto" },
      expiresAt: 2500,
    };

    const { rerender } = render(
      <PendingSendList
        entries={[pendingSend]}
        now={1000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    const liveRegion = screen.getByRole("status");
    const initialText = liveRegion.textContent;

    // Simulate clock ticking by advancing `now`
    rerender(
      <PendingSendList
        entries={[pendingSend]}
        now={1200}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    expect(liveRegion.textContent).toBe(initialText);
  });

  it("announces a newly added second send once, without repeating existing, and does not announce on removal", () => {
    const pendingSend1: PendingSend = {
      id: "send1",
      draft: { text: "hello world", files: [] },
      input: [{ type: "text", text: "hello world" }],
      dispatch: { kind: "auto" },
      expiresAt: 2500,
    };

    const { rerender } = render(
      <PendingSendList
        entries={[pendingSend1]}
        now={1000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");

    const pendingSend2: PendingSend = {
      id: "send2",
      draft: { text: "second message", files: [] },
      input: [{ type: "text", text: "second message" }],
      dispatch: { kind: "auto" },
      expiresAt: 3000,
    };

    // Add second send
    rerender(
      <PendingSendList
        entries={[pendingSend1, pendingSend2]}
        now={1500}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );
    // Should ONLY announce the second send to avoid repeating the first
    expect(liveRegion.textContent).toBe("Sending second message. Undo available for 1.5 seconds.");

    // Remove second send (e.g., undo or expired)
    rerender(
      <PendingSendList
        entries={[pendingSend1]}
        now={2000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );
    // Should not re-announce the first send, so the text should remain the same
    expect(liveRegion.textContent).toBe("Sending second message. Undo available for 1.5 seconds.");

    // Remove all sends
    rerender(
      <PendingSendList
        entries={[]}
        now={2500}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );
    // Should be completely empty when idle
    expect(liveRegion.textContent).toBe("");
  });
});

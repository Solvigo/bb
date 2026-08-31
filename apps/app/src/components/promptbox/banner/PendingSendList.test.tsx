// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingSendList } from "./PendingSendList";
import type { PendingSend } from "@/views/thread-detail/undoSendQueue";

describe("PendingSendList", () => {
  it("renders a persistent, empty polite live region when idle", () => {
    render(<PendingSendList entries={[]} now={1000} onUndo={vi.fn()} />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion.textContent).toBe("");
  });

  it("updates the live region text when a send goes pending", () => {
    const { rerender } = render(
      <PendingSendList entries={[]} now={1000} onUndo={vi.fn()} />
    );

    const pendingSend: PendingSend = {
      id: "send1",
      draft: { text: "hello world" },
      resolvedAt: 1000,
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
      draft: { text: "hello world" },
      resolvedAt: 1000,
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
});

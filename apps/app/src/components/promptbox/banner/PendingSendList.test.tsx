// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingSendList, PendingSendLiveRegion } from "./PendingSendList";
import type { PendingSend } from "@/views/thread-detail/undoSendQueue";
import { emptyPromptDraftState } from "@/lib/prompt-draft";

afterEach(cleanup);

function pendingSend(id: string, expiresAt: number, text = id): PendingSend {
  return {
    id,
    draft: { ...emptyPromptDraftState(), text },
    input: [{ type: "text", text, mentions: [] }],
    dispatch: { kind: "auto" },
    expiresAt,
  };
}

describe("PendingSendLiveRegion", () => {
  it("renders a persistent, empty polite live region when idle", () => {
    render(<PendingSendLiveRegion entries={[]} />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.textContent).toBe("");
  });

  it("updates the live region text when a send goes pending", () => {
    const { rerender } = render(
      <PendingSendLiveRegion entries={[]} />
    );

    const send1 = pendingSend("send1", 2500, "hello world");

    rerender(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
  });

  it("does not update the live region text on every tick", () => {
    const send1 = pendingSend("send1", 2500, "hello world");

    const { rerender } = render(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );

    const liveRegion = screen.getByRole("status");
    const initialText = liveRegion.textContent;

    // Re-render with same entries (simulate clock tick which might cause re-render if it was bound to now)
    rerender(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );

    expect(liveRegion.textContent).toBe(initialText);
  });

  it("announces a newly added second send once, without repeating existing, and clears on removal", () => {
    const send1 = pendingSend("send1", 2500, "hello world");

    const { rerender } = render(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");

    const send2 = pendingSend("send2", 3000, "second message");

    // Add second send
    rerender(
      <PendingSendLiveRegion
        entries={[send1, send2]}
        windowMs={1500}
      />
    );
    // Should ONLY announce the second send to avoid repeating the first
    expect(liveRegion.textContent).toBe("Sending second message. Undo available for 1.5 seconds.");

    // Remove second send (e.g., undo or expired)
    rerender(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );
    // Should clear the announcement so it doesn't leave stale text, but shouldn't re-announce the first send
    expect(liveRegion.textContent).toBe("");

    // Remove all sends
    rerender(
      <PendingSendLiveRegion
        entries={[]}
        windowMs={1500}
      />
    );
    // Should remain completely empty when idle
    expect(liveRegion.textContent).toBe("");
  });

  it("re-announces an ID if it is removed and then re-added", () => {
    const send1 = pendingSend("send1", 2500, "hello world");

    const { rerender } = render(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");

    // Remove send1
    rerender(
      <PendingSendLiveRegion
        entries={[]}
        windowMs={1500}
      />
    );
    expect(liveRegion.textContent).toBe("");

    // Re-add send1
    rerender(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
  });

  it("forces a DOM mutation for identical consecutive announcements", () => {
    const send1 = pendingSend("send1", 2500, "hello world");
    const { rerender } = render(
      <PendingSendLiveRegion entries={[send1]} windowMs={1500} />
    );

    const liveRegion = screen.getByRole("status");
    const firstInnerSpan = liveRegion.firstElementChild;
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
    
    // Simulate removing send1 and adding send2 in separate renders but with the same text
    rerender(<PendingSendLiveRegion entries={[]} windowMs={1500} />);
    
    const send2 = pendingSend("send2", 3500, "hello world");
    rerender(<PendingSendLiveRegion entries={[send2]} windowMs={1500} />);
    
    // The text content is the same
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
    
    // But the inner element must be a new DOM node to trigger the screen reader
    const secondInnerSpan = liveRegion.firstElementChild;
    expect(secondInnerSpan).not.toBe(firstInnerSpan);
  });

  it("detects simultaneous remove/add replacement with the same ID", () => {
    const send1 = pendingSend("send1", 2500, "");
    const { rerender } = render(
      <PendingSendLiveRegion entries={[send1]} windowMs={1500} />
    );

    const liveRegion = screen.getByRole("status");
    const firstInnerSpan = liveRegion.firstElementChild;
    
    // Replace send1 with a NEW entry object that has the SAME ID and SAME TEXT (e.g. an empty preview)
    const send1Replacement = pendingSend("send1", 3500, "");
    
    rerender(<PendingSendLiveRegion entries={[send1Replacement]} windowMs={1500} />);
    
    expect(liveRegion.textContent).toBe("Sending . Undo available for 1.5 seconds.");
    
    const secondInnerSpan = liveRegion.firstElementChild;
    expect(secondInnerSpan).not.toBe(firstInnerSpan);
  });
});

describe("PendingSendList", () => {
  it("renders pending sends but no status region", () => {
    const send1 = pendingSend("send1", 2500, "hello world");
    render(
      <PendingSendList
        entries={[send1]}
        now={1000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    // Should NOT have a role="status"
    expect(screen.queryByRole("status")).toBeNull();
    // But it should render the row (which has an aria-label="Message sending" or something similar)
    expect(screen.getByText("Sending")).toBeTruthy();
    expect(screen.getByText("hello world")).toBeTruthy();
  });
});

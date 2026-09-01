// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingSendList, PendingSendLiveRegion } from "./PendingSendList";
import type { PendingSend } from "@/views/thread-detail/undoSendQueue";
import { emptyPromptDraftState } from "@/lib/prompt-draft";
import type { PromptInput } from "@bb/domain";

afterEach(cleanup);

function pendingSend(id: string, expiresAt: number, textOrInput: string | PromptInput[] = id): PendingSend {
  const input: PromptInput[] = typeof textOrInput === "string" 
    ? [{ type: "text", text: textOrInput, mentions: [] }] 
    : textOrInput;
  
  const text = input.filter((i): i is Extract<PromptInput, { type: "text" }> => i.type === "text").map(i => i.text).join("");

  return {
    id,
    draft: { ...emptyPromptDraftState(), text },
    input,
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

    // Re-render with same entries
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

    rerender(
      <PendingSendLiveRegion
        entries={[send1, send2]}
        windowMs={1500}
      />
    );
    expect(liveRegion.textContent).toBe("Sending second message. Undo available for 1.5 seconds.");

    rerender(
      <PendingSendLiveRegion
        entries={[send1]}
        windowMs={1500}
      />
    );
    expect(liveRegion.textContent).toBe("");

    rerender(
      <PendingSendLiveRegion
        entries={[]}
        windowMs={1500}
      />
    );
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

    rerender(
      <PendingSendLiveRegion
        entries={[]}
        windowMs={1500}
      />
    );
    expect(liveRegion.textContent).toBe("");

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
    
    rerender(<PendingSendLiveRegion entries={[]} windowMs={1500} />);
    
    const send2 = pendingSend("send2", 3500, "hello world");
    rerender(<PendingSendLiveRegion entries={[send2]} windowMs={1500} />);
    
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
    
    const secondInnerSpan = liveRegion.firstElementChild;
    expect(secondInnerSpan).not.toBe(firstInnerSpan);
  });

  it("detects genuine same-ID replacement", () => {
    // Start with a send
    const send1 = pendingSend("send1", 2500, "hello world");
    const { rerender } = render(
      <PendingSendLiveRegion entries={[send1]} windowMs={1500} />
    );

    const liveRegion = screen.getByRole("status");
    const firstInnerSpan = liveRegion.firstElementChild;
    
    // Replace send1 with a NEW entry object that has the SAME ID but different expiry
    // (representing a real resend with the same optimistic ID)
    const send1Replacement = pendingSend("send1", 3500, "hello world");
    
    rerender(<PendingSendLiveRegion entries={[send1Replacement]} windowMs={1500} />);
    
    // Since it's a genuine replacement, it should announce again.
    expect(liveRegion.textContent).toBe("Sending hello world. Undo available for 1.5 seconds.");
    
    const secondInnerSpan = liveRegion.firstElementChild;
    expect(secondInnerSpan).not.toBe(firstInnerSpan);
  });

  it("ignores identical reconstruction of an unchanged entry", () => {
    const send1 = pendingSend("send1", 2500, "hello world");
    const { rerender } = render(
      <PendingSendLiveRegion entries={[send1]} windowMs={1500} />
    );

    const liveRegion = screen.getByRole("status");
    const firstInnerSpan = liveRegion.firstElementChild;
    
    // Rerender with a deeply identical but distinct object
    const send1Recreated = { ...send1 };
    
    rerender(<PendingSendLiveRegion entries={[send1Recreated]} windowMs={1500} />);
    
    // The DOM should not have mutated since it's semantically the exact same send
    expect(liveRegion.firstElementChild).toBe(firstInnerSpan);
  });

  it("uses established attachment fallback wording for attachment-only drafts", () => {
    // Provide an attachment-only input
    const input: PromptInput[] = [
      { type: "localFile", path: "test.png", name: "test.png" }
    ];
    const send1 = pendingSend("send1", 2500, input);

    const { rerender } = render(
      <PendingSendLiveRegion entries={[]} windowMs={1500} />
    );

    rerender(<PendingSendLiveRegion entries={[send1]} windowMs={1500} />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion.textContent).toBe("Sending Attachment only (test.png). Undo available for 1.5 seconds.");
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

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Sending")).toBeTruthy();
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("uses attachment fallback for row preview and aria label", () => {
    const input: PromptInput[] = [
      { type: "localFile", path: "test.png", name: "test.png" }
    ];
    const send1 = pendingSend("send1", 2500, input);
    
    render(
      <PendingSendList
        entries={[send1]}
        now={1000}
        windowMs={1500}
        onUndo={vi.fn()}
      />
    );

    // The text content in the row
    expect(screen.getByText("Attachment only (test.png)")).toBeTruthy();

    // The Undo button label
    const undoButton = screen.getByRole("button", { name: 'Undo sending "Attachment only (test.png)"' });
    expect(undoButton).not.toBeNull();
  });
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let threadStatus = "idle";
let executionOptions: unknown = {
  providers: [
    { id: "claude-code", displayName: "Claude Code", available: true },
    { id: "acp-cursor", displayName: "Cursor", available: true },
    { id: "pi", displayName: "Pi", available: false },
  ],
};

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      id: "thr_source",
      projectId: "proj_real",
      providerId: "claude-code",
      status: threadStatus,
    },
  }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemExecutionOptions: () => ({ data: executionOptions }),
}));

import { SwapAgentButton } from "./SwapAgentButton";

describe("the swap control", () => {
  beforeEach(() => {
    threadStatus = "idle";
    executionOptions = {
      providers: [
        { id: "claude-code", displayName: "Claude Code", available: true },
        { id: "acp-cursor", displayName: "Cursor", available: true },
        { id: "pi", displayName: "Pi", available: false },
      ],
    };
    navigate.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers the harnesses this instance has, minus the one it is already on", async () => {
    render(<SwapAgentButton threadId="thr_source" />);
    fireEvent.pointerDown(screen.getByTestId("swap-agent-button"), {
      button: 0,
    });
    expect(
      await screen.findByRole("menuitem", { name: "Cursor" }),
    ).toBeTruthy();
    // Already on it — swapping to yourself is not a move.
    expect(screen.queryByRole("menuitem", { name: "Claude Code" })).toBeNull();
    // Unavailable — offering it would be a door to nothing.
    expect(screen.queryByRole("menuitem", { name: "Pi" })).toBeNull();
  });

  it("opens the SUCCESSOR, project-scoped, so the operator watches it land", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          result: {
            ok: true,
            oldThreadId: "thr_source",
            newThreadId: "thr_new",
            providerFrom: "claude-code",
            providerTo: "acp-cursor",
            messagesCarried: 14,
            toolCallsCarried: 0,
            reason: null,
          },
        }),
      })),
    );
    render(<SwapAgentButton threadId="thr_source" />);
    fireEvent.pointerDown(screen.getByTestId("swap-agent-button"), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cursor" }));
    // A projectless path would resolve to the personal scope and 404 the successor.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/projects/proj_real/threads/thr_new",
      ),
    );
  });

  it("shows the store's refusal rather than inventing one, and goes nowhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          result: {
            ok: false,
            error: "That thread is held; the hold would evaporate.",
          },
        }),
      })),
    );
    render(<SwapAgentButton threadId="thr_source" />);
    fireEvent.pointerDown(screen.getByTestId("swap-agent-button"), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cursor" }));
    expect(await screen.findByText(/the hold would evaporate/i)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("will not offer to swap an agent that is mid-turn", () => {
    threadStatus = "active";
    render(<SwapAgentButton threadId="thr_source" />);
    const button = screen.getByTestId("swap-agent-button") as HTMLButtonElement;
    // The store refuses this honestly; explaining before the press reads better.
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/turn boundary/i);
  });

  // A control that disappears is indistinguishable from a build that never had
  // it — which is exactly how an hour went missing hunting for this button on a
  // rig whose provider list had not answered yet.
  it("says it is still reading rather than vanishing", () => {
    executionOptions = undefined;
    render(<SwapAgentButton threadId="thr_source" />);

    expect(screen.queryByTestId("swap-agent-button")).toBeNull();
    const placeholder = screen.getByTestId("swap-agent-unavailable");
    expect(placeholder.getAttribute("title")).toContain("Still reading");
  });

  it("says there is nowhere to go when the instance has no other harness", () => {
    executionOptions = {
      providers: [
        { id: "claude-code", displayName: "Claude Code", available: true },
      ],
    };
    render(<SwapAgentButton threadId="thr_source" />);

    expect(screen.queryByTestId("swap-agent-button")).toBeNull();
    expect(screen.getByTestId("swap-agent-unavailable").textContent).toContain(
      "no swap targets",
    );
  });
});

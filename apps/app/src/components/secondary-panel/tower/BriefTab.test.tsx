// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveThread } from "./useLiveThreads";

let liveThreads: Map<string, LiveThread> | null;
let preview: { data: unknown; isPending: boolean; isError: boolean };

vi.mock("./useLiveThreads", () => ({ useLiveThreads: () => liveThreads }));
vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironmentFilePreview: () => preview,
}));
vi.mock("@/components/ui/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { BriefTab } from "./BriefTab";

function withEnvironment(environmentId: string | null): void {
  liveThreads = new Map([
    ["thr_agent", { projectId: "p", providerId: "x", title: "Lead", environmentId }],
  ]);
}

beforeEach(() => {
  withEnvironment("env_1");
  preview = { data: null, isPending: true, isError: false };
});
afterEach(() => cleanup());

describe("the Brief tab", () => {
  it("renders the brief when the workspace has one", () => {
    preview = {
      data: { kind: "text", content: "# Fix the rail" },
      isPending: false,
      isError: false,
    };
    render(<BriefTab agentId="thr_agent" />);

    expect(screen.getByText("# Fix the rail")).toBeTruthy();
  });

  // "no brief" and "could not read the workspace" are different facts, and only
  // one of them is the agent's own doing.
  it("says the agent has no workspace rather than claiming no brief", () => {
    withEnvironment(null);
    render(<BriefTab agentId="thr_agent" />);

    expect(screen.getByText(/no workspace/)).toBeTruthy();
    expect(screen.queryByText(/never given one/)).toBeNull();
  });

  it("does not claim an empty brief while the read is still running", () => {
    render(<BriefTab agentId="thr_agent" />);

    expect(screen.getByText(/Reading this agent's brief/)).toBeTruthy();
    expect(screen.queryByText(/never given one/)).toBeNull();
  });

  it("says so when the brief cannot be read", () => {
    preview = { data: null, isPending: false, isError: true };
    render(<BriefTab agentId="thr_agent" />);

    expect(screen.getByText(/never given one/)).toBeTruthy();
  });

  // Every generated brief opens with a tool stamp in an HTML comment. The
  // renderer runs with HTML off, so it would be escaped and shown as the first
  // line the operator reads — provenance for the file, not content of it.
  it("does not show the file's own tool stamp", () => {
    preview = {
      data: {
        kind: "text",
        content:
          "<!-- Written by bb-plugin-crew. -->\n# Brief — row20\n\nDo the thing.",
      },
      isPending: false,
      isError: false,
    };
    render(<BriefTab agentId="thr_agent" />);

    expect(screen.queryByText(/bb-plugin-crew/)).toBeNull();
    expect(screen.getByText(/Brief — row20/)).toBeTruthy();
  });
});

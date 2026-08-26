// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePluginId } from "@/components/plugin/plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { AgentSurfaceTabContent } from "./AgentSurfaceTabContent";
import type { AgentSurfaceTab } from "./agentSurfaceRegistry";

function tab(overrides: Partial<AgentSurfaceTab>): AgentSurfaceTab {
  return {
    id: "browser",
    label: "Browser",
    icon: "Globe",
    title: "Browser",
    component: () => <p>tab content</p>,
    ...overrides,
  };
}

const PROPS = {
  agentId: "thr_agent",
  visible: true,
  viewerRole: "lead" as const,
  onTeardown: () => () => undefined,
};

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("mounting an agent-surface tab", () => {
  // The crash the Captain hit: a plugin's tab was rendered bare, so the very
  // first SDK hook in a correctly written plugin component threw — and with no
  // boundary above it, the throw blanked every thread route.
  it("gives a plugin's tab the plugin context its SDK hooks require", () => {
    function PluginTab() {
      return <p>plugin id is {usePluginId()}</p>;
    }
    render(
      <AgentSurfaceTabContent
        tab={tab({ component: PluginTab, pluginId: "browser" })}
        {...PROPS}
      />,
    );

    expect(screen.getByText("plugin id is browser")).toBeTruthy();
  });

  it("contains a plugin tab's crash to that tab", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Throwing(): never {
      throw new Error("boom");
    }
    render(
      <AgentSurfaceTabContent
        tab={tab({ component: Throwing, pluginId: "browser" })}
        {...PROPS}
      />,
    );

    expect(screen.getByText(/stopped working/)).toBeTruthy();
  });

  // A built-in has no plugin context to be given, but it must not be able to
  // take the route down either.
  it("contains a built-in tab's crash to that tab", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Throwing(): never {
      throw new Error("boom");
    }
    render(
      <AgentSurfaceTabContent tab={tab({ component: Throwing })} {...PROPS} />,
    );

    expect(screen.getByText(/stopped working/)).toBeTruthy();
  });

  it("keys a plugin tab's crash to the agent, not just the plugin", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function ThrowsForOneAgent({ agentId }: { agentId: string }) {
      if (agentId === "thr_bad") throw new Error("boom");
      return <p>fine on {agentId}</p>;
    }
    const entry = tab({
      component: ThrowsForOneAgent as AgentSurfaceTab["component"],
      pluginId: "browser",
    });
    render(
      <>
        <AgentSurfaceTabContent tab={entry} {...PROPS} agentId="thr_bad" />
        <AgentSurfaceTabContent tab={entry} {...PROPS} agentId="thr_good" />
      </>,
    );

    // The recursive surface mounts one tab for many agents at once; a failure
    // on one must not blank the same tab on the others.
    expect(screen.getByText(/stopped working/)).toBeTruthy();
    expect(screen.getByText("fine on thr_good")).toBeTruthy();
  });
});

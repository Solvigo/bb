import { describe, expect, it } from "vitest";
import {
  emitAgentTeardown,
  listAgentSurfaceTabs,
  onAgentTeardown,
  registerAgentSurfaceTab,
  resolveAgentSurfaceTabId,
  type AgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

const stub = () => null as unknown as (props: AgentSurfaceTabProps) => null;

const BUILT_INS: readonly AgentSurfaceTab[] = [
  {
    id: "brief",
    label: "Brief",
    icon: "FileText",
    title: "Brief",
    order: 0,
    component: stub(),
  },
  {
    id: "files",
    label: "Files",
    icon: "Folder",
    title: "Files",
    order: 2,
    component: stub(),
  },
];

const PLUGIN_TAB: AgentSurfaceTab = {
  id: "plugin:crew:subagents",
  label: "Subagents",
  icon: "Layers",
  title: "Subagents",
  component: stub(),
};

describe("the agent surface registry", () => {
  it("puts an unordered tab after the built-ins rather than in front of them", () => {
    registerAgentSurfaceTab({
      id: "test-browser",
      label: "Browser",
      icon: "Globe",
      title: "Browser",
      component: stub(),
    });
    registerAgentSurfaceTab({
      id: "test-first",
      label: "First",
      icon: "Globe",
      title: "First",
      order: -1,
      component: stub(),
    });
    const ids = listAgentSurfaceTabs().map((tab) => tab.id);
    expect(ids[0]).toBe("test-first");
    expect(ids.at(-1)).toBe("test-browser");
  });

  it("replaces a tab registered twice instead of showing it twice", () => {
    const before = listAgentSurfaceTabs().length;
    registerAgentSurfaceTab({
      id: "test-browser",
      label: "Browser v2",
      icon: "Globe",
      title: "Browser",
      component: stub(),
    });
    const after = listAgentSurfaceTabs();
    expect(after).toHaveLength(before);
    expect(after.find((tab) => tab.id === "test-browser")?.label).toBe(
      "Browser v2",
    );
  });

  it("resolves valid, stale, null, and empty tab lists through one helper", () => {
    expect(resolveAgentSurfaceTabId("brief", BUILT_INS)).toBe("brief");
    expect(resolveAgentSurfaceTabId("crew", BUILT_INS)).toBe("brief");
    expect(resolveAgentSurfaceTabId(null, BUILT_INS)).toBe("brief");
    expect(resolveAgentSurfaceTabId("crew", [])).toBeNull();
  });

  it("falls back when a plugin tab arrives or is removed", () => {
    const withPlugin = [...BUILT_INS, PLUGIN_TAB];
    expect(resolveAgentSurfaceTabId("plugin:crew:subagents", withPlugin)).toBe(
      "plugin:crew:subagents",
    );
    expect(resolveAgentSurfaceTabId("plugin:crew:subagents", BUILT_INS)).toBe(
      "brief",
    );
  });

  it("tells every listener which agent is being torn down, and stops after unsubscribe", () => {
    const seen: string[] = [];
    const off = onAgentTeardown((agentId) => seen.push(agentId));
    emitAgentTeardown("thr_one");
    off();
    emitAgentTeardown("thr_two");
    expect(seen).toEqual(["thr_one"]);
  });
});

describe("the teardown contract a plugin tab is handed", () => {
  it("only disposes for its own agent, and stops once unsubscribed", () => {
    // The emitter is fleet-wide; the surface narrows it per agent. This is the
    // shape TowerRenderSurface hands each tab as `onTeardown`.
    const registerFor = (agentId: string) => (dispose: () => void) =>
      onAgentTeardown((torn) => {
        if (torn === agentId) dispose();
      });

    const disposed: string[] = [];
    const offA = registerFor("thr_a")(() => disposed.push("a"));
    registerFor("thr_b")(() => disposed.push("b"));

    emitAgentTeardown("thr_b");
    expect(disposed).toEqual(["b"]);

    emitAgentTeardown("thr_a");
    expect(disposed).toEqual(["b", "a"]);

    offA();
    emitAgentTeardown("thr_a");
    expect(disposed).toEqual(["b", "a"]);
  });
});

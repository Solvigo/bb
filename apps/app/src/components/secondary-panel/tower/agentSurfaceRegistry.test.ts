import { describe, expect, it } from "vitest";
import {
  emitAgentTeardown,
  listAgentSurfaceTabs,
  onAgentTeardown,
  registerAgentSurfaceTab,
  type AgentSurfaceTabProps,
} from "./agentSurfaceRegistry";

const stub = () => null as unknown as (props: AgentSurfaceTabProps) => null;

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

  it("tells every listener which agent is being torn down, and stops after unsubscribe", () => {
    const seen: string[] = [];
    const off = onAgentTeardown((agentId) => seen.push(agentId));
    emitAgentTeardown("thr_one");
    off();
    emitAgentTeardown("thr_two");
    expect(seen).toEqual(["thr_one"]);
  });
});

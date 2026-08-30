// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  purgeStandbyRoots,
  recordedStandbyRoots,
  rememberStandbyRoot,
} from "./standbyRoots";

const KEY = "bb.crew.standby-roots";

afterEach(() => {
  window.localStorage.clear();
});

describe("standby root provenance", () => {
  it("normalizes the projectless project to one spelling", () => {
    // The thread list omits projectId for a personal thread while the flow
    // says PERSONAL: two spellings of one project never match each other.
    rememberStandbyRoot("thr_a", "");
    expect(recordedStandbyRoots().get("thr_a")).toBe(PERSONAL_PROJECT_ID);
  });

  it("says so when the note cannot be kept", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage is full");
    };
    try {
      expect(() => rememberStandbyRoot("thr_a", "proj_a")).toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("drops a malformed entry rather than failing the whole read", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { threadId: "thr_good", projectId: "proj_a" },
        { threadId: 7 },
        null,
        { projectId: "proj_a" },
      ]),
    );
    expect([...recordedStandbyRoots().keys()]).toEqual(["thr_good"]);
  });

  it("purges notes the rig no longer agrees with", () => {
    rememberStandbyRoot("thr_gone", "proj_a");
    rememberStandbyRoot("thr_moved", "proj_a");
    rememberStandbyRoot("thr_adopted", "proj_a");
    rememberStandbyRoot("thr_chartered", "proj_a");
    rememberStandbyRoot("thr_kept", "proj_a");

    purgeStandbyRoots(
      [
        // thr_gone is simply absent — deleted.
        { id: "thr_moved", projectId: "proj_b", parentThreadId: null },
        { id: "thr_adopted", projectId: "proj_a", parentThreadId: "thr_kept" },
        { id: "thr_chartered", projectId: "proj_a", parentThreadId: null },
        { id: "thr_kept", projectId: "proj_a", parentThreadId: null },
      ],
      new Set(["thr_chartered"]),
    );

    expect([...recordedStandbyRoots().keys()]).toEqual(["thr_kept"]);
  });
});

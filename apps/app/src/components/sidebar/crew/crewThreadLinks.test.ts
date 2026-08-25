import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { getThreadRoutePath } from "@/lib/route-paths";

/**
 * The law, enforced rather than remembered: any surface linking a thread
 * carries its project scope.
 *
 * A hand-built `/threads/<id>` resolves to the PERSONAL project, so every lead
 * on a real project rendered "belongs to a different project" — the rail listed
 * agents it could not open. The fix is not to remember the right shape at each
 * call site; it is to stop hand-building the path at all, because that is what
 * let two call sites drift apart in the first place.
 */
const ROOT = join(import.meta.dirname, "../../..");
const ALLOWED = new Set([
  // The one place the shape is allowed to exist: the helper that decides it.
  join(ROOT, "lib/route-paths.ts"),
  // A deliberate last-resort fallback, documented at its call site: a plugin
  // asks to open a thread, the project lookup FAILS, and a projectless link is
  // better than no navigation at all. Adding to this list should be a conscious
  // act with a reason, which is why the list is here rather than a regex.
  join(ROOT, "lib/plugin-sdk-hooks.ts"),
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.(test|stories)\.tsx?$/.test(entry)) continue;
    yield full;
  }
}

describe("thread links", () => {
  it("are never hand-built outside the route helper", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(file, "utf8");
      if (/`\/threads\/\$\{/.test(source)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the route helper", () => {
  it("scopes a standard project's thread and leaves the personal one bare", () => {
    // This is the half my own rig cannot demonstrate: its crew lives on the
    // personal project, where the projectless path is CORRECT, so the bug the
    // Captain hit is invisible here. The helper is where both shapes meet.
    expect(
      getThreadRoutePath({ projectId: "proj_real", threadId: "thr_x" }),
    ).toBe("/projects/proj_real/threads/thr_x");
    expect(
      getThreadRoutePath({ projectId: PERSONAL_PROJECT_ID, threadId: "thr_x" }),
    ).toBe("/threads/thr_x");
  });
});

import {
  BB_CALLER_THREAD_ID_HEADER,
  CREATED_BY,
  browserListResponseSchema,
  browserOpenRequestSchema,
  browserTargetSchema,
  desktopAutomationChannelUnavailableDetailsSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function postBrowser(
  harness: TestAppHarness,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    harness.app.request(`/api/v1/browser/${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    }),
  );
}

describe("public browser automation routes", () => {
  it("rejects client-claimed createdBy before forwarding", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const response = await postBrowser(
        harness,
        "open",
        {
          url: "https://example.com",
          createdBy: CREATED_BY.agent,
        },
        { [BB_CALLER_THREAD_ID_HEADER]: thread.id },
      );
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({
        code: "invalid_request",
        message: expect.stringContaining("createdBy"),
      });
    });
  });

  it("returns an honest error when no desktop automation channel is connected", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const response = await postBrowser(
        harness,
        "open",
        browserOpenRequestSchema.parse({ url: "https://example.com" }),
        { [BB_CALLER_THREAD_ID_HEADER]: thread.id },
      );
      expect(response.status).toBe(503);
      const body = await readJson(response);
      expect(body).toEqual({
        code: "desktop_automation_channel_unavailable",
        message: expect.stringContaining("No desktop automation channel connected"),
        retryable: true,
        details: desktopAutomationChannelUnavailableDetailsSchema.parse({
          missing: "desktop-automation-channel",
        }),
      });
    });
  });

  it("enforces the agent authorization matrix on registered targets", async () => {
    await withTestHarness(async (harness) => {
      const { thread: agentThread } = seedThreadFixture(harness);
      const { thread: otherThread } = seedThreadFixture(harness);
      const target = browserTargetSchema.parse({
        targetId: "tgt_agent_owned",
        threadId: agentThread.id,
        createdBy: CREATED_BY.agent,
        visible: true,
        createdAt: "2026-08-27T00:00:00.000Z",
        lastUsedAt: "2026-08-27T00:00:00.000Z",
      });
      harness.deps.browserAutomation.registerTargetForTest(target);

      const allowed = await postBrowser(
        harness,
        "snapshot",
        { targetId: target.targetId },
        { [BB_CALLER_THREAD_ID_HEADER]: agentThread.id },
      );
      expect(allowed.status).toBe(503);

      const forbidden = await postBrowser(
        harness,
        "snapshot",
        { targetId: target.targetId },
        { [BB_CALLER_THREAD_ID_HEADER]: otherThread.id },
      );
      expect(forbidden.status).toBe(403);
      expect(await readJson(forbidden)).toEqual({
        code: "browser_target_forbidden",
        message: expect.stringContaining(target.targetId),
        retryable: false,
      });

      const operator = await postBrowser(
        harness,
        "snapshot",
        { targetId: target.targetId },
        {},
      );
      expect(operator.status).toBe(503);
    });
  });

  it("lists registered targets for an explicit operator thread scope", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const target = browserTargetSchema.parse({
        targetId: "tgt_listed",
        threadId: thread.id,
        createdBy: CREATED_BY.cli,
        visible: false,
        createdAt: "2026-08-27T00:00:00.000Z",
        lastUsedAt: "2026-08-27T00:00:00.000Z",
      });
      harness.deps.browserAutomation.registerTargetForTest(target);

      const response = await harness.app.request(
        `/api/v1/browser/list?thread=${thread.id}`,
      );
      expect(response.status).toBe(200);
      expect(
        browserListResponseSchema.parse(await readJson(response)),
      ).toEqual({ targets: [target] });
    });
  });
});

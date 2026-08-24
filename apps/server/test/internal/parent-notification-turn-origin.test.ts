import { setTimeout as sleep } from "node:timers/promises";
import { threadScope, turnScope, type TurnOrigin } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * A DELEGATED CHILD'S PARENT IS NOT WOKEN BY A TURN THE USER STEERED HIMSELF.
 *
 * `isParentNotifiableChildThread` already exempts forks and side chats as
 * "user-initiated branches the user reads directly", but it can only key on the
 * thread's static origin — so a user steering a delegated child from an external
 * board is that same read-directly case that the predicate cannot see. The
 * per-turn `origin` marker on the turn input is what makes it visible, and this
 * file is the acceptance for it: an `operator-steer` turn stays quiet, and
 * everything else — a marked `crew-tasking`, an unmarked turn, and the
 * pre-existing side-chat exemption — behaves exactly as it did before.
 */

interface DelegatedChildFixture {
  childThreadId: string;
  parentThreadId: string;
  sessionId: string;
}

interface SeedDelegatedChildArgs {
  harness: TestAppHarness;
  name: string;
  origin?: TurnOrigin;
  requestId: string;
  sideChat?: boolean;
}

const PROVIDER_THREAD_ID = "provider-turn-origin-child";

/**
 * A parent that can actually receive a `[bb system]` turn (ready environment +
 * runtime state, so the notification dispatch resolves to a `turn.submit`), an
 * active delegated child under it, and the child's own `client/turn/requested`
 * event for the turn the daemon events below will complete.
 *
 * The request event is SEEDED rather than sent through `POST /threads/:id/send`
 * on purpose: this file is about what the notify path reads off a recorded turn,
 * and a real send would need a live host command round trip to get there.
 * `seedEvent` parses the payload through the domain schema, so an `origin` the
 * schema would reject fails here rather than being silently stored.
 */
function seedDelegatedChild(
  args: SeedDelegatedChildArgs,
): DelegatedChildFixture {
  const { harness } = args;
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-turn-origin-${args.name}`,
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/turn-origin-${args.name}`,
  });
  const parentThread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
    status: "idle",
    title: "Pilot",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "Coordinate the fleet",
    providerThreadId: `provider-turn-origin-parent-${args.name}`,
    threadId: parentThread.id,
  });
  const childThread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    parentThreadId: parentThread.id,
    providerId: "codex",
    status: "active",
    ...(args.sideChat
      ? { originKind: "fork" as const, originPluginId: "side-chat" }
      : {}),
  });
  seedEvent(harness.deps, {
    threadId: childThread.id,
    environmentId: environment.id,
    sequence: 1,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: args.requestId,
      source: "tell",
      initiator: "user",
      ...(args.origin !== undefined ? { origin: args.origin } : {}),
      senderThreadId: null,
      input: [{ type: "text", text: "carry on", mentions: [] }],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "fake-model",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
  });

  return {
    childThreadId: childThread.id,
    parentThreadId: parentThread.id,
    sessionId: session.id,
  };
}

/**
 * The turn the daemon reports: started, the input accepted under the request id
 * that carries the origin (this is the link the server reads the origin
 * through), then completed.
 */
async function completeChildTurn(args: {
  fixture: DelegatedChildFixture;
  harness: TestAppHarness;
  requestId: string;
  turnId: string;
}): Promise<Response> {
  const events: HostDaemonEventEnvelope[] = [
    {
      threadId: args.fixture.childThreadId,
      event: {
        type: "turn/started",
        threadId: args.fixture.childThreadId,
        providerThreadId: PROVIDER_THREAD_ID,
        scope: turnScope(args.turnId),
      },
    },
    {
      threadId: args.fixture.childThreadId,
      event: {
        type: "turn/input/accepted",
        threadId: args.fixture.childThreadId,
        providerThreadId: PROVIDER_THREAD_ID,
        clientRequestId: args.requestId,
        scope: turnScope(args.turnId),
      },
    },
    {
      threadId: args.fixture.childThreadId,
      event: {
        type: "turn/completed",
        threadId: args.fixture.childThreadId,
        providerThreadId: PROVIDER_THREAD_ID,
        scope: turnScope(args.turnId),
        status: "completed",
      },
    },
  ];

  return args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.fixture.sessionId,
      eventGroups: groupHostDaemonEvents(events),
    }),
  });
}

// The parent notification is a deferred follow-up (setImmediate + a daemon
// command round trip), so the batch response returning is not the end of the
// work. Same wait the sibling ingress tests use.
async function flushDeferredChildThreadNotifications(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await sleep(2_100);
}

describe("parent notification and the turn's origin", () => {
  const cases: ReadonlyArray<{
    expectedNotifications: number;
    name: string;
    origin?: TurnOrigin;
    requestId: string;
    what: string;
  }> = [
    {
      expectedNotifications: 0,
      name: "operator-steer",
      origin: "operator-steer",
      requestId: "creq_psteer2345",
      what: "does not notify a parent when the completed turn was an operator's own steer",
    },
    {
      expectedNotifications: 1,
      name: "crew-tasking",
      origin: "crew-tasking",
      requestId: "creq_ctasking23",
      what: "notifies a parent when the completed turn was a marked crew tasking",
    },
    {
      expectedNotifications: 1,
      name: "unmarked",
      requestId: "creq_unmarked23",
      what: "notifies a parent when the completed turn carries no origin at all",
    },
  ];

  for (const testCase of cases) {
    it(testCase.what, async () => {
      await withTestHarness(async (harness) => {
        const fixture = seedDelegatedChild({
          harness,
          name: testCase.name,
          ...(testCase.origin !== undefined ? { origin: testCase.origin } : {}),
          requestId: testCase.requestId,
        });

        const response = await completeChildTurn({
          fixture,
          harness,
          requestId: testCase.requestId,
          turnId: `turn-origin-${testCase.name}`,
        });

        expect(response.status).toBe(200);
        await flushDeferredChildThreadNotifications();
        expect(
          listQueuedThreadCommands(
            harness,
            "turn.submit",
            fixture.parentThreadId,
          ),
        ).toHaveLength(testCase.expectedNotifications);
      });
    });
  }

  // The thread-kind exemption is untouched by the per-turn one: a side chat is
  // exempt whatever its turns are marked, including a crew-tasking that would
  // otherwise notify.
  it("keeps the side-chat exemption for a turn marked as a crew tasking", async () => {
    await withTestHarness(async (harness) => {
      const requestId = "creq_sidechat23";
      const fixture = seedDelegatedChild({
        harness,
        name: "side-chat",
        origin: "crew-tasking",
        requestId,
        sideChat: true,
      });

      const response = await completeChildTurn({
        fixture,
        harness,
        requestId,
        turnId: "turn-origin-side-chat",
      });

      expect(response.status).toBe(200);
      await flushDeferredChildThreadNotifications();
      expect(
        listQueuedThreadCommands(
          harness,
          "turn.submit",
          fixture.parentThreadId,
        ),
      ).toEqual([]);
    });
  });
});

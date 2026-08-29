// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ThreadListEntry } from "@bb/domain";
import type { TimelineConversationAttachments } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  MessageDirectiveRegistryProvider,
  type MessageDirectiveRegistry,
} from "@/components/ui/markdown-message-directives";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { ConversationMessageContent } from "./ConversationMessageContent";

function localImageAttachment(path: string): TimelineConversationAttachments {
  return {
    webImages: 0,
    localImages: 1,
    localFiles: 0,
    imageUrls: [],
    localImagePaths: [path],
    localFilePaths: [],
  };
}

afterEach(cleanup);

function threadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

describe("ConversationMessageContent assistant images", () => {
  it("serves local Markdown images through the thread host-file route", () => {
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="assistant"
            attachments={null}
            id="msg_image"
            threadId="thr_image"
            turnId="turn_image"
            sourceSeqStart={1}
            sourceSeqEnd={2}
            showActions={false}
            mobileActionDisplay="overflow"
            text="![Generated diagram](/workspace/output/diagram.png)"
            turnRequest={null}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("img", { name: "Generated diagram" })
        .getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_image/host-files/content?path=%2Fworkspace%2Foutput%2Fdiagram.png",
    );
  });
});

describe("ConversationMessageContent localImage attachments", () => {
  it("routes an absolute localImage block through the thread host-file route", () => {
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            attachments={localImageAttachment(
              "/Users/captain/Desktop/annotated-screenshot.png",
            )}
            childOrigin={null}
            initiator="user"
            mentions={[]}
            resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
            senderThreadId={null}
            senderThreadTitle={null}
            senderIsPluginSideChat={false}
            systemMessageKind="unlabeled"
            systemMessageSubject={null}
            text=""
            threadId="thr_localimage"
            turnRequest={{ kind: "message", status: "accepted" }}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("img", { name: "annotated-screenshot.png" })
        .getAttribute("src"),
    ).toBe(
      "/api/v1/threads/thr_localimage/host-files/content?path=%2FUsers%2Fcaptain%2FDesktop%2Fannotated-screenshot.png",
    );
  });

  it("routes a relative localImage block through the project attachment route", () => {
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ConversationMessageContent
            role="user"
            attachments={localImageAttachment("attachments/upload-1.png")}
            childOrigin={null}
            initiator="user"
            mentions={[]}
            projectId="proj_current"
            resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
            senderThreadId={null}
            senderThreadTitle={null}
            senderIsPluginSideChat={false}
            systemMessageKind="unlabeled"
            systemMessageSubject={null}
            text=""
            threadId="thr_localimage"
            turnRequest={{ kind: "message", status: "accepted" }}
          />
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("img", { name: "upload-1.png" }).getAttribute("src"),
    ).toBe(
      "/api/v1/projects/proj_current/attachments/content?path=attachments%2Fupload-1.png",
    );
  });
});

describe("ConversationMessageContent assistant thread mentions", () => {
  it("renders an agent-authored thread token with the referenced thread title", () => {
    const mentionedThread = threadListEntry({
      id: "thr_xpxxt2ipz8",
      projectId: "proj_personal",
      title: "Plugin composer support on root new-thread page",
    });
    const messageDirectiveRegistry: MessageDirectiveRegistry = new Map([
      [
        "inline-vis",
        { status: "collision", pluginIds: ["plugin-a", "plugin-b"] },
      ],
    ]);

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <MessageDirectiveRegistryProvider
              registry={messageDirectiveRegistry}
            >
              <ConversationMessageContent
                role="assistant"
                attachments={null}
                id="msg_spawned"
                threadId="thr_parent"
                turnId="turn_spawned"
                sourceSeqStart={1}
                sourceSeqEnd={2}
                showActions={false}
                mobileActionDisplay="overflow"
                text="Spawned and parented: @thread:thr_xpxxt2ipz8"
                turnRequest={null}
              />
            </MessageDirectiveRegistryProvider>
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const mentionLink = screen.getByRole("link", {
      name: "Plugin composer support on root new-thread page",
    });
    expect(mentionLink.getAttribute("href")).toBe("/threads/thr_xpxxt2ipz8");
    expect(screen.queryByText("@thread", { exact: false })).toBeNull();
  });
});

describe("ConversationMessageContent user thread mentions", () => {
  it("renders a raw thread token as the canonical pill when structured mentions are empty", () => {
    const mentionedThread = threadListEntry({
      id: "thr_ti4st72wgs",
      projectId: "proj_personal",
      title: "Mention pill QA thread",
    });

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <ConversationMessageContent
              role="user"
              attachments={null}
              childOrigin={null}
              initiator="user"
              mentions={[]}
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text="Why was @thread:thr_ti4st72wgs not a pill?"
              threadId="thr_mentions"
              turnRequest={{ kind: "message", status: "accepted" }}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    const mentionLink = screen.getByRole("link", {
      name: "Mention pill QA thread",
    });
    expect(mentionLink.getAttribute("href")).toBe("/threads/thr_ti4st72wgs");
    expect(screen.queryByText("@thread", { exact: false })).toBeNull();
  });

  it("routes a raw thread token through the target thread project", () => {
    const mentionedThread = threadListEntry({
      id: "thr_cross_project",
      projectId: "proj_target",
      title: "Cross-project mention",
    });

    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[mentionedThread.id, mentionedThread]])}
          >
            <ConversationMessageContent
              role="user"
              attachments={null}
              childOrigin={null}
              initiator="user"
              mentions={[]}
              resolveSegmentLinkHref={(link) =>
                link.kind === "thread"
                  ? `/projects/proj_current/threads/${link.threadId}`
                  : null
              }
              senderThreadId={null}
              senderThreadTitle={null}
              senderIsPluginSideChat={false}
              systemMessageKind="unlabeled"
              systemMessageSubject={null}
              text="See @thread:thr_cross_project for the result."
              threadId="thr_mentions"
              turnRequest={{ kind: "message", status: "accepted" }}
            />
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("link", { name: "Cross-project mention" })
        .getAttribute("href"),
    ).toBe("/projects/proj_target/threads/thr_cross_project");
  });
});

import { EnvironmentId, MessageId, TurnId } from "@ryco/contracts";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef } from "@legendapp/list/react";

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  const LegendList = React.forwardRef(function MockLegendList(
    props: {
      data: Array<{ id: string }>;
      keyExtractor: (item: { id: string }) => string;
      renderItem: (args: { item: { id: string } }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
    },
    _ref: React.ForwardedRef<LegendListRef>,
  ) {
    return (
      <div data-testid="legend-list">
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  });

  return { LegendList };
});

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
});

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    onOpenContextAttachment: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: () => {},
  };
}

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.make("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  }, 20_000);

  it("renders persisted context attachments as chips above the user bubble", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-ctx",
            kind: "message",
            createdAt: "2026-07-05T10:00:00.000Z",
            message: {
              id: MessageId.make("message-ctx"),
              role: "user",
              text: "implement the attached ticket",
              createdAt: "2026-07-05T10:00:00.000Z",
              streaming: false,
              attachments: [
                {
                  type: "context",
                  id: "ctx-att-1",
                  kind: "change-request",
                  provider: "github",
                  reference: "#42",
                  title: "Add token usage attribution",
                  state: "open",
                  url: "https://github.com/owner/repo/pull/42",
                },
                {
                  type: "context",
                  id: "ctx-att-2",
                  kind: "work-item",
                  provider: "jira",
                  reference: "RYC-231",
                  title: "Attribute token spend per turn",
                  state: "In Progress",
                  url: "https://acme.atlassian.net/browse/RYC-231",
                },
              ],
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("#42");
    expect(markup).toContain("Add token usage attribution");
    expect(markup).toContain("RYC-231");
    expect(markup).toContain("In Progress");
    expect(markup).toContain("data-context-attachment-id");
    expect(markup).toContain("implement the attached ticket");
  }, 20_000);

  it("renders no chip row for messages without context attachments", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-plain",
            kind: "message",
            createdAt: "2026-07-05T10:00:00.000Z",
            message: {
              id: MessageId.make("message-plain"),
              role: "user",
              text: "plain message",
              createdAt: "2026-07-05T10:00:00.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("plain message");
    expect(markup).not.toContain("data-context-attachment-id");
  }, 20_000);

  it("renders context compaction entries as timeline markers", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "context-compaction",
            createdAt: "2026-03-17T19:12:28.000Z",
            marker: {
              id: "context-compaction:work-1",
              activityId: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              turnId: null,
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).not.toContain("Work log");
  });

  it("formats changed file paths from the workspace root", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Updated files",
              tone: "tool",
              changedFiles: ["C:/Users/mike/dev-stuff/ryco/apps/web/src/session-logic.ts"],
            },
          },
        ]}
        workspaceRoot="C:/Users/mike/dev-stuff/ryco"
      />,
    );

    expect(markup).toContain("ryco/apps/web/src/session-logic.ts");
    expect(markup).not.toContain("C:/Users/mike/dev-stuff/ryco/apps/web/src/session-logic.ts");
  });

  it("labels the changed-files diff button as close for the open turn", async () => {
    const { MessagesTimeline } = await import("./MessagesTimeline");
    const assistantMessageId = MessageId.make("assistant-1");
    const turnId = TurnId.make("turn-1");
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: assistantMessageId,
              role: "assistant",
              text: "Done",
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
              turnId,
            },
          },
        ]}
        turnDiffSummaryByAssistantMessageId={
          new Map([
            [
              assistantMessageId,
              {
                turnId,
                completedAt: "2026-03-17T19:12:30.000Z",
                files: [{ path: "src/index.ts", additions: 2, deletions: 1 }],
              },
            ],
          ])
        }
        openDiffTurnId={turnId}
      />,
    );

    expect(markup).toContain("Close diff");
    expect(markup).not.toContain("View diff");
  });
});

import "../../index.css";

import { EnvironmentId, MessageId, TurnId } from "@ryco/contracts";
import { createRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const scrollToEndSpy = vi.fn();
const getStateSpy = vi.fn(() => ({ isAtEnd: true }));

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  const LegendList = React.forwardRef(function MockLegendList(
    props: {
      data: Array<{ id: string }>;
      keyExtractor: (item: { id: string }) => string;
      renderItem: (args: { item: { id: string } }) => React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      className?: string;
    },
    ref: React.ForwardedRef<LegendListRef>,
  ) {
    React.useImperativeHandle(
      ref,
      () =>
        ({
          scrollToEnd: scrollToEndSpy,
          getState: getStateSpy,
        }) as unknown as LegendListRef,
    );

    return (
      <div className={props.className} data-testid="legend-list">
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

import { MessagesTimeline } from "./MessagesTimeline";

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
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "24-hour" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: vi.fn(),
  };
}

describe("MessagesTimeline", () => {
  afterEach(() => {
    scrollToEndSpy.mockReset();
    getStateSpy.mockClear();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("reserves the scrollbar gutter to avoid width shifts when the terminal drawer opens", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      const list = document.querySelector<HTMLElement>('[data-testid="legend-list"]');
      expect(list).not.toBeNull();
      expect(list!.className).toContain("[scrollbar-gutter:stable]");
    } finally {
      await screen.unmount();
    }
  });

  it("renders user message bubbles with borderless soft chrome", async () => {
    const userMessageId = MessageId.make("message-user-1");
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        revertTurnCountByUserMessageId={new Map([[userMessageId, 1]])}
        timelineEntries={[
          {
            id: "message-1",
            kind: "message",
            createdAt: "2026-04-13T12:00:00.000Z",
            message: {
              id: userMessageId,
              role: "user",
              text: "Apply the cleaner chrome",
              createdAt: "2026-04-13T12:00:00.000Z",
              streaming: false,
            },
          },
        ]}
      />,
    );

    try {
      await expect.element(page.getByText("Apply the cleaner chrome")).toBeVisible();
      const userBubble = document.querySelector<HTMLElement>(".rounded-2xl.rounded-br-sm");

      expect(userBubble).not.toBeNull();
      expect(userBubble!.className).toContain("bg-foreground/8");
      expect(userBubble!.className).toContain("shadow-md/5");
      expect(userBubble!.className).not.toContain("border ");
      expect(userBubble!.className).not.toContain("ring-1");

      const copyButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Copy message"]',
      );
      const revertButton = document.querySelector<HTMLButtonElement>(
        'button[title="Revert to this message"]',
      );

      for (const button of [copyButton, revertButton]) {
        expect(button).not.toBeNull();
        expect(button!.className).toContain("border-0");
        expect(button!.className).toContain("bg-transparent");
        expect(button!.className).toContain("hover:bg-foreground/8");
        expect(button!.className).not.toContain("border-input");
      }
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const props = buildProps();
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[]} />);

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeVisible();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            {
              id: "work-1",
              kind: "work",
              createdAt: "2026-04-13T12:00:00.000Z",
              entry: {
                id: "work-1",
                createdAt: "2026-04-13T12:00:00.000Z",
                label: "thinking",
                detail: "Inspecting repository state",
                tone: "thinking",
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      expect(props.onIsAtEndChange).toHaveBeenCalledWith(true);
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: false });
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("renders live file edits as non-expandable rows with text-only shimmer", async () => {
    const turnId = TurnId.make("turn-1");
    const editEntry = {
      id: "work-1",
      kind: "work" as const,
      createdAt: "2026-04-13T12:00:00.000Z",
      entry: {
        id: "work-1",
        createdAt: "2026-04-13T12:00:00.000Z",
        label: "File change",
        tone: "tool" as const,
        itemType: "file_change" as const,
        requestKind: "file-change" as const,
        changedFiles: ["src/app.ts"],
        changedFileStats: [{ path: "src/app.ts", additions: 255, deletions: 12 }],
        turnId,
      },
    };
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        activeTurnId={turnId}
        isWorking
        timelineEntries={[editEntry]}
      />,
    );

    try {
      await expect.element(page.getByText("Editing src/app.ts")).toBeVisible();
      await expect.element(page.getByText("+255")).not.toBeInTheDocument();
      await expect.element(page.getByText("-12")).not.toBeInTheDocument();

      const fileEditRow = document.querySelector<HTMLElement>("[data-file-edit-work-row='true']");
      const editText = document.querySelector<HTMLElement>(".chat-file-edit-text");

      expect(fileEditRow).not.toBeNull();
      expect(fileEditRow!.closest("[role='button']")).toBeNull();
      expect(fileEditRow!.dataset.fileEditWorkState).toBe("editing");
      expect(editText).not.toBeNull();
      expect(editText!.className).toContain("chat-file-edit-text--active");

      await screen.rerender(
        <MessagesTimeline
          {...buildProps()}
          activeTurnId={turnId}
          isWorking
          timelineEntries={[
            {
              ...editEntry,
              entry: {
                ...editEntry.entry,
                completed: true,
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Edited src/app.ts")).toBeVisible();
      await expect.element(page.getByText("+255")).toBeVisible();
      await expect.element(page.getByText("-12")).toBeVisible();

      const completedRow = document.querySelector<HTMLElement>("[data-file-edit-work-row='true']");
      const completedText = document.querySelector<HTMLElement>(".chat-file-edit-text");
      expect(completedRow?.dataset.fileEditWorkState).toBe("completed");
      expect(completedText?.className).not.toContain("chat-file-edit-text--active");
    } finally {
      await screen.unmount();
    }
  });

  it("defers final changed files until the assistant response is complete", async () => {
    const assistantMessageId = MessageId.make("message-assistant-1");
    const turnId = TurnId.make("turn-1");
    const props = {
      ...buildProps(),
      turnDiffSummaryByAssistantMessageId: new Map([
        [
          assistantMessageId,
          {
            turnId,
            completedAt: "2026-04-13T12:00:03.000Z",
            files: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
            assistantMessageId,
          },
        ],
      ]),
    };
    const streamingEntry = {
      id: "message-1",
      kind: "message" as const,
      createdAt: "2026-04-13T12:00:00.000Z",
      message: {
        id: assistantMessageId,
        role: "assistant" as const,
        text: "Applying changes",
        turnId,
        createdAt: "2026-04-13T12:00:00.000Z",
        streaming: true,
      },
    };
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[streamingEntry]} />);

    try {
      await expect.element(page.getByText("Applying changes")).toBeVisible();
      await expect.element(page.getByText("Changed files (1)")).not.toBeInTheDocument();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            {
              ...streamingEntry,
              message: {
                ...streamingEntry.message,
                completedAt: "2026-04-13T12:00:04.000Z",
                streaming: false,
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Changed files (1)")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps current-turn changed files hidden until the turn is settled", async () => {
    const assistantMessageId = MessageId.make("message-assistant-active");
    const turnId = TurnId.make("turn-active");
    const props = {
      ...buildProps(),
      activeTurnId: turnId,
      activeTurnInProgress: true,
      turnDiffSummaryByAssistantMessageId: new Map([
        [
          assistantMessageId,
          {
            turnId,
            completedAt: "2026-04-13T12:00:03.000Z",
            files: [{ path: "src/live.ts", additions: 8, deletions: 1 }],
            assistantMessageId,
          },
        ],
      ]),
    };
    const timelineEntry = {
      id: "message-active",
      kind: "message" as const,
      createdAt: "2026-04-13T12:00:00.000Z",
      message: {
        id: assistantMessageId,
        role: "assistant" as const,
        text: "Still finishing the response",
        createdAt: "2026-04-13T12:00:00.000Z",
        completedAt: "2026-04-13T12:00:02.000Z",
        streaming: false,
      },
    };
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[timelineEntry]} />);

    try {
      await expect.element(page.getByText("Still finishing the response")).toBeVisible();
      await expect.element(page.getByText("Changed files (1)")).not.toBeInTheDocument();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          activeTurnInProgress={false}
          timelineEntries={[timelineEntry]}
        />,
      );

      await expect.element(page.getByText("Changed files (1)")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });
});

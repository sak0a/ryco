import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, TurnId } from "@ryco/contracts";
import { type WorkLogEntry } from "../../session-logic";
import {
  buildTimelineStableState,
  buildTimelineStreamingState,
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  deriveRevertTurnCountByUserMessageId,
  isErroredWorkEntry,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  type TimelineStableState,
  type TimelineStreamingState,
} from "./MessagesTimeline.logic";

function makeWorkEntry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: "entry-1",
    createdAt: "2026-01-01T00:00:00Z",
    label: "Bash",
    tone: "tool",
    ...overrides,
  };
}

describe("isErroredWorkEntry", () => {
  it("returns true when tone is error", () => {
    expect(isErroredWorkEntry(makeWorkEntry({ tone: "error" }))).toBe(true);
  });

  it("returns true when exitCode is non-zero", () => {
    expect(isErroredWorkEntry(makeWorkEntry({ tone: "tool", exitCode: 1 }))).toBe(true);
  });

  it("returns false when tone is non-error and exitCode is zero", () => {
    expect(isErroredWorkEntry(makeWorkEntry({ tone: "tool", exitCode: 0 }))).toBe(false);
  });

  it("returns false when tone is non-error and exitCode is undefined", () => {
    expect(isErroredWorkEntry(makeWorkEntry({ tone: "tool" }))).toBe(false);
  });
});

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        completedAt: "2026-01-01T00:00:10Z",
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous assistant completedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message without completedAt", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", createdAt: "2026-01-01T00:00:30Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        completedAt: "2026-01-01T00:00:55Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
      { id: "u2", role: "user", createdAt: "2026-01-01T00:01:00Z" },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        completedAt: "2026-01-01T00:01:20Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      { id: "u1", role: "user", createdAt: "2026-01-01T00:00:00Z" },
      { id: "s1", role: "system", createdAt: "2026-01-01T00:00:01Z" },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        completedAt: "2026-01-01T00:00:30Z",
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            completedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: "assistant-final-entry",
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
    expect(assistantRows[1]?.showCompletionDivider).toBe(true);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      files: [{ path: "src/index.ts", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            completedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });
});

describe("deriveRevertTurnCountByUserMessageId", () => {
  it("projects the first assistant diff summary after each user message", () => {
    const result = deriveRevertTurnCountByUserMessageId({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the first thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "work-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: makeWorkEntry({ id: "work-1", createdAt: "2026-01-01T00:00:05Z" }),
        },
        {
          id: "assistant-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            streaming: false,
          },
        },
        {
          id: "user-2-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "user-2" as never,
            role: "user",
            text: "Do the second thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:20Z",
            streaming: false,
          },
        },
        {
          id: "assistant-2-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:30Z",
          message: {
            id: "assistant-2" as never,
            role: "assistant",
            text: "Done again",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      turnDiffSummaryByAssistantMessageId: new Map([
        [
          "assistant-1" as never,
          {
            turnId: "turn-1" as never,
            completedAt: "2026-01-01T00:00:11Z",
            checkpointTurnCount: 3,
            files: [],
          },
        ],
        [
          "assistant-2" as never,
          {
            turnId: "turn-2" as never,
            completedAt: "2026-01-01T00:00:31Z",
            files: [],
          },
        ],
      ]),
      inferredCheckpointTurnCountByTurnId: {},
    });

    expect(result).toEqual(new Map([["user-1" as never, 2]]));
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });

  it("preserves unchanged grouped work rows when grouping arrays are rebuilt", () => {
    const firstWorkEntry = makeWorkEntry({
      id: "work-1",
      createdAt: "2026-01-01T00:00:00Z",
      label: "Read file",
      detail: "src/index.ts",
      changedFiles: ["src/index.ts"],
      changedFileStats: [{ path: "src/index.ts", additions: 4, deletions: 1 }],
    });
    const secondWorkEntry = makeWorkEntry({
      id: "work-2",
      createdAt: "2026-01-01T00:00:01Z",
      label: "Ran command",
      command: "bun lint",
      exitCode: 0,
    });
    const timelineEntries = [
      {
        id: "work-1",
        kind: "work" as const,
        createdAt: firstWorkEntry.createdAt,
        entry: firstWorkEntry,
      },
      {
        id: "work-2",
        kind: "work" as const,
        createdAt: secondWorkEntry.createdAt,
        entry: secondWorkEntry,
      },
    ];
    const firstRows = deriveMessagesTimelineRows({
      timelineEntries,
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });
    const nextRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          ...timelineEntries[0]!,
          entry: {
            ...firstWorkEntry,
            changedFiles: [...(firstWorkEntry.changedFiles ?? [])],
            changedFileStats: [...(firstWorkEntry.changedFileStats ?? [])],
          },
        },
        {
          ...timelineEntries[1]!,
          entry: { ...secondWorkEntry },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const stable = computeStableMessagesTimelineRows(nextRows, initial);

    expect(stable).toBe(initial);
    expect(stable.result[0]).toBe(initial.result[0]);
  });

  it("preserves unchanged message rows when equal message objects are recreated", () => {
    const initialUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "Start",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      streaming: false,
      attachments: [
        {
          type: "image" as const,
          id: "attachment-1",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 42,
          previewUrl: "blob:screen",
        },
      ],
    };
    const initialAssistantMessage = {
      id: "assistant-1" as never,
      role: "assistant" as const,
      text: "Working",
      turnId: "turn-1" as never,
      createdAt: "2026-01-01T00:00:01Z",
      streaming: true,
    };
    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: initialUserMessage.createdAt,
          message: initialUserMessage,
        },
        {
          id: "assistant-1-entry",
          kind: "message",
          createdAt: initialAssistantMessage.createdAt,
          message: initialAssistantMessage,
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const nextRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: initialUserMessage.createdAt,
          message: {
            ...initialUserMessage,
            attachments: initialUserMessage.attachments.map((attachment) => ({
              type: attachment.type,
              id: attachment.id,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              previewUrl: attachment.previewUrl,
            })),
          },
        },
        {
          id: "assistant-1-entry",
          kind: "message",
          createdAt: initialAssistantMessage.createdAt,
          message: { ...initialAssistantMessage, text: "Working." },
        },
      ],
      completionDividerBeforeEntryId: null,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const stable = computeStableMessagesTimelineRows(nextRows, initial);

    expect(stable.result[0]).toBe(initial.result[0]);
    expect(stable.result[1]).not.toBe(initial.result[1]);
  });
});

describe("timeline context split", () => {
  const STREAMING_KEYS = [
    "activeTurnInProgress",
    "activeTurnId",
    "isWorking",
    "isRevertingCheckpoint",
    "completionSummary",
    "openDiffTurnId",
  ];
  const STABLE_KEYS = [
    "timestampFormat",
    "routeThreadKey",
    "markdownCwd",
    "resolvedTheme",
    "workspaceRoot",
    "skills",
    "activeThreadEnvironmentId",
    "onRevertUserMessage",
    "onImageExpand",
    "onOpenTurnDiff",
    "onCloseDiff",
  ];

  function makeCombinedInput(): TimelineStreamingState & TimelineStableState {
    return {
      activeTurnInProgress: true,
      activeTurnId: TurnId.make("turn-1"),
      isWorking: true,
      isRevertingCheckpoint: false,
      completionSummary: "done",
      openDiffTurnId: null,
      timestampFormat: "locale",
      routeThreadKey: "environment-local:thread-1",
      markdownCwd: "/repo",
      resolvedTheme: "light",
      workspaceRoot: "/repo",
      skills: [],
      activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
      onRevertUserMessage: () => {},
      onImageExpand: () => {},
      onOpenTurnDiff: () => {},
      onCloseDiff: () => {},
    };
  }

  it("copies only the streaming-frequent fields into the streaming context", () => {
    const result = buildTimelineStreamingState(makeCombinedInput());
    expect(Object.keys(result).toSorted()).toEqual(STREAMING_KEYS.toSorted());
  });

  it("copies only the stable fields into the stable context", () => {
    const result = buildTimelineStableState(makeCombinedInput());
    expect(Object.keys(result).toSorted()).toEqual(STABLE_KEYS.toSorted());
  });

  it("partitions every shared field into exactly one context", () => {
    const overlap = STREAMING_KEYS.filter((key) => STABLE_KEYS.includes(key));
    expect(overlap).toEqual([]);
    expect([...STREAMING_KEYS, ...STABLE_KEYS].toSorted()).toEqual(
      Object.keys(makeCombinedInput()).toSorted(),
    );
  });

  it("preserves field values and callback identity", () => {
    const input = makeCombinedInput();
    const streaming = buildTimelineStreamingState(input);
    const stable = buildTimelineStableState(input);

    expect(streaming.isWorking).toBe(true);
    expect(streaming.completionSummary).toBe("done");
    expect(stable.routeThreadKey).toBe("environment-local:thread-1");
    expect(stable.onCloseDiff).toBe(input.onCloseDiff);
  });
});

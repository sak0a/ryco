import type { TimelineEntry, WorkLogEntry } from "@ryco/client-runtime/state/session";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadTimelineRows, toggleFold, type ActivityFold } from "./threadActivityFold";

const T0 = "2026-07-27T10:00:00.000Z";
const T12 = "2026-07-27T10:00:12.000Z";

function work(id: string, overrides: Partial<WorkLogEntry> = {}): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt: T0,
    entry: {
      id,
      createdAt: T0,
      label: "Tool call",
      tone: "tool",
      turnId: "turn-1",
      ...overrides,
    },
  } as unknown as TimelineEntry;
}

function message(id: string): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: T0,
    message: { id, role: "assistant", createdAt: T0 },
  } as unknown as TimelineEntry;
}

function build(
  entries: ReadonlyArray<TimelineEntry>,
  overrides: Partial<Parameters<typeof buildThreadTimelineRows>[0]> = {},
) {
  return buildThreadTimelineRows({
    entries,
    runningTurnId: null,
    expandedFoldIds: new Set(),
    now: T12,
    ...overrides,
  });
}

function folds(rows: ReturnType<typeof build>): ReadonlyArray<ActivityFold> {
  return rows.filter((row): row is ActivityFold => row.kind === "activity-fold");
}

describe("thread activity folds", () => {
  it("collapses consecutive work entries into one fold", () => {
    const rows = build([work("a"), work("b"), work("c")]);
    expect(rows).toHaveLength(1);
    expect(folds(rows)[0]?.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("splits a fold when a message interrupts the activity", () => {
    const rows = build([work("a"), message("m"), work("b")]);
    expect(rows.map((row) => row.kind)).toEqual(["activity-fold", "entry", "activity-fold"]);
    expect(folds(rows).map((fold) => fold.id)).toEqual(["fold:turn-1:a", "fold:turn-1:b"]);
  });

  it("never emits an empty fold", () => {
    expect(folds(build([message("m")]))).toHaveLength(0);
    expect(build([])).toEqual([]);
  });

  it("says Working… while the turn is running and measures to now", () => {
    const rows = build([work("a")], { runningTurnId: "turn-1" });
    expect(folds(rows)[0]?.status).toBe("running");
    expect(folds(rows)[0]?.label).toBe("Working…");
  });

  it("says how long a settled turn took", () => {
    const rows = build([work("a"), work("b", { createdAt: T12 })]);
    expect(folds(rows)[0]?.status).toBe("settled");
    expect(folds(rows)[0]?.label).toBe("Worked for 12s");
  });

  it("degrades to a bare Worked when timestamps are unusable", () => {
    const rows = build([work("a", { createdAt: "not-a-date" })]);
    expect(folds(rows)[0]?.label).toBe("Worked");
  });

  it("keeps the running fold open and settled folds closed by default", () => {
    expect(folds(build([work("a")], { runningTurnId: "turn-1" }))[0]?.expanded).toBe(true);
    expect(folds(build([work("a")]))[0]?.expanded).toBe(false);
  });

  it("promotes the tool's own title over the generic label", () => {
    const rows = build([work("a", { label: "Tool call", toolTitle: "Read file" })]);
    expect(folds(rows)[0]?.rows[0]?.heading).toBe("Read file");
    // ...and falls back to the label when there is no tool title.
    expect(folds(build([work("b")]))[0]?.rows[0]?.heading).toBe("Tool call");
  });

  it("surfaces the detail the old row threw away", () => {
    const rows = build([
      work("a", {
        detail: "src/App.tsx",
        command: "bun test\n--watch",
        output: "  2 passed  ",
        exitCode: 0,
        changedFiles: ["src/App.tsx"],
      }),
    ]);
    const row = folds(rows)[0]?.rows[0];
    expect(row?.detail).toBe("src/App.tsx");
    // Command preview is one line, whitespace-trimmed.
    expect(row?.command).toBe("bun test");
    expect(row?.output).toBe("2 passed");
    // Exit code 0 must survive — it is falsy but meaningful.
    expect(row?.exitCode).toBe(0);
    expect(row?.changedFiles).toEqual(["src/App.tsx"]);
  });

  it("skips blank lines when previewing a command", () => {
    expect(folds(build([work("a", { command: "\n\n  echo hi\nmore" })]))[0]?.rows[0]?.command).toBe(
      "echo hi",
    );
  });

  it("falls back to rawCommand when command is absent", () => {
    expect(folds(build([work("a", { rawCommand: "git status" })]))[0]?.rows[0]?.command).toBe(
      "git status",
    );
  });

  it("treats completed:false as still running and anything else as done", () => {
    expect(folds(build([work("a", { completed: false })]))[0]?.rows[0]?.completed).toBe(false);
    expect(folds(build([work("b", { completed: true })]))[0]?.rows[0]?.completed).toBe(true);
    // Absent means done — most settled entries never set it.
    expect(folds(build([work("c")]))[0]?.rows[0]?.completed).toBe(true);
  });
});

describe("toggleFold", () => {
  it("opens a collapsed fold", () => {
    const fold = folds(build([work("a")]))[0]!;
    const next = toggleFold(new Set(), fold);
    expect(folds(build([work("a")], { expandedFoldIds: next }))[0]?.expanded).toBe(true);
  });

  it("keeps a collapsed running fold collapsed across rebuilds", () => {
    // The bug this guards: a running fold defaults to open, so a plain
    // "expanded" set cannot represent "the user closed it" — it would spring
    // back open on the next timeline update.
    const running = folds(build([work("a")], { runningTurnId: "turn-1" }))[0]!;
    expect(running.expanded).toBe(true);

    const next = toggleFold(new Set(), running);
    const after = folds(build([work("a")], { runningTurnId: "turn-1", expandedFoldIds: next }))[0];
    expect(after?.expanded).toBe(false);
  });

  it("round-trips back to open", () => {
    const running = folds(build([work("a")], { runningTurnId: "turn-1" }))[0]!;
    const closed = toggleFold(new Set(), running);
    const reopened = toggleFold(
      closed,
      folds(build([work("a")], { runningTurnId: "turn-1", expandedFoldIds: closed }))[0]!,
    );
    expect(
      folds(build([work("a")], { runningTurnId: "turn-1", expandedFoldIds: reopened }))[0]
        ?.expanded,
    ).toBe(true);
  });
});

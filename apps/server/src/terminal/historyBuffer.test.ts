import { describe, expect, it } from "vite-plus/test";

import {
  type HistoryBufferLimits,
  appendTerminalHistoryChunk,
  emptyHistoryBufferState,
  historyBufferStateFrom,
} from "./historyBuffer.ts";

const limits = (maxBytes: number, maxLines = 5_000): HistoryBufferLimits => ({
  maxBytes,
  maxLines,
});

describe("appendTerminalHistoryChunk", () => {
  it("appends chunks under budget without trimming", () => {
    let state = emptyHistoryBufferState();
    state = appendTerminalHistoryChunk(state, "hello\n", limits(1_000));
    state = appendTerminalHistoryChunk(state, "world", limits(1_000));
    expect(state.history).toBe("hello\nworld");
  });

  it("trims from the head by whole lines when the byte budget overflows", () => {
    let state = emptyHistoryBufferState();
    state = appendTerminalHistoryChunk(state, "short\n", limits(1_000));
    // A single chunk larger than the budget: earlier lines roll off first.
    const bigChunk = `${"x".repeat(600)}\n${"y".repeat(600)}\n`;
    state = appendTerminalHistoryChunk(state, bigChunk, limits(700));
    expect(state.history.startsWith("x")).toBe(false);
    expect(state.history.endsWith("\n")).toBe(true);
    // Retained content is a tail of the appended data.
    expect(state.history).toBe(`${"y".repeat(600)}\n`);
  });

  it("keeps a fresh-line tail after rollover", () => {
    let state = emptyHistoryBufferState();
    state = appendTerminalHistoryChunk(state, "line-one\nline-two\n", limits(1_000));
    state = appendTerminalHistoryChunk(state, "line-three-payload\n", limits(20));
    expect(state.history).toBe("line-three-payload\n");
  });

  it("byte-trims a newline-less history at a character boundary", () => {
    let state = emptyHistoryBufferState();
    const long = "z".repeat(300);
    state = appendTerminalHistoryChunk(state, long, limits(100));
    expect(state.history.length).toBeLessThanOrEqual(100);
    expect(state.history.endsWith("z")).toBe(true);
    expect(state.history.startsWith("z")).toBe(true);
  });

  it("enforces the line budget from the head", () => {
    let state = emptyHistoryBufferState();
    for (let index = 0; index < 8; index += 1) {
      state = appendTerminalHistoryChunk(state, `line-${index}\n`, limits(1_000, 3));
    }
    expect(state.history).toBe("line-5\nline-6\nline-7\n");
  });

  it("accounts multi-byte characters without corrupting the budget", () => {
    let state = emptyHistoryBufferState();
    // Each line is "ééé\n" = 7 UTF-8 bytes; lines are the trim unit.
    for (let index = 0; index < 10; index += 1) {
      state = appendTerminalHistoryChunk(state, "ééé\n", limits(30));
    }
    expect(state.history.endsWith("ééé\n")).toBe(true);
    expect(state.approxBytes).toBeLessThanOrEqual(30);
    expect(state.history).toBe("ééé\n".repeat(4));
  });

  it("ignores empty chunks", () => {
    const state = appendTerminalHistoryChunk(
      appendTerminalHistoryChunk(emptyHistoryBufferState(), "kept\n", limits(100)),
      "",
      limits(100),
    );
    expect(state.history).toBe("kept\n");
  });

  it("preserves the previous behavior for histories within the line limit", () => {
    let state = emptyHistoryBufferState();
    for (let index = 0; index < 4; index += 1) {
      state = appendTerminalHistoryChunk(state, `line-${index}\n`, limits(1_000, 5));
    }
    expect(state.history).toBe("line-0\nline-1\nline-2\nline-3\n");
  });
});

describe("historyBufferStateFrom", () => {
  it("trims oversized loaded history to the byte budget", () => {
    const loaded = `${"a".repeat(400)}\n${"b".repeat(400)}\n`;
    const state = historyBufferStateFrom(loaded, limits(450));
    expect(state.history.startsWith("a")).toBe(false);
    expect(state.history).toBe(`${"b".repeat(400)}\n`);
  });

  it("re-derives counts for an empty history", () => {
    expect(historyBufferStateFrom("", limits(100))).toEqual(emptyHistoryBufferState());
  });
});

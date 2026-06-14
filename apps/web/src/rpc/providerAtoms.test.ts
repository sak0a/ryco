import { EnvironmentId, type EnvironmentApi, ThreadId } from "@ryco/contracts";
import { Option } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import * as environmentApi from "../environmentApi";
import { appAtomRegistry } from "./atomRegistry";
import {
  checkpointDiffCacheKey,
  checkpointDiffRetryDelay,
  checkpointDiffStateAtom,
  decodeCheckpointDiffRequest,
  executeCheckpointDiffRequest,
  invalidateAllCheckpointDiffs,
  invalidateCheckpointDiff,
  isCheckpointDiffEnabled,
  normalizeCheckpointErrorMessage,
  resetCheckpointDiffStateForTests,
  shouldRetryCheckpointDiff,
  watchCheckpointDiff,
  type CheckpointDiffInput,
} from "./providerAtoms";

const threadId = ThreadId.make("thread-id");
const environmentId = EnvironmentId.make("environment-local");

function mockOrchestrationApi(input: {
  getTurnDiff: ReturnType<typeof vi.fn>;
  getFullThreadDiff: ReturnType<typeof vi.fn>;
}) {
  vi.spyOn(environmentApi, "ensureEnvironmentApi").mockReturnValue({
    orchestration: {
      getTurnDiff: input.getTurnDiff,
      getFullThreadDiff: input.getFullThreadDiff,
    },
  } as unknown as EnvironmentApi);
}

function readState(input: CheckpointDiffInput) {
  return appAtomRegistry.get(checkpointDiffStateAtom(checkpointDiffCacheKey(input)));
}

afterEach(() => {
  resetCheckpointDiffStateForTests();
  vi.restoreAllMocks();
});

describe("checkpointDiffCacheKey", () => {
  it("includes cacheScope so reused turn counts do not collide", () => {
    const baseInput = {
      environmentId,
      threadId,
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: false,
    } as const;

    expect(checkpointDiffCacheKey({ ...baseInput, cacheScope: "turn:old-turn" })).not.toEqual(
      checkpointDiffCacheKey({ ...baseInput, cacheScope: "turn:new-turn" }),
    );
  });

  it("includes ignoreWhitespace so normal and whitespace-hidden diffs do not collide", () => {
    const baseInput = {
      environmentId,
      threadId,
      fromTurnCount: 1,
      toTurnCount: 2,
      cacheScope: "turn:abc",
    } as const;

    expect(checkpointDiffCacheKey({ ...baseInput, ignoreWhitespace: false })).not.toEqual(
      checkpointDiffCacheKey({ ...baseInput, ignoreWhitespace: true }),
    );
  });
});

describe("decodeCheckpointDiffRequest", () => {
  it("decodes a turn diff for non-zero ranges", () => {
    const decoded = decodeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: false,
    });
    expect(Option.isSome(decoded)).toBe(true);
    expect(Option.getOrThrow(decoded).kind).toBe("turnDiff");
  });

  it("decodes a full thread diff when the range starts from zero", () => {
    const decoded = decodeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    expect(Option.isSome(decoded)).toBe(true);
    expect(Option.getOrThrow(decoded).kind).toBe("fullThreadDiff");
  });

  it("is None for invalid ranges", () => {
    const decoded = decodeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 4,
      toTurnCount: 3,
      ignoreWhitespace: false,
    });
    expect(Option.isNone(decoded)).toBe(true);
  });
});

describe("isCheckpointDiffEnabled", () => {
  it("requires an environment, thread, valid range, and the enabled flag", () => {
    const valid = {
      environmentId,
      threadId,
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: false,
    } as const;

    expect(isCheckpointDiffEnabled(valid)).toBe(true);
    expect(isCheckpointDiffEnabled({ ...valid, enabled: false })).toBe(false);
    expect(isCheckpointDiffEnabled({ ...valid, environmentId: null })).toBe(false);
    expect(isCheckpointDiffEnabled({ ...valid, threadId: null })).toBe(false);
    expect(isCheckpointDiffEnabled({ ...valid, fromTurnCount: 4, toTurnCount: 3 })).toBe(false);
  });
});

describe("executeCheckpointDiffRequest", () => {
  it("forwards the checkpoint range to the turn diff API by default", async () => {
    const getTurnDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    const getFullThreadDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    await executeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 3,
      toTurnCount: 4,
      ignoreWhitespace: false,
      cacheScope: "turn:abc",
    });

    expect(getTurnDiff).toHaveBeenCalledWith({
      threadId,
      fromTurnCount: 3,
      toTurnCount: 4,
      ignoreWhitespace: false,
    });
    expect(getFullThreadDiff).not.toHaveBeenCalled();
  });

  it("forwards whitespace-hidden checkpoint ranges to the turn diff API", async () => {
    const getTurnDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    const getFullThreadDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    await executeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 3,
      toTurnCount: 4,
      ignoreWhitespace: true,
      cacheScope: "turn:abc",
    });

    expect(getTurnDiff).toHaveBeenCalledWith({
      threadId,
      fromTurnCount: 3,
      toTurnCount: 4,
      ignoreWhitespace: true,
    });
    expect(getFullThreadDiff).not.toHaveBeenCalled();
  });

  it("uses the full thread diff API when the range starts from zero", async () => {
    const getTurnDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    const getFullThreadDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    await executeCheckpointDiffRequest({
      environmentId,
      threadId,
      fromTurnCount: 0,
      toTurnCount: 2,
      ignoreWhitespace: true,
      cacheScope: "thread:all",
    });

    expect(getFullThreadDiff).toHaveBeenCalledWith({
      threadId,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    expect(getTurnDiff).not.toHaveBeenCalled();
  });

  it("fails fast on invalid range and does not call provider RPC", async () => {
    const getTurnDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    const getFullThreadDiff = vi.fn().mockResolvedValue({ diff: "patch" });
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    await expect(
      executeCheckpointDiffRequest({
        environmentId,
        threadId,
        fromTurnCount: 4,
        toTurnCount: 3,
        ignoreWhitespace: false,
        cacheScope: "turn:invalid",
      }),
    ).rejects.toThrow("Checkpoint diff is unavailable.");
    expect(getTurnDiff).not.toHaveBeenCalled();
    expect(getFullThreadDiff).not.toHaveBeenCalled();
  });
});

describe("checkpoint retry/backoff", () => {
  it("retries checkpoint-not-ready errors longer than generic failures", () => {
    expect(
      shouldRetryCheckpointDiff(
        1,
        new Error("Checkpoint turn count 2 exceeds current turn count 1."),
      ),
    ).toBe(true);
    expect(
      shouldRetryCheckpointDiff(
        11,
        new Error("Filesystem checkpoint is unavailable for turn 2 in thread thread-1."),
      ),
    ).toBe(true);
    expect(
      shouldRetryCheckpointDiff(
        12,
        new Error("Filesystem checkpoint is unavailable for turn 2 in thread thread-1."),
      ),
    ).toBe(false);
    expect(shouldRetryCheckpointDiff(2, new Error("Something else failed."))).toBe(true);
    expect(shouldRetryCheckpointDiff(3, new Error("Something else failed."))).toBe(false);
  });

  it("backs off longer for checkpoint-not-ready errors", () => {
    const checkpointDelay = checkpointDiffRetryDelay(
      4,
      new Error("Checkpoint turn count 2 exceeds current turn count 1."),
    );
    const genericDelay = checkpointDiffRetryDelay(4, new Error("Network failure"));
    expect(checkpointDelay).toBeGreaterThan(genericDelay);
  });
});

describe("normalizeCheckpointErrorMessage", () => {
  it("maps git-repo errors to a friendly message", () => {
    expect(normalizeCheckpointErrorMessage(new Error("fatal: not a git repository"))).toBe(
      "Turn diffs are unavailable because this project is not a git repository.",
    );
  });

  it("falls back to a default message for empty errors", () => {
    expect(normalizeCheckpointErrorMessage(new Error(""))).toBe("Failed to load checkpoint diff.");
  });

  it("passes through unknown messages unchanged", () => {
    expect(normalizeCheckpointErrorMessage("boom")).toBe("boom");
  });
});

describe("watchCheckpointDiff", () => {
  const input: CheckpointDiffInput = {
    environmentId,
    threadId,
    fromTurnCount: 1,
    toTurnCount: 2,
    ignoreWhitespace: false,
    cacheScope: "turn:abc",
  };

  it("resolves the checkpoint diff into atom state", async () => {
    const getTurnDiff = vi
      .fn()
      .mockResolvedValue({ diff: "patch", threadId, fromTurnCount: 1, toTurnCount: 2 });
    const getFullThreadDiff = vi.fn();
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    const unwatch = watchCheckpointDiff(input);
    await vi.waitFor(() => {
      expect(readState(input).data?.diff).toBe("patch");
    });
    expect(readState(input).isLoading).toBe(false);
    expect(readState(input).error).toBeNull();
    unwatch();
  });

  it("refetches when the thread's checkpoint cache is invalidated", async () => {
    const getTurnDiff = vi
      .fn()
      .mockResolvedValue({ diff: "patch", threadId, fromTurnCount: 1, toTurnCount: 2 });
    const getFullThreadDiff = vi.fn();
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    const unwatch = watchCheckpointDiff(input);
    await vi.waitFor(() => {
      expect(readState(input).data?.diff).toBe("patch");
    });
    expect(getTurnDiff).toHaveBeenCalledTimes(1);

    invalidateCheckpointDiff(threadId);
    await vi.waitFor(() => {
      expect(getTurnDiff).toHaveBeenCalledTimes(2);
    });
    unwatch();
  });

  it("surfaces a normalized error after exhausting generic retries", async () => {
    const getTurnDiff = vi.fn().mockRejectedValue(new Error("boom"));
    const getFullThreadDiff = vi.fn();
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    const unwatch = watchCheckpointDiff(input);
    await vi.waitFor(
      () => {
        expect(readState(input).error?.message).toBe("boom");
      },
      { timeout: 2_000 },
    );
    expect(getTurnDiff).toHaveBeenCalledTimes(3);
    unwatch();
  });

  it("invalidateAllCheckpointDiffs refetches active watchers", async () => {
    const getTurnDiff = vi
      .fn()
      .mockResolvedValue({ diff: "patch", threadId, fromTurnCount: 1, toTurnCount: 2 });
    const getFullThreadDiff = vi.fn();
    mockOrchestrationApi({ getTurnDiff, getFullThreadDiff });

    const unwatch = watchCheckpointDiff(input);
    await vi.waitFor(() => {
      expect(getTurnDiff).toHaveBeenCalledTimes(1);
    });

    invalidateAllCheckpointDiffs();
    await vi.waitFor(() => {
      expect(getTurnDiff).toHaveBeenCalledTimes(2);
    });
    unwatch();
  });
});

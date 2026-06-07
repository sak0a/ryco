import { describe, expect, it } from "vitest";
import { DateTime, Option, Schema } from "effect";

import {
  ProviderEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
} from "./provider.ts";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(ProviderSendTurnInput);
const decodeProviderSession = Schema.decodeUnknownSync(ProviderSession);
const decodeProviderEvent = Schema.decodeUnknownSync(ProviderEvent);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}

describe("ProviderSessionStartInput", () => {
  it("accepts codex-compatible payloads", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/workspace",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    expect(parsed.runtimeMode).toBe("full-access");
    expect(parsed.modelSelection?.instanceId).toBe("codex");
    expect(parsed.modelSelection?.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(parsed.modelSelection?.options, "reasoningEffort")).toBe("high");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("rejects payloads without runtime mode", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
      }),
    ).toThrow();
  });

  it("accepts claude runtime knobs", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "claudeAgent",
      cwd: "/tmp/workspace",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [
          { id: "thinking", value: true },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "full-access",
    });
    expect(parsed.provider).toBe("claudeAgent");
    expect(parsed.modelSelection?.instanceId).toBe("claudeAgent");
    expect(parsed.modelSelection?.model).toBe("claude-sonnet-4-6");
    expect(getOptionValue(parsed.modelSelection?.options, "thinking")).toBe(true);
    expect(getOptionValue(parsed.modelSelection?.options, "effort")).toBe("max");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
    expect(parsed.runtimeMode).toBe("full-access");
  });

  it("accepts cursor provider", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "cursor",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
      modelSelection: {
        provider: "cursor",
        model: "composer-2",
        options: [{ id: "fastMode", value: true }],
      },
    });
    expect(parsed.provider).toBe("cursor");
    expect(parsed.modelSelection?.instanceId).toBe("cursor");
    expect(parsed.modelSelection?.model).toBe("composer-2");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("accepts fork-provided driver kinds as branded slugs", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "ollama",
      providerInstanceId: "ollama_local",
      cwd: "/tmp/workspace",
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: "ollama_local",
        model: "llama3.3",
      },
    });

    expect(parsed.provider).toBe("ollama");
    expect(parsed.providerInstanceId).toBe("ollama_local");
    expect(parsed.modelSelection?.instanceId).toBe("ollama_local");
  });
});

describe("ProviderSendTurnInput", () => {
  it("accepts codex modelSelection", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "xhigh" },
          { id: "fastMode", value: true },
        ],
      },
    });

    expect(parsed.modelSelection?.instanceId).toBe("codex");
    expect(parsed.modelSelection?.model).toBe("gpt-5.3-codex");
    expect(getOptionValue(parsed.modelSelection?.options, "reasoningEffort")).toBe("xhigh");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("accepts claude modelSelection including ultrathink", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [
          { id: "effort", value: "ultrathink" },
          { id: "fastMode", value: true },
        ],
      },
    });

    expect(parsed.modelSelection?.instanceId).toBe("claudeAgent");
    expect(getOptionValue(parsed.modelSelection?.options, "effort")).toBe("ultrathink");
    expect(getOptionValue(parsed.modelSelection?.options, "fastMode")).toBe(true);
  });

  it("round-trips sourceControlContexts with an issue context and a change-request context", () => {
    const fetchedAt = DateTime.fromDateUnsafe(new Date("2024-06-01T14:00:00.000Z"));
    const staleAfter = DateTime.fromDateUnsafe(new Date("2024-06-01T14:05:00.000Z"));
    const commentCreatedAt = DateTime.fromDateUnsafe(new Date("2024-06-01T13:00:00.000Z"));
    const issueUpdatedAt = DateTime.fromDateUnsafe(new Date("2024-06-01T12:00:00.000Z"));

    // Build input using plain threadId string (decoded first so threadId gets branded)
    // and real DateTime/Option values (required by Schema.Option/Schema.DateTimeUtc).
    const wireInput = {
      threadId: "thread-1",
      sourceControlContexts: [
        {
          id: "ctx-issue-1",
          kind: "issue",
          provider: "github",
          reference: "owner/repo#42",
          detail: {
            provider: "github",
            number: 42,
            title: "Fix login bug",
            url: "https://github.com/owner/repo/issues/42",
            state: "open",
            author: "alice",
            updatedAt: Option.some(issueUpdatedAt),
            body: "The login button does not work.",
            comments: [
              {
                author: "bob",
                body: "I can reproduce this.",
                createdAt: commentCreatedAt,
              },
            ],
            truncated: false,
          },
          fetchedAt,
          staleAfter,
        },
        {
          id: "ctx-cr-1",
          kind: "change-request",
          provider: "github",
          reference: "owner/repo#7",
          detail: {
            provider: "github",
            number: 7,
            title: "Add dark mode",
            url: "https://github.com/owner/repo/pull/7",
            baseRefName: "main",
            headRefName: "feature/dark-mode",
            state: "open",
            updatedAt: Option.none(),
            body: "Implements dark mode toggle.",
            comments: [],
            truncated: false,
          },
          fetchedAt,
          staleAfter,
        },
      ],
    };

    const decoded = decodeProviderSendTurnInput(wireInput);
    const encoded = Schema.encodeSync(ProviderSendTurnInput)(decoded);
    const reDecoded = decodeProviderSendTurnInput(encoded);

    expect(reDecoded.sourceControlContexts).toHaveLength(2);
    expect(reDecoded.sourceControlContexts![0]!.id).toBe("ctx-issue-1");
    expect(reDecoded.sourceControlContexts![0]!.kind).toBe("issue");
    expect(reDecoded.sourceControlContexts![1]!.id).toBe("ctx-cr-1");
    expect(reDecoded.sourceControlContexts![1]!.kind).toBe("change-request");
    expect(Option.isSome(reDecoded.sourceControlContexts![0]!.detail.updatedAt)).toBe(true);
    expect(Option.isNone(reDecoded.sourceControlContexts![1]!.detail.updatedAt)).toBe(true);
  });
});

describe("providerInstanceId routing key (slice-2 invariant)", () => {
  it("decodes a ProviderSessionStartInput without providerInstanceId (legacy producer)", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      runtimeMode: "full-access",
    });
    expect(parsed.providerInstanceId).toBeUndefined();
  });

  it("decodes a ProviderSessionStartInput with providerInstanceId (post-migration producer)", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      providerInstanceId: "codex_personal",
      runtimeMode: "full-access",
    });
    expect(parsed.providerInstanceId).toBe("codex_personal");
  });

  it("propagates providerInstanceId through ProviderSession decode", () => {
    const session = decodeProviderSession({
      provider: "codex",
      providerInstanceId: "codex_work",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    expect(session.providerInstanceId).toBe("codex_work");
  });

  it("decodes ProviderSession for fork-provided driver kinds", () => {
    const session = decodeProviderSession({
      provider: "ollama",
      providerInstanceId: "ollama_local",
      status: "ready",
      runtimeMode: "full-access",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });

    expect(session.provider).toBe("ollama");
    expect(session.providerInstanceId).toBe("ollama_local");
  });

  it("decodes a ProviderEvent carrying both legacy provider and new instance routing", () => {
    const event = decodeProviderEvent({
      id: "event-1",
      kind: "notification",
      provider: "codex",
      providerInstanceId: "codex_personal",
      threadId: "thread-1",
      createdAt: "2024-01-01T00:00:00Z",
      method: "session.created",
    });
    expect(event.provider).toBe("codex");
    expect(event.providerInstanceId).toBe("codex_personal");
  });

  it("rejects providerInstanceId values that fail the slug pattern (defense in depth)", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
        providerInstanceId: "1bad",
        runtimeMode: "full-access",
      }),
    ).toThrow();
  });
});

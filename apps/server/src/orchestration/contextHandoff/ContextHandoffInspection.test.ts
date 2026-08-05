import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ContextHandoffDocument } from "./ContextHandoffBuilder.ts";
import {
  contextHandoffUtf8Chunk,
  decodeContextHandoffCursor,
  encodeContextHandoffCursor,
  formatContextHandoffJson,
} from "./ContextHandoffInspection.ts";
import { formatContextHandoffMarkdown } from "./ContextHandoffMarkdown.ts";

const source = {
  providerInstanceId: ProviderInstanceId.make("codex_work"),
  driverKind: ProviderDriverKind.make("codex"),
  modelSlug: "gpt-5.6-sol",
  modelDisplayName: "GPT-5.6 Sol",
  providerDisplayName: "Codex",
};
const target = {
  providerInstanceId: ProviderInstanceId.make("claude_work"),
  driverKind: ProviderDriverKind.make("claudeAgent"),
  modelSlug: "claude-fable-5",
  modelDisplayName: "Fable 5",
  providerDisplayName: "Claude",
};
const document: ContextHandoffDocument = {
  version: 1,
  mode: "full-context-fresh-session",
  thread: {
    id: ThreadId.make("thread-inspection"),
    title: "Inspection",
    branch: null,
    worktreePath: null,
  },
  provenance: { sources: [source], target },
  messages: [],
  plans: [],
  tools: [],
  checkpoints: [],
  notices: [],
  subagents: [],
  priorHandoffs: [],
};

describe("context handoff inspection formatting", () => {
  it("chunks only at UTF-8 boundaries and rejects a mid-codepoint offset", () => {
    const value = "a😀b";
    const first = contextHandoffUtf8Chunk(value, 0, 3);
    expect(first.chunk).toBe("a");
    expect(first.nextOffset).toBe(1);
    const second = contextHandoffUtf8Chunk(value, first.nextOffset!, 4);
    expect(second.chunk).toBe("😀");
    expect(second.nextOffset).toBe(5);
    expect(() => contextHandoffUtf8Chunk(value, 2, 4)).toThrow("not a UTF-8 boundary");
  });

  it("binds opaque cursors to the handoff, scope, section, digest, and index", () => {
    const encoded = encodeContextHandoffCursor({
      handoffId: "handoff-1",
      scope: "sent",
      section: "messages",
      digest: "a".repeat(64),
      index: 7,
    });
    expect(encoded).not.toContain("handoff-1");
    expect(decodeContextHandoffCursor(encoded)).toMatchObject({
      handoffId: "handoff-1",
      scope: "sent",
      section: "messages",
      index: 7,
    });
    expect(() => decodeContextHandoffCursor("not-a-cursor")).toThrow();
  });

  it("produces deterministic JSON and safe Markdown fences with friendly names", () => {
    const json = formatContextHandoffJson({
      scope: "complete",
      handoffId: "handoff-1",
      status: "sent",
      digest: "a".repeat(64),
      completeDocument: document,
    });
    expect(json).toBe(
      formatContextHandoffJson({
        scope: "complete",
        handoffId: "handoff-1",
        status: "sent",
        digest: "a".repeat(64),
        completeDocument: document,
      }),
    );
    expect(JSON.parse(json)).toMatchObject({
      exportVersion: 1,
      scope: "complete",
    });

    const markdown = formatContextHandoffMarkdown({
      scope: "sent",
      handoffId: "handoff-1",
      status: "sent",
      createdAt: "2026-08-05T10:00:00.000Z",
      digest: "a".repeat(64),
      sources: [source],
      target,
      truncated: false,
      document,
      triggeringMessage: "contains ``` inside",
    });
    expect(markdown).toContain("Codex / GPT-5.6 Sol");
    expect(markdown).toContain("Claude / Fable 5");
    expect(markdown).toContain("````text\ncontains ``` inside\n````");
  });
});

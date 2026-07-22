import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vite-plus/test";

import { AntigravitySettings } from "@ryco/contracts";

import {
  buildAntigravityPromptArgs,
  extractTextFromStepPayload,
  readAntigravityResponseDelta,
  runAntigravityPrompt,
} from "./antigravityRuntime.ts";

function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return Uint8Array.from(bytes);
}

function encodeLengthDelimitedField(fieldNumber: number, payload: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...encodeVarint(fieldNumber * 8 + 2),
    ...encodeVarint(payload.length),
    ...payload,
  ]);
}

function encodeAntigravityAssistantStep(text: string): Uint8Array {
  const inner = encodeLengthDelimitedField(1, new TextEncoder().encode(text));
  return encodeLengthDelimitedField(20, inner);
}

function makeSettings(overrides: Partial<AntigravitySettings> = {}): AntigravitySettings {
  return Schema.decodeSync(AntigravitySettings)({
    binaryPath: "agy",
    ...overrides,
  });
}

describe("antigravityRuntime", () => {
  it("extracts assistant text from Antigravity step protobuf field 20.1", () => {
    expect(extractTextFromStepPayload(encodeAntigravityAssistantStep("hello from agy"))).toBe(
      "hello from agy",
    );
  });

  it("reads assistant deltas from the Antigravity conversation database", () => {
    const root = mkdtempSync(join(tmpdir(), "ryco-agy-runtime-"));
    const conversationsDir = join(root, "conversations");
    mkdirSync(conversationsDir, { recursive: true });
    const db = new DatabaseSync(join(conversationsDir, "conversation-1.db"));
    try {
      db.exec("CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB)");
      const insert = db.prepare(
        "INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)",
      );
      insert.run(1, 15, encodeAntigravityAssistantStep("old response"));
      insert.run(2, 15, encodeAntigravityAssistantStep("I will inspect the repository."));
      insert.run(3, 15, encodeAntigravityAssistantStep("final response"));

      expect(
        readAntigravityResponseDelta({
          conversationsDir,
          conversationId: "conversation-1",
          afterStepIdx: 1,
          toolDisplay: "compact",
        }),
      ).toEqual({
        text: "final response",
        maxStepIdx: 3,
      });
    } finally {
      db.close();
    }
  });

  it("builds print-mode args with cwd, permissions, timeout, model, and prompt", () => {
    expect(
      buildAntigravityPromptArgs({
        settings: makeSettings({ printTimeout: "5m" }),
        cwd: "/repo",
        prompt: "say hi",
        runtimeMode: "full-access",
        model: "Claude Sonnet 4.6 (Thinking)",
      }),
    ).toEqual([
      "--add-dir",
      "/repo",
      "--dangerously-skip-permissions",
      "--print-timeout",
      "5m",
      "--model",
      "Claude Sonnet 4.6 (Thinking)",
      "-p",
      "say hi",
    ]);
  });

  it.effect("falls back to stdout when no conversation database is created", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "ryco-agy-stdout-"));
      const binaryPath = join(root, "agy");
      writeFileSync(
        binaryPath,
        [
          "#!/bin/sh",
          "cat >/dev/null",
          'printf "%s\\n" "$@" > "$HOME/args.log"',
          'printf "%s\\n" "stdout answer"',
        ].join("\n"),
        { mode: 0o755 },
      );

      const result = yield* runAntigravityPrompt({
        settings: makeSettings({ binaryPath, homePath: root }),
        cwd: root,
        prompt: "hello",
        runtimeMode: "approval-required",
        model: "auto",
        state: { lastStepIdx: 0 },
      }).pipe(Effect.provide(NodeServices.layer));

      expect(result.text).toBe("stdout answer");
      expect(result.conversationId).toBeUndefined();
      expect(result.lastStepIdx).toBe(0);
    }),
  );

  it.effect("streams assistant deltas from the conversation database while agy is running", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "ryco-agy-live-"));
      const binaryPath = join(root, "agy");
      writeFileSync(
        binaryPath,
        [
          "#!/bin/sh",
          "cat >/dev/null",
          "node --input-type=module <<'NODE'",
          "import { DatabaseSync } from 'node:sqlite';",
          "import { mkdirSync } from 'node:fs';",
          "import { join } from 'node:path';",
          "const conversationsDir = join(process.env.HOME, '.gemini/antigravity-cli/conversations');",
          "const dbPath = join(conversationsDir, 'conversation-live.db');",
          "mkdirSync(conversationsDir, { recursive: true });",
          "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
          "function encodeVarint(value) {",
          "  const bytes = [];",
          "  let remaining = value;",
          "  while (remaining >= 0x80) {",
          "    bytes.push((remaining & 0x7f) | 0x80);",
          "    remaining = Math.floor(remaining / 0x80);",
          "  }",
          "  bytes.push(remaining);",
          "  return Uint8Array.from(bytes);",
          "}",
          "function encodeLengthDelimitedField(fieldNumber, payload) {",
          "  return Uint8Array.from([",
          "    ...encodeVarint(fieldNumber * 8 + 2),",
          "    ...encodeVarint(payload.length),",
          "    ...payload,",
          "  ]);",
          "}",
          "function encodeAssistantStep(text) {",
          "  const inner = encodeLengthDelimitedField(1, new TextEncoder().encode(text));",
          "  return encodeLengthDelimitedField(20, inner);",
          "}",
          "function insertStep(idx, text) {",
          "  const db = new DatabaseSync(dbPath);",
          "  db.exec('CREATE TABLE IF NOT EXISTS steps (idx INTEGER, step_type INTEGER, step_payload BLOB)');",
          "  db.prepare('INSERT INTO steps (idx, step_type, step_payload) VALUES (?, ?, ?)').run(idx, 15, encodeAssistantStep(text));",
          "  db.close();",
          "}",
          "insertStep(1, 'live first');",
          "await sleep(300);",
          "insertStep(2, 'live second');",
          "await sleep(300);",
          "NODE",
        ].join("\n"),
        { mode: 0o755 },
      );

      const deltas: Array<string> = [];
      const activities: Array<string> = [];
      const result = yield* runAntigravityPrompt({
        settings: makeSettings({ binaryPath, homePath: root }),
        cwd: root,
        prompt: "hello",
        runtimeMode: "approval-required",
        model: "auto",
        state: { lastStepIdx: 0 },
        pollIntervalMs: 25,
        activityIntervalMs: 50,
        onTextDelta: (delta) =>
          Effect.sync(() => {
            deltas.push(delta.text);
          }),
        onActivity: (activity) =>
          Effect.sync(() => {
            activities.push(activity.summary);
          }),
      }).pipe(Effect.provide(NodeServices.layer));

      console.log({ deltas, activities, result });
      expect(deltas.join("\n")).toBe("live first\nlive second");
      expect(activities).toContain("Antigravity conversation started");
      expect(result.text).toBe("live first\nlive second");
      expect(result.streamedText).toBe("live first\nlive second");
      expect(result.conversationId).toBe("conversation-live");
      expect(result.lastStepIdx).toBe(2);
    }),
  );
});

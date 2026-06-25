import {
  BrowserHostId,
  BrowserHostRunId,
  BrowserProfileId,
  BrowserServiceError,
  BrowserSessionId,
  BrowserTabId,
  ThreadId,
  type BrowserHostCapabilities,
  type BrowserHostCommand,
  type BrowserProfile,
  type BrowserSessionSnapshot,
} from "@ryco/contracts";
import { Effect, Exit, Fiber, Option, Scope, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { BrowserHostRegistry, BrowserHostRegistryLive } from "./BrowserHostRegistry.ts";

const capabilities = {
  surface: true,
  persistentProfiles: true,
  temporaryProfiles: true,
  screenshots: false,
  domSnapshot: true,
  input: true,
  downloads: false,
  devtools: false,
} satisfies BrowserHostCapabilities;

const hostId = BrowserHostId.make("browser-host:test");
const runId = BrowserHostRunId.make("browser-host-run:1");
const now = "2026-06-24T10:00:00.000Z";

function makeProfile(): BrowserProfile {
  return {
    profileId: BrowserProfileId.make("browser-profile:test"),
    displayName: "Test profile",
    mode: "thread",
    scope: { mode: "thread", threadId: ThreadId.make("thread-1") },
    persistent: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makeSession(profile: BrowserProfile): BrowserSessionSnapshot {
  const sessionId = BrowserSessionId.make("browser-session:test");
  const tabId = BrowserTabId.make("browser-tab:test");
  return {
    sessionId,
    profileId: profile.profileId,
    threadId: ThreadId.make("thread-1"),
    selectedTabId: tabId,
    tabs: [
      {
        tabId,
        sessionId,
        profileId: profile.profileId,
        selected: true,
        crashed: false,
        navigation: {
          url: "about:blank",
          origin: null,
          loadState: "idle",
          canGoBack: false,
          canGoForward: false,
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
    status: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

type BrowserOpenSessionCommand = Extract<BrowserHostCommand, { readonly kind: "open_session" }>;

function makeOpenSessionCommand(): BrowserOpenSessionCommand {
  const profile = makeProfile();
  return {
    kind: "open_session",
    profile,
    session: makeSession(profile),
  };
}

const runRegistry = <A, E>(effect: Effect.Effect<A, E, BrowserHostRegistry | Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(BrowserHostRegistryLive))));

const findFailure = (exit: Exit.Exit<unknown, unknown>) =>
  exit._tag === "Failure" ? exit.cause.reasons.find((reason) => reason._tag === "Fail") : undefined;

describe("BrowserHostRegistry", () => {
  it("queues host commands and resolves them from command results", async () => {
    const result = await runRegistry(
      Effect.gen(function* () {
        const registry = yield* BrowserHostRegistry;
        yield* registry.register({ hostId, runId, capabilities });
        const command = makeOpenSessionCommand();
        const fiber = yield* registry
          .sendCommand({ command, timeoutMs: 1_000 })
          .pipe(Effect.forkScoped);
        const envelopeOption = yield* registry
          .commandStream({ hostId, runId })
          .pipe(Stream.runHead);

        if (Option.isNone(envelopeOption)) {
          return yield* Effect.die(new Error("Expected queued browser host command."));
        }

        const envelope = envelopeOption.value;
        yield* registry.completeCommand({
          hostId,
          runId,
          result: {
            ok: true,
            commandId: envelope.commandId,
            result: { session: command.session },
          },
        });

        return yield* Fiber.join(fiber);
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.session?.sessionId).toBe(BrowserSessionId.make("browser-session:test"));
    }
  });

  it("fails pending commands when a new host run registers", async () => {
    const exit = await runRegistry(
      Effect.gen(function* () {
        const registry = yield* BrowserHostRegistry;
        yield* registry.register({ hostId, runId, capabilities });
        const fiber = yield* registry
          .sendCommand({ command: makeOpenSessionCommand(), timeoutMs: 1_000 })
          .pipe(Effect.forkScoped);
        const envelopeOption = yield* registry
          .commandStream({ hostId, runId })
          .pipe(Stream.runHead);
        if (Option.isNone(envelopeOption)) {
          return yield* Effect.die(new Error("Expected queued browser host command."));
        }
        yield* registry.register({
          hostId,
          runId: BrowserHostRunId.make("browser-host-run:2"),
          capabilities,
        });
        return yield* Effect.exit(Fiber.join(fiber));
      }),
    );

    const failure = findFailure(exit);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "host_disconnected", retryable: true });
  });

  it("times out commands that are not completed by the host", async () => {
    const exit = await runRegistry(
      Effect.gen(function* () {
        const registry = yield* BrowserHostRegistry;
        yield* registry.register({ hostId, runId, capabilities });
        return yield* Effect.exit(
          registry.sendCommand({ command: makeOpenSessionCommand(), timeoutMs: 20 }),
        );
      }),
    );

    const failure = findFailure(exit);
    expect(failure?.error).toBeInstanceOf(BrowserServiceError);
    expect(failure?.error).toMatchObject({ code: "command_timeout", retryable: true });
  });
});

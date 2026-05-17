import { Effect } from "effect";
import type { OpenShape } from "../open.ts";
import type { TerminalManagerShape } from "../terminal/Services/Manager.ts";
import type { DetectedServerRegistryShape } from "./Services/DetectedServerRegistry.ts";

export type StopResult =
  | { readonly kind: "stopped" }
  | { readonly kind: "not-stoppable"; readonly hint: "interrupt-turn" };

export const handleDetectedServerStop = (
  registry: DetectedServerRegistryShape,
  terminalManager: TerminalManagerShape,
  serverId: string,
): Effect.Effect<StopResult> =>
  Effect.gen(function* () {
    const server = yield* registry.findById(serverId);
    if (!server) {
      return { kind: "not-stoppable", hint: "interrupt-turn" } as const;
    }
    if (server.source === "pty" && server.terminalId) {
      yield* terminalManager
        .close({ threadId: server.threadId, terminalId: server.terminalId })
        .pipe(Effect.ignore({ log: true }));
      return { kind: "stopped" } as const;
    }
    return { kind: "not-stoppable", hint: "interrupt-turn" } as const;
  });

export const handleDetectedServerOpenInBrowser = (
  registry: DetectedServerRegistryShape,
  open: OpenShape,
  serverId: string,
): Effect.Effect<{ readonly ok: boolean }> =>
  Effect.gen(function* () {
    const server = yield* registry.findById(serverId);
    if (!server?.url) {
      return { ok: false } as const;
    }
    yield* open.openBrowser(server.url).pipe(Effect.ignore({ log: true }));
    return { ok: true } as const;
  });

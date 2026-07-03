import type { ThreadId } from "@ryco/contracts";
import { Effect, Option } from "effect";

import { BrowserMcpBridge } from "./BrowserMcpBridge.ts";
import { BrowserService } from "./BrowserService.ts";

export function cleanupBrowserThreadAfterProviderTurn(
  threadId: ThreadId,
  options?: {
    readonly stopBridge?: boolean;
    readonly closeAgentSessions?: boolean;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (options?.stopBridge !== false) {
      const bridge = yield* Effect.serviceOption(BrowserMcpBridge);
      yield* Option.match(bridge, {
        onNone: () => Effect.void,
        onSome: (service) => service.stop(threadId).pipe(Effect.ignore),
      });
    }

    if (options?.closeAgentSessions !== false) {
      const browser = yield* Effect.serviceOption(BrowserService);
      yield* Option.match(browser, {
        onNone: () => Effect.void,
        onSome: (service) =>
          service.closeAgentSessionsForThread(threadId).pipe(Effect.catch(() => Effect.void)),
      });
    }
  });
}

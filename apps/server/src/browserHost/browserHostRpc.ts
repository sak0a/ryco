import { Effect } from "effect";
import { BrowserHostRpcGroup, BROWSER_HOST_METHODS } from "@ryco/contracts";

import { BrowserHostRegistry } from "../browser/BrowserHostRegistry.ts";

export const makeBrowserHostRpcLayer = () =>
  BrowserHostRpcGroup.toLayer(
    Effect.gen(function* () {
      const registry = yield* BrowserHostRegistry;
      return BrowserHostRpcGroup.of({
        [BROWSER_HOST_METHODS.register]: (input) => registry.register(input),
        [BROWSER_HOST_METHODS.heartbeat]: (input) => registry.heartbeat(input).pipe(Effect.as({})),
        [BROWSER_HOST_METHODS.subscribeCommands]: (input) => registry.commandStream(input),
        [BROWSER_HOST_METHODS.commandResult]: (input) =>
          registry
            .completeCommand({
              hostId: input.hostId,
              runId: input.runId,
              result: input.result,
            })
            .pipe(Effect.as({})),
        [BROWSER_HOST_METHODS.event]: (input) =>
          registry
            .publishHostEvent({
              hostId: input.hostId,
              runId: input.runId,
              event: input.event,
            })
            .pipe(Effect.as({})),
      });
    }),
  );

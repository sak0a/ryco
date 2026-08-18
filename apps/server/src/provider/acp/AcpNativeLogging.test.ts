import { ProviderDriverKind, ThreadId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import type { EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import { makeAcpNativeLoggers } from "./AcpNativeLogging.ts";

it.effect("redacts Agent Control bearer and bootstrap secrets before native persistence", () => {
  const records: Array<unknown> = [];
  const logger: EventNdjsonLogger = {
    filePath: "/unused",
    write: (event) => Effect.sync(() => records.push(event)),
    close: () => Effect.void,
  };
  const bearer = `rycoac_${"a".repeat(43)}`;
  const bootstrap = `rycoacb_${"b".repeat(43)}`;
  return Effect.gen(function* () {
    const loggers = makeAcpNativeLoggers({
      nativeEventLogger: logger,
      provider: ProviderDriverKind.make("cursor"),
      threadId: ThreadId.make("thread-log-redaction"),
    });
    yield* loggers.requestLogger!({
      method: "session/new",
      status: "started",
      payload: { headers: [{ value: `Bearer ${bearer}` }], env: [{ value: bootstrap }] },
    });
    yield* loggers.protocolLogging!.logger!({
      direction: "outgoing",
      message: JSON.stringify({ bearer, bootstrap }),
    } as never);
    const serialized = JSON.stringify(records);
    assert.notInclude(serialized, bearer);
    assert.notInclude(serialized, bootstrap);
    assert.include(serialized, "[REDACTED]");
  });
});

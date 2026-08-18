import {
  CommandId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@ryco/contracts";
import { assert, it, vi } from "@effect/vitest";
import { Effect, Option } from "effect";

import type { TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import { applyOrchestrationNormalizedCommand } from "./OrchestrationCommandApplication.ts";

const threadId = ThreadId.make("thread-archive");

it.effect(
  "applies archive through the shared dispatcher and preserves session/terminal cleanup",
  () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const close = vi.fn((_input: { readonly threadId: ThreadId }) => Effect.void);
      const command: OrchestrationCommand = {
        type: "thread.archive",
        commandId: CommandId.make("archive-command"),
        threadId,
      };

      const result = yield* applyOrchestrationNormalizedCommand({
        command,
        dispatch: (next) => {
          dispatched.push(next);
          return Effect.succeed({ sequence: dispatched.length });
        },
        projections: {
          getThreadShellById: () =>
            Effect.succeed(
              Option.some({
                id: threadId,
                session: { status: "running" },
              } as OrchestrationThreadShell),
            ),
        } as unknown as ProjectionSnapshotQueryShape,
        terminals: { close } as unknown as TerminalManagerShape,
      });

      assert.strictEqual(result.sequence, 1);
      assert.deepStrictEqual(
        dispatched.map((entry) => entry.type),
        ["thread.archive", "thread.session.stop"],
      );
      assert.strictEqual(
        dispatched[1]?.commandId,
        CommandId.make("session-stop-for-archive:archive-command"),
      );
      assert.strictEqual(close.mock.calls.length, 1);
      assert.deepStrictEqual(close.mock.calls[0]?.[0], { threadId });
    }),
);

it.effect("does not add archive cleanup to unrelated commands", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const close = vi.fn((_input: { readonly threadId: ThreadId }) => Effect.void);
    const command: OrchestrationCommand = {
      type: "thread.meta.update",
      commandId: CommandId.make("title-command"),
      threadId,
      title: "Renamed",
    };

    yield* applyOrchestrationNormalizedCommand({
      command,
      dispatch: (next) => {
        dispatched.push(next);
        return Effect.succeed({ sequence: 1 });
      },
      projections: {} as ProjectionSnapshotQueryShape,
      terminals: { close } as unknown as TerminalManagerShape,
    });

    assert.deepStrictEqual(dispatched, [command]);
    assert.strictEqual(close.mock.calls.length, 0);
  }),
);

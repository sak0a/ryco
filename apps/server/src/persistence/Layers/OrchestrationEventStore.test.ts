import { CommandId, EventId, ProjectId, PullRequestId, ThreadId } from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays decoded events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.make("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.make("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
        },
        payload: {
          projectId: ProjectId.make("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
    }),
  );

  it.effect("round trips DateTime values in pull request events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const viewedAt = DateTime.makeUnsafe("2026-08-08T21:58:59.598Z");
      const pullRequestId = PullRequestId.make("pr-datetime-roundtrip");

      const appended = yield* eventStore.append({
        type: "pull-request.viewed",
        eventId: EventId.make("evt-store-pr-viewed"),
        aggregateKind: "pull-request",
        aggregateId: pullRequestId,
        occurredAt: DateTime.formatIso(viewedAt),
        commandId: CommandId.make("cmd-store-pr-viewed"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-store-pr-viewed"),
        metadata: {},
        payload: {
          pullRequestId,
          viewerKey: "session:viewer-a",
          viewedAt,
        },
      });

      assert.equal(appended.type, "pull-request.viewed");
      if (appended.type !== "pull-request.viewed") {
        return;
      }
      assert.equal(DateTime.formatIso(appended.payload.viewedAt), DateTime.formatIso(viewedAt));

      const storedRows = yield* sql<{ readonly payloadJson: string }>`
        SELECT payload_json AS "payloadJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(
        JSON.parse(storedRows[0]?.payloadJson ?? "{}").viewedAt,
        DateTime.formatIso(viewedAt),
      );

      const replayed = yield* eventStore.readPage(appended.sequence - 1, 1);
      const replayedEvent = replayed.events[0];
      assert.equal(replayedEvent?.type, "pull-request.viewed");
      if (replayedEvent?.type === "pull-request.viewed") {
        assert.equal(
          DateTime.formatIso(replayedEvent.payload.viewedAt),
          DateTime.formatIso(viewedAt),
        );
      }
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.make("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.make("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.make("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(Schema.is(PersistenceDecodeError)(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );

  it.effect("replays settled lifecycle rows written by a newer Ryco build", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();
      const threadId = ThreadId.make("thread-settlement-compatibility");
      const maxSequenceRows = yield* sql<{ readonly maxSequence: number | null }>`
        SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
      `;
      const startSequence = maxSequenceRows[0]?.maxSequence ?? 0;

      const compatibilityEvents = [
        {
          eventId: EventId.make("evt-store-thread-settled"),
          type: "thread.settled",
          payload: { threadId, settledAt: now, updatedAt: now },
        },
        {
          eventId: EventId.make("evt-store-thread-unsettled"),
          type: "thread.unsettled",
          payload: { threadId, reason: "user", updatedAt: now },
        },
      ] as const satisfies ReadonlyArray<{
        readonly eventId: EventId;
        readonly type: "thread.settled" | "thread.unsettled";
        readonly payload: object;
      }>;
      for (const [index, event] of compatibilityEvents.entries()) {
        yield* sql`
          INSERT INTO orchestration_events (
            event_id,
            aggregate_kind,
            stream_id,
            stream_version,
            event_type,
            occurred_at,
            command_id,
            causation_event_id,
            correlation_id,
            actor_kind,
            payload_json,
            metadata_json
          )
          VALUES (
            ${event.eventId},
            ${"thread"},
            ${threadId},
            ${index},
            ${event.type},
            ${now},
            ${null},
            ${null},
            ${null},
            ${"server"},
            ${JSON.stringify(event.payload)},
            ${"{}"}
          )
        `;
      }

      const replayed = yield* Stream.runCollect(
        eventStore.readFromSequence(startSequence, 100),
      ).pipe(
        Effect.map((chunk) => Array.from(chunk).filter((event) => event.aggregateId === threadId)),
      );
      assert.deepEqual(
        replayed.map((event) => event.type),
        ["thread.settled", "thread.unsettled"],
      );
    }),
  );

  it.effect("reads bounded event pages with next sequence and hasMore metadata", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();
      const maxSequenceRows = yield* sql<{ readonly maxSequence: number | null }>`
        SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
      `;
      const startSequence = maxSequenceRows[0]?.maxSequence ?? 0;

      for (const index of [1, 2, 3]) {
        yield* eventStore.append({
          type: "project.created",
          eventId: EventId.make(`evt-store-page-${index}`),
          aggregateKind: "project",
          aggregateId: ProjectId.make(`project-page-${index}`),
          occurredAt: now,
          commandId: CommandId.make(`cmd-store-page-${index}`),
          causationEventId: null,
          correlationId: CommandId.make(`cmd-store-page-${index}`),
          metadata: {},
          payload: {
            projectId: ProjectId.make(`project-page-${index}`),
            title: `Paged Project ${index}`,
            workspaceRoot: `/tmp/project-page-${index}`,
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const firstPage = yield* eventStore.readPage(startSequence, 2);
      assert.deepEqual(
        firstPage.events.map((event) => event.sequence),
        [startSequence + 1, startSequence + 2],
      );
      assert.equal(firstPage.nextSequence, startSequence + 2);
      assert.equal(firstPage.hasMore, true);

      const secondPage = yield* eventStore.readPage(firstPage.nextSequence, 2);
      assert.deepEqual(
        secondPage.events.map((event) => event.sequence),
        [startSequence + 3],
      );
      assert.equal(secondPage.nextSequence, startSequence + 3);
      assert.equal(secondPage.hasMore, false);
    }),
  );
});

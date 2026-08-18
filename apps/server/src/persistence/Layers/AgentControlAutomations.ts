import {
  AGENT_CONTROL_AUTOMATION_MAX_ACTIVE_PER_PROJECT,
  AgentControlAutomation,
  AgentControlAutomationDefinition,
  AgentControlAutomationId,
  AgentControlAutomationRun,
  AgentControlAutomationRunId,
  AgentControlPrincipal,
  AgentControlProposalId,
  type IsoDateTime,
} from "@ryco/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type AgentControlAutomationRepositoryError,
} from "../Errors.ts";
import {
  AgentControlAutomationRepository,
  type AgentControlAutomationRepositoryShape,
  type ClaimedAgentControlAutomationRun,
} from "../Services/AgentControlAutomations.ts";

const AutomationDbRow = Schema.Struct({
  automationId: AgentControlAutomationId,
  principal: Schema.fromJsonString(AgentControlPrincipal),
  projectId: AgentControlAutomation.fields.projectId,
  providerInstanceId: AgentControlAutomation.fields.providerInstanceId,
  definition: Schema.fromJsonString(AgentControlAutomationDefinition),
  revision: AgentControlAutomation.fields.revision,
  enabled: Schema.Int,
  cancelled: Schema.Int,
  cancelledAt: AgentControlAutomation.fields.cancelledAt,
  nextRunAt: AgentControlAutomation.fields.nextRunAt,
  createdAt: AgentControlAutomation.fields.createdAt,
  updatedAt: AgentControlAutomation.fields.updatedAt,
});

const AutomationRunDbRow = AgentControlAutomationRun;
const toError =
  (sqlOperation: string, decodeOperation: string) =>
  (cause: unknown): AgentControlAutomationRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);

const toAutomation = (row: typeof AutomationDbRow.Type): AgentControlAutomation => ({
  ...row,
  enabled: row.enabled === 1,
  cancelled: row.cancelled === 1,
});

function nextOccurrence(
  automation: AgentControlAutomation,
  now: IsoDateTime,
): { readonly nextRunAt: IsoDateTime | null; readonly coalescedOccurrences: number } {
  const dueAt = automation.nextRunAt;
  if (dueAt === null || automation.definition.schedule.kind === "once") {
    return { nextRunAt: null, coalescedOccurrences: 0 };
  }
  const schedule = automation.definition.schedule;
  const dueMs = Date.parse(dueAt);
  const nowMs = Date.parse(now);
  const endsMs = Date.parse(schedule.endsAt);
  const coalescedOccurrences = Math.max(
    0,
    Math.floor((Math.min(nowMs, endsMs) - dueMs) / schedule.intervalMs),
  );
  const candidateMs = dueMs + (coalescedOccurrences + 1) * schedule.intervalMs;
  return {
    nextRunAt: candidateMs <= endsMs ? new Date(candidateMs).toISOString() : null,
    coalescedOccurrences,
  };
}

const makeAgentControlAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getAutomationRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ automationId: AgentControlAutomationId }),
    Result: AutomationDbRow,
    execute: ({ automationId }) => sql`
      SELECT automation_id AS "automationId", principal_json AS "principal",
        project_id AS "projectId", provider_instance_id AS "providerInstanceId",
        definition_json AS "definition", revision, enabled, cancelled,
        cancelled_at AS "cancelledAt", next_run_at AS "nextRunAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM agent_control_automations WHERE automation_id = ${automationId} LIMIT 1
    `,
  });

  const listAutomationRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: AgentControlAutomation.fields.projectId,
      providerInstanceId: Schema.NullOr(AgentControlAutomation.fields.providerInstanceId),
      includeDisabled: Schema.Int,
      limit: Schema.Int,
    }),
    Result: AutomationDbRow,
    execute: ({ projectId, providerInstanceId, includeDisabled, limit }) => sql`
      SELECT automation_id AS "automationId", principal_json AS "principal",
        project_id AS "projectId", provider_instance_id AS "providerInstanceId",
        definition_json AS "definition", revision, enabled, cancelled,
        cancelled_at AS "cancelledAt", next_run_at AS "nextRunAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM agent_control_automations
      WHERE project_id = ${projectId}
        AND (${providerInstanceId} IS NULL OR provider_instance_id = ${providerInstanceId})
        AND (${includeDisabled} = 1 OR (enabled = 1 AND cancelled = 0))
      ORDER BY updated_at DESC, automation_id ASC
      LIMIT ${limit}
    `,
  });

  const dueAutomationRows = SqlSchema.findAll({
    Request: Schema.Struct({ now: AgentControlAutomation.fields.updatedAt, limit: Schema.Int }),
    Result: AutomationDbRow,
    execute: ({ now, limit }) => sql`
      SELECT automation_id AS "automationId", principal_json AS "principal",
        project_id AS "projectId", provider_instance_id AS "providerInstanceId",
        definition_json AS "definition", revision, enabled, cancelled,
        cancelled_at AS "cancelledAt", next_run_at AS "nextRunAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM agent_control_automations AS automation
      WHERE enabled = 1 AND cancelled = 0 AND next_run_at IS NOT NULL AND next_run_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM agent_control_automation_runs AS run
          WHERE run.automation_id = automation.automation_id
            AND run.status IN ('materializing', 'pending-approval', 'approved', 'executing')
        )
      ORDER BY next_run_at ASC, automation_id ASC
      LIMIT ${limit}
    `,
  });

  const getRunRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ runId: AgentControlAutomationRunId }),
    Result: AutomationRunDbRow,
    execute: ({ runId }) => sql`
      SELECT run_id AS "runId", automation_id AS "automationId",
        automation_revision AS "automationRevision", project_id AS "projectId",
        provider_instance_id AS "providerInstanceId", scheduled_for AS "scheduledFor",
        coalesced_occurrences AS "coalescedOccurrences", status,
        proposal_id AS "proposalId", safe_failure_detail AS "safeFailureDetail",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM agent_control_automation_runs WHERE run_id = ${runId} LIMIT 1
    `,
  });

  const findRunByProposalRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ proposalId: AgentControlProposalId }),
    Result: AutomationRunDbRow,
    execute: ({ proposalId }) => sql`
      SELECT run_id AS "runId", automation_id AS "automationId",
        automation_revision AS "automationRevision", project_id AS "projectId",
        provider_instance_id AS "providerInstanceId", scheduled_for AS "scheduledFor",
        coalesced_occurrences AS "coalescedOccurrences", status,
        proposal_id AS "proposalId", safe_failure_detail AS "safeFailureDetail",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM agent_control_automation_runs WHERE proposal_id = ${proposalId} LIMIT 1
    `,
  });

  const listRunRows = SqlSchema.findAll({
    Request: Schema.Struct({ automationId: AgentControlAutomationId, limit: Schema.Int }),
    Result: AutomationRunDbRow,
    execute: ({ automationId, limit }) => sql`
      SELECT run_id AS "runId", automation_id AS "automationId",
        automation_revision AS "automationRevision", project_id AS "projectId",
        provider_instance_id AS "providerInstanceId", scheduled_for AS "scheduledFor",
        coalesced_occurrences AS "coalescedOccurrences", status,
        proposal_id AS "proposalId", safe_failure_detail AS "safeFailureDetail",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM agent_control_automation_runs WHERE automation_id = ${automationId}
      ORDER BY created_at DESC, run_id DESC LIMIT ${limit}
    `,
  });

  const recoverableRunRows = SqlSchema.findAll({
    Request: Schema.Struct({ limit: Schema.Int }),
    Result: AutomationRunDbRow,
    execute: ({ limit }) => sql`
      SELECT run_id AS "runId", automation_id AS "automationId",
        automation_revision AS "automationRevision", project_id AS "projectId",
        provider_instance_id AS "providerInstanceId", scheduled_for AS "scheduledFor",
        coalesced_occurrences AS "coalescedOccurrences", status,
        proposal_id AS "proposalId", safe_failure_detail AS "safeFailureDetail",
        created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
      FROM agent_control_automation_runs
      WHERE status IN ('materializing', 'pending-approval', 'approved', 'executing')
      ORDER BY updated_at ASC, run_id ASC LIMIT ${limit}
    `,
  });

  const insertAutomation: AgentControlAutomationRepositoryShape["insertAutomation"] = (
    automation,
  ) =>
    sql<{ readonly automationId: string }>`
      INSERT INTO agent_control_automations (
        automation_id, principal_json, project_id, provider_instance_id, definition_json,
        revision, enabled, cancelled, cancelled_at, next_run_at, created_at, updated_at
      ) SELECT
        ${automation.automationId}, ${JSON.stringify(automation.principal)}, ${automation.projectId},
        ${automation.providerInstanceId}, ${JSON.stringify(automation.definition)},
        ${automation.revision}, ${automation.enabled ? 1 : 0}, ${automation.cancelled ? 1 : 0},
        ${automation.cancelledAt}, ${automation.nextRunAt}, ${automation.createdAt}, ${automation.updatedAt}
      WHERE ${automation.enabled && !automation.cancelled && automation.nextRunAt !== null ? 1 : 0} = 0
        OR (
          SELECT COUNT(*) FROM agent_control_automations
          WHERE project_id = ${automation.projectId}
            AND enabled = 1 AND cancelled = 0 AND next_run_at IS NOT NULL
        ) < ${AGENT_CONTROL_AUTOMATION_MAX_ACTIVE_PER_PROJECT}
      ON CONFLICT DO NOTHING RETURNING automation_id AS "automationId"
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("AgentControlAutomationRepository.insertAutomation")),
    );

  const getAutomation: AgentControlAutomationRepositoryShape["getAutomation"] = (automationId) =>
    getAutomationRow({ automationId }).pipe(
      Effect.map(Option.map(toAutomation)),
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.getAutomation:query",
          "AgentControlAutomationRepository.getAutomation:decode",
        ),
      ),
    );

  const listAutomations: AgentControlAutomationRepositoryShape["listAutomations"] = (input) =>
    listAutomationRows({
      projectId: input.projectId,
      providerInstanceId: input.providerInstanceId ?? null,
      includeDisabled: input.includeDisabled ? 1 : 0,
      limit: Math.max(1, Math.floor(input.limit)),
    }).pipe(
      Effect.map((rows) => rows.map(toAutomation)),
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.listAutomations:query",
          "AgentControlAutomationRepository.listAutomations:decode",
        ),
      ),
    );

  const countActiveAutomations: AgentControlAutomationRepositoryShape["countActiveAutomations"] = (
    projectId,
  ) =>
    sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM agent_control_automations
        WHERE project_id = ${projectId} AND enabled = 1 AND cancelled = 0 AND next_run_at IS NOT NULL
      `.pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.mapError(
        toPersistenceSqlError("AgentControlAutomationRepository.countActiveAutomations"),
      ),
    );

  const replaceAutomation: AgentControlAutomationRepositoryShape["replaceAutomation"] = (input) =>
    sql<{ readonly automationId: string }>`
      UPDATE agent_control_automations SET
        principal_json = ${JSON.stringify(input.automation.principal)},
        project_id = ${input.automation.projectId},
        provider_instance_id = ${input.automation.providerInstanceId},
        definition_json = ${JSON.stringify(input.automation.definition)},
        revision = ${input.automation.revision}, enabled = ${input.automation.enabled ? 1 : 0},
        cancelled = ${input.automation.cancelled ? 1 : 0},
        cancelled_at = ${input.automation.cancelledAt}, next_run_at = ${input.automation.nextRunAt},
        updated_at = ${input.automation.updatedAt}
      WHERE automation_id = ${input.automation.automationId}
        AND revision = ${input.expectedRevision}
        AND cancelled = ${input.expectedCancelled ? 1 : 0}
        AND (
          ${input.automation.enabled && !input.automation.cancelled && input.automation.nextRunAt !== null ? 1 : 0} = 0
          OR (enabled = 1 AND cancelled = 0 AND next_run_at IS NOT NULL)
          OR (
            SELECT COUNT(*) FROM agent_control_automations
            WHERE project_id = ${input.automation.projectId}
              AND enabled = 1 AND cancelled = 0 AND next_run_at IS NOT NULL
          ) < ${AGENT_CONTROL_AUTOMATION_MAX_ACTIVE_PER_PROJECT}
        )
      RETURNING automation_id AS "automationId"
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("AgentControlAutomationRepository.replaceAutomation")),
    );

  const claimDue: AgentControlAutomationRepositoryShape["claimDue"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* dueAutomationRows({
            now: input.now,
            limit: Math.max(1, input.limit),
          });
          const claimed: ClaimedAgentControlAutomationRun[] = [];
          for (const row of rows) {
            const automation = toAutomation(row);
            if (automation.nextRunAt === null) continue;
            const occurrence = nextOccurrence(automation, input.now);
            const run: AgentControlAutomationRun = {
              runId: AgentControlAutomationRunId.make(crypto.randomUUID()),
              automationId: automation.automationId,
              automationRevision: automation.revision,
              projectId: automation.projectId,
              providerInstanceId: automation.providerInstanceId,
              scheduledFor: automation.nextRunAt,
              coalescedOccurrences: occurrence.coalescedOccurrences,
              status: "materializing",
              proposalId: null,
              safeFailureDetail: null,
              createdAt: input.now,
              updatedAt: input.now,
              completedAt: null,
            };
            const inserted = yield* sql<{ readonly runId: string }>`
            INSERT INTO agent_control_automation_runs (
              run_id, automation_id, automation_revision, project_id, provider_instance_id,
              scheduled_for, coalesced_occurrences, status, proposal_id, safe_failure_detail,
              created_at, updated_at, completed_at
            ) VALUES (
              ${run.runId}, ${run.automationId}, ${run.automationRevision}, ${run.projectId},
              ${run.providerInstanceId}, ${run.scheduledFor}, ${run.coalescedOccurrences},
              ${run.status}, NULL, NULL, ${run.createdAt}, ${run.updatedAt}, NULL
            ) ON CONFLICT DO NOTHING RETURNING run_id AS "runId"
          `;
            if (inserted.length !== 1) continue;
            yield* sql`
            UPDATE agent_control_automations
            SET next_run_at = ${occurrence.nextRunAt}, enabled = ${occurrence.nextRunAt === null ? 0 : 1}
            WHERE automation_id = ${automation.automationId} AND revision = ${automation.revision}
          `;
            claimed.push({
              automation: {
                ...automation,
                nextRunAt: occurrence.nextRunAt,
                enabled: occurrence.nextRunAt !== null,
              },
              run,
            });
          }
          return claimed;
        }),
      )
      .pipe(
        Effect.mapError(
          toError(
            "AgentControlAutomationRepository.claimDue:transaction",
            "AgentControlAutomationRepository.claimDue:decode",
          ),
        ),
      );

  const attachProposal: AgentControlAutomationRepositoryShape["attachProposal"] = (input) =>
    sql<{ readonly runId: string }>`
      UPDATE agent_control_automation_runs
      SET proposal_id = ${input.proposalId}, status = 'pending-approval', updated_at = ${input.updatedAt}
      WHERE run_id = ${input.runId} AND status = 'materializing' AND proposal_id IS NULL
      RETURNING run_id AS "runId"
    `.pipe(
      Effect.map((rows) => rows.length === 1),
      Effect.mapError(toPersistenceSqlError("AgentControlAutomationRepository.attachProposal")),
    );

  const getRun: AgentControlAutomationRepositoryShape["getRun"] = (runId) =>
    getRunRow({ runId }).pipe(
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.getRun:query",
          "AgentControlAutomationRepository.getRun:decode",
        ),
      ),
    );

  const findRunByProposal: AgentControlAutomationRepositoryShape["findRunByProposal"] = (
    proposalId,
  ) =>
    findRunByProposalRow({ proposalId }).pipe(
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.findRunByProposal:query",
          "AgentControlAutomationRepository.findRunByProposal:decode",
        ),
      ),
    );

  const listRuns: AgentControlAutomationRepositoryShape["listRuns"] = (input) =>
    listRunRows({ automationId: input.automationId, limit: Math.max(1, input.limit) }).pipe(
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.listRuns:query",
          "AgentControlAutomationRepository.listRuns:decode",
        ),
      ),
    );

  const listRecoverableRuns: AgentControlAutomationRepositoryShape["listRecoverableRuns"] = (
    input,
  ) =>
    recoverableRunRows({ limit: Math.max(1, input.limit) }).pipe(
      Effect.mapError(
        toError(
          "AgentControlAutomationRepository.listRecoverableRuns:query",
          "AgentControlAutomationRepository.listRecoverableRuns:decode",
        ),
      ),
    );

  const transitionRun: AgentControlAutomationRepositoryShape["transitionRun"] = (input) =>
    Effect.gen(function* () {
      for (const expectedStatus of input.expectedStatuses) {
        const rows = yield* sql<{ readonly runId: string }>`
          UPDATE agent_control_automation_runs SET
            status = ${input.status}, proposal_id = ${input.proposalId},
            safe_failure_detail = ${input.safeFailureDetail}, updated_at = ${input.updatedAt},
            completed_at = ${input.completedAt}
          WHERE run_id = ${input.runId} AND status = ${expectedStatus}
          RETURNING run_id AS "runId"
        `;
        if (rows.length === 1) return true;
      }
      return false;
    }).pipe(
      Effect.mapError(toPersistenceSqlError("AgentControlAutomationRepository.transitionRun")),
    );

  const pruneRuns: AgentControlAutomationRepositoryShape["pruneRuns"] = (input) =>
    sql`
      DELETE FROM agent_control_automation_runs
      WHERE automation_id = ${input.automationId}
        AND status NOT IN ('materializing', 'pending-approval', 'approved', 'executing')
        AND run_id NOT IN (
          SELECT run_id FROM agent_control_automation_runs
          WHERE automation_id = ${input.automationId}
          ORDER BY created_at DESC, run_id DESC LIMIT ${Math.max(1, input.keepNewest)}
        )
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("AgentControlAutomationRepository.pruneRuns")),
    );

  return {
    insertAutomation,
    getAutomation,
    listAutomations,
    countActiveAutomations,
    replaceAutomation,
    claimDue,
    attachProposal,
    getRun,
    findRunByProposal,
    listRuns,
    listRecoverableRuns,
    transitionRun,
    pruneRuns,
  } satisfies AgentControlAutomationRepositoryShape;
});

export const AgentControlAutomationRepositoryLive = Layer.effect(
  AgentControlAutomationRepository,
  makeAgentControlAutomationRepository,
);

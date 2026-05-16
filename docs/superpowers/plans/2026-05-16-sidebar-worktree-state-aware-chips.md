# Sidebar Worktree State-Aware Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the linked-issue and linked-PR chips on each sidebar worktree row reflect the current lifecycle state of the artifact (issue open/closed; PR draft/open/merged/closed), hide the chat-activity dot when the worktree is idle, and dedupe the redundant `"PR"`/`"Issue"` origin label.

**Architecture:** Add three nullable state fields to the `Worktree` contract and the `projection_worktrees` table, refresh them via a single server-side helper that is invoked at four activity points (link time, detail fetch, thread-turn-finished, app start), and propagate changes through a new `WorktreeSourceControlStateUpdatedPayload` domain event. Front-end consumes the new fields via a compact variant of the existing `StateBadge` icon/color vocabulary, sharing a variant map between the sidebar chip and `projectExplorer/StateBadge.tsx` so the two surfaces can't drift.

**Tech Stack:** Effect Schema (contracts), SQLite migrations via `effect/unstable/sql/Migrator`, Vitest, React 18 + Tailwind (lucide-react icons), WebSocket push for domain events.

**Spec:** `docs/superpowers/specs/2026-05-16-sidebar-worktree-state-aware-chips-design.md`

---

## File Structure

### New files

- `apps/web/src/components/sourceControl/stateBadgeVariants.ts` — single source of truth for `(kind, state) → {icon, classes, label}`. Both the existing `StateBadge` and the new compact sidebar chip read from this map.
- `apps/web/src/components/sourceControl/stateBadgeVariants.test.ts` — exhaustive test for every variant combination, including the `unknown`/fallback case.
- `apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.ts` (+ `.test.ts`) — adds `pr_state`, `pr_is_draft`, `issue_state` columns.
- `apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts` (+ `.test.ts`) — shared helper invoked by all four refresh sources.

### Modified files

- `packages/contracts/src/worktree.ts` — adds `PullRequestState`, `IssueState`, and three new optional fields on `Worktree`.
- `packages/contracts/src/orchestration.ts` — adds `WorktreeSourceControlStateUpdatedPayload`.
- `apps/server/src/persistence/Services/ProjectionWorktrees.ts` — repository service interface (no change; the schema change in `worktree.ts` flows through `ProjectionWorktree = Worktree`).
- `apps/server/src/persistence/Layers/ProjectionWorktrees.ts` — SQL `INSERT`/`UPDATE`/`SELECT` includes new columns.
- `apps/server/src/persistence/Layers/ProjectionWorktrees.test.ts` — round-trip test for new columns.
- `apps/server/src/orchestration/decider.ts` — emits `WorktreeSourceControlStateUpdatedPayload` from a new command.
- `apps/server/src/orchestration/projector.ts` and `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — handle the new payload by updating the projection row.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — `SELECT` includes new columns.
- `apps/server/src/sourceControl/GitHubSourceControlProvider.ts` — captures `state` / `isDraft` at link time when creating a PR or issue worktree.
- `apps/server/src/sourceControl/SourceControlProvider.ts` — adds a `getIssueState` / `getPullRequestState` lookup the helper can call (or refines existing methods to ensure state is surfaced).
- `apps/server/src/ws.ts` — RPC handlers that back `PullRequestDetail` / `IssueDetail` call the refresh helper after a successful detail fetch.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — calls the refresh helper after a thread turn finishes on a worktree with linked PR/issue.
- `apps/web/src/components/sidebar/hooks/useSidebarTree.ts` — `SidebarWorktree` carries the new fields; `composeSidebarTree` and `mergeWorktree` propagate them.
- `apps/web/src/components/sidebar/SidebarWorktreeList.tsx` — chip uses the variant map; idle dot suppressed; origin label deduped.
- `apps/web/src/components/sidebar/SidebarWorktreeList.browser.tsx` — snapshot fixtures for every variant.
- `apps/web/src/components/projectExplorer/StateBadge.tsx` — consumes the shared variant map instead of declaring its own.

---

## Task 1: Shared variant map

**Files:**
- Create: `apps/web/src/components/sourceControl/stateBadgeVariants.ts`
- Create: `apps/web/src/components/sourceControl/stateBadgeVariants.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/sourceControl/stateBadgeVariants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CheckCircle2Icon, CircleDotIcon, GitMergeIcon, GitPullRequestDraftIcon, GitPullRequestIcon, XCircleIcon } from "lucide-react";
import { resolveStateBadgeVariant } from "./stateBadgeVariants";

describe("resolveStateBadgeVariant", () => {
  it("returns issue-open for an open issue", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: "open" });
    expect(variant.kind).toBe("issue-open");
    expect(variant.Icon).toBe(CircleDotIcon);
    expect(variant.label).toBe("Open");
    expect(variant.tone).toBe("emerald");
  });

  it("returns issue-closed for a closed issue", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: "closed" });
    expect(variant.kind).toBe("issue-closed");
    expect(variant.Icon).toBe(CheckCircle2Icon);
    expect(variant.tone).toBe("violet");
  });

  it("returns pr-draft when isDraft is true regardless of state", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: true });
    expect(variant.kind).toBe("pr-draft");
    expect(variant.Icon).toBe(GitPullRequestDraftIcon);
    expect(variant.tone).toBe("zinc");
  });

  it("returns pr-open for a non-draft open PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: false });
    expect(variant.kind).toBe("pr-open");
    expect(variant.Icon).toBe(GitPullRequestIcon);
    expect(variant.tone).toBe("emerald");
  });

  it("returns pr-merged for a merged PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "merged" });
    expect(variant.kind).toBe("pr-merged");
    expect(variant.Icon).toBe(GitMergeIcon);
    expect(variant.tone).toBe("violet");
  });

  it("returns pr-closed for a closed unmerged PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "closed" });
    expect(variant.kind).toBe("pr-closed");
    expect(variant.Icon).toBe(XCircleIcon);
    expect(variant.tone).toBe("rose");
  });

  it("returns unknown-issue fallback for issue with null state", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: null });
    expect(variant.kind).toBe("issue-unknown");
    expect(variant.Icon).toBe(CircleDotIcon);
    expect(variant.tone).toBe("emerald");
    expect(variant.label).toBeNull();
  });

  it("returns unknown-pr fallback for pr with null state", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: null });
    expect(variant.kind).toBe("pr-unknown");
    expect(variant.Icon).toBe(GitPullRequestIcon);
    expect(variant.tone).toBe("blue");
    expect(variant.label).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run vitest run src/components/sourceControl/stateBadgeVariants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/web/src/components/sourceControl/stateBadgeVariants.ts`:

```ts
import {
  CheckCircle2Icon,
  CircleDotIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

export type StateBadgeKind =
  | "issue-open"
  | "issue-closed"
  | "issue-unknown"
  | "pr-open"
  | "pr-draft"
  | "pr-merged"
  | "pr-closed"
  | "pr-unknown";

export type StateBadgeTone = "emerald" | "violet" | "zinc" | "rose" | "blue";

export interface StateBadgeVariant {
  readonly kind: StateBadgeKind;
  readonly Icon: LucideIcon;
  readonly tone: StateBadgeTone;
  /** Human-readable state label, or `null` when state is unknown. */
  readonly label: string | null;
  /** Tailwind classes for the bigger pill style (`StateBadge`). */
  readonly badgeClassName: string;
  /** Tailwind classes for the compact sidebar chip. */
  readonly compactClassName: string;
}

const tones: Record<StateBadgeTone, { badge: string; compact: string }> = {
  emerald: {
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    compact: "border-emerald-500/16 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  },
  violet: {
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    compact: "border-violet-500/16 bg-violet-500/10 text-violet-500 dark:text-violet-400",
  },
  zinc: {
    badge: "bg-zinc-500/14 text-zinc-700 dark:text-zinc-300",
    compact: "border-zinc-500/16 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  rose: {
    badge: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
    compact: "border-rose-500/16 bg-rose-500/10 text-rose-500 dark:text-rose-400",
  },
  blue: {
    badge: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
    compact: "border-blue-500/16 bg-blue-500/10 text-blue-500 dark:text-blue-400",
  },
};

export interface ResolveStateBadgeVariantInput {
  readonly kind: "issue" | "pr";
  readonly state: "open" | "closed" | "merged" | null;
  readonly isDraft?: boolean | null;
}

export function resolveStateBadgeVariant(input: ResolveStateBadgeVariantInput): StateBadgeVariant {
  if (input.kind === "issue") {
    if (input.state === "closed") {
      return variant("issue-closed", CheckCircle2Icon, "violet", "Closed");
    }
    if (input.state === "open") {
      return variant("issue-open", CircleDotIcon, "emerald", "Open");
    }
    return variant("issue-unknown", CircleDotIcon, "emerald", null);
  }
  // pr
  if (input.state === "merged") {
    return variant("pr-merged", GitMergeIcon, "violet", "Merged");
  }
  if (input.state === "closed") {
    return variant("pr-closed", XCircleIcon, "rose", "Closed");
  }
  if (input.state === "open") {
    if (input.isDraft) {
      return variant("pr-draft", GitPullRequestDraftIcon, "zinc", "Draft");
    }
    return variant("pr-open", GitPullRequestIcon, "emerald", "Open");
  }
  return variant("pr-unknown", GitPullRequestIcon, "blue", null);
}

function variant(
  kind: StateBadgeKind,
  Icon: LucideIcon,
  tone: StateBadgeTone,
  label: string | null,
): StateBadgeVariant {
  return {
    kind,
    Icon,
    tone,
    label,
    badgeClassName: tones[tone].badge,
    compactClassName: tones[tone].compact,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bun run vitest run src/components/sourceControl/stateBadgeVariants.test.ts`
Expected: PASS — all 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sourceControl/stateBadgeVariants.ts apps/web/src/components/sourceControl/stateBadgeVariants.test.ts
git commit -m "Add shared state badge variant resolver"
```

---

## Task 2: Refactor StateBadge to consume the shared variant map

**Files:**
- Modify: `apps/web/src/components/projectExplorer/StateBadge.tsx`

The existing `StateBadge` declares its own variants map and a `changeRequestStateKind` helper. After this task it consumes the shared resolver. No callers change.

- [ ] **Step 1: Read existing callers**

Run: `grep -rn "changeRequestStateKind\|StateBadgeKind\|StateBadge " apps/web/src --include='*.tsx' --include='*.ts'`
Expected: Calls in `IssueList.tsx`, `IssueDetail.tsx`, `PullRequestDetail.tsx`, `WorkItemDetail.tsx`, etc. — all pass a literal `StateBadgeKind` to `<StateBadge kind=... />`.

- [ ] **Step 2: Rewrite StateBadge**

`apps/web/src/components/projectExplorer/StateBadge.tsx`:

```tsx
import { memo } from "react";
import { cn } from "~/lib/utils";
import {
  resolveStateBadgeVariant,
  type StateBadgeKind,
} from "../sourceControl/stateBadgeVariants";

export type { StateBadgeKind } from "../sourceControl/stateBadgeVariants";

export const StateBadge = memo(function StateBadge(props: {
  kind: StateBadgeKind;
  className?: string;
}) {
  const variant = variantByKind(props.kind);
  const Icon = variant.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
        variant.badgeClassName,
        props.className,
      )}
    >
      <Icon className="size-3" />
      {variant.label ?? labelFallback(props.kind)}
    </span>
  );
});

function variantByKind(kind: StateBadgeKind) {
  switch (kind) {
    case "issue-open":
      return resolveStateBadgeVariant({ kind: "issue", state: "open" });
    case "issue-closed":
      return resolveStateBadgeVariant({ kind: "issue", state: "closed" });
    case "issue-unknown":
      return resolveStateBadgeVariant({ kind: "issue", state: null });
    case "pr-open":
      return resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: false });
    case "pr-draft":
      return resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: true });
    case "pr-merged":
      return resolveStateBadgeVariant({ kind: "pr", state: "merged" });
    case "pr-closed":
      return resolveStateBadgeVariant({ kind: "pr", state: "closed" });
    case "pr-unknown":
      return resolveStateBadgeVariant({ kind: "pr", state: null });
  }
}

function labelFallback(kind: StateBadgeKind): string {
  return kind.startsWith("issue") ? "Issue" : "PR";
}

export function changeRequestStateKind(
  state: "open" | "closed" | "merged",
  isDraft?: boolean,
): StateBadgeKind {
  if (state === "merged") return "pr-merged";
  if (state === "closed") return "pr-closed";
  return isDraft ? "pr-draft" : "pr-open";
}
```

- [ ] **Step 3: Verify no caller broke**

Run: `cd apps/web && bun run vitest run` (or scope to `projectExplorer/`)
Then: `bun typecheck`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/projectExplorer/StateBadge.tsx
git commit -m "Refactor StateBadge to consume shared variant resolver"
```

---

## Task 3: Extend the Worktree contract with state fields

**Files:**
- Modify: `packages/contracts/src/worktree.ts`

- [ ] **Step 1: Add the new schemas**

Edit `packages/contracts/src/worktree.ts`. Add the two state schemas after `WorktreeOrigin`:

```ts
export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;
```

Then extend the `Worktree` struct with three nullable fields, right after `issueTitle`:

```ts
export const Worktree = Schema.Struct({
  // ...existing fields up through issueTitle...
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
  // ...remaining existing fields (createdAt onwards)...
});
```

- [ ] **Step 2: Typecheck contracts**

Run: `bun typecheck`
Expected: a list of TS errors in server and web where `Worktree` is constructed without the new fields. **These are the call sites we need to patch in later tasks.** Note the file list — you'll touch them in Tasks 4–7.

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/worktree.ts
git commit -m "Extend Worktree contract with PR/issue state fields"
```

(Intermediate state will not typecheck until Tasks 4–7 land. That's expected — each task fixes its slice and `bun typecheck` becomes clean again at Task 7.)

---

## Task 4: Migration 037 — add columns to projection_worktrees

**Files:**
- Create: `apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.ts`
- Create: `apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.test.ts`
- Modify: `apps/server/src/persistence/Migrations.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.test.ts`:

```ts
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("037_WorktreeSourceControlState", (it) => {
  it.effect("adds pr_state, pr_is_draft, and issue_state columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 37 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_worktrees)
      `;
      const names = columns.map((column) => column.name);
      assert.include(names, "pr_state");
      assert.include(names, "pr_is_draft");
      assert.include(names, "issue_state");
    }),
  );

  it.effect("is idempotent — running twice does not error", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 37 });
      yield* runMigrations({ toMigrationInclusive: 37 });
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run vitest run src/persistence/Migrations/037_WorktreeSourceControlState.test.ts`
Expected: FAIL — migration not registered yet (or columns missing).

- [ ] **Step 3: Write the migration**

`apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.ts`:

```ts
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_worktrees)
  `;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("pr_state")) {
    yield* sql`ALTER TABLE projection_worktrees ADD COLUMN pr_state TEXT`;
  }
  if (!names.has("pr_is_draft")) {
    yield* sql`ALTER TABLE projection_worktrees ADD COLUMN pr_is_draft INTEGER`;
  }
  if (!names.has("issue_state")) {
    yield* sql`ALTER TABLE projection_worktrees ADD COLUMN issue_state TEXT`;
  }
});
```

- [ ] **Step 4: Register the migration**

Edit `apps/server/src/persistence/Migrations.ts`:

Add the import after `Migration0036`:
```ts
import Migration0037 from "./Migrations/037_WorktreeSourceControlState.ts";
```

Append to `migrationEntries`:
```ts
[37, "WorktreeSourceControlState", Migration0037],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && bun run vitest run src/persistence/Migrations/037_WorktreeSourceControlState.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.ts apps/server/src/persistence/Migrations/037_WorktreeSourceControlState.test.ts apps/server/src/persistence/Migrations.ts
git commit -m "Add migration 037 for worktree source-control state columns"
```

---

## Task 5: ProjectionWorktree SQL reads/writes new columns

**Files:**
- Modify: `apps/server/src/persistence/Layers/ProjectionWorktrees.ts`
- Modify: `apps/server/src/persistence/Layers/ProjectionWorktrees.test.ts`

The repository's `INSERT … ON CONFLICT DO UPDATE`, `getById`, and `listByProjectId` SQL must read and write `pr_state`, `pr_is_draft`, `issue_state`. Booleans are stored as `0|1` integers in SQLite.

- [ ] **Step 1: Add a failing round-trip test**

Append to `apps/server/src/persistence/Layers/ProjectionWorktrees.test.ts` (or replicate an existing test as a template):

```ts
it.effect("round-trips pr_state, pr_is_draft, issue_state", () =>
  Effect.gen(function* () {
    const repo = yield* ProjectionWorktreeRepository;
    const projectId = makeProjectId("proj");
    const worktree: ProjectionWorktree = {
      worktreeId: makeWorktreeId("w-1"),
      projectId,
      title: "Feature 1",
      branch: "feature/1",
      worktreePath: "/tmp/feature-1",
      origin: "pr",
      prNumber: 123,
      issueNumber: 7,
      prTitle: "Feature 1 PR",
      issueTitle: "Feature 1 issue",
      prState: "merged",
      prIsDraft: false,
      issueState: "closed",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      manualPosition: 0,
    };

    yield* repo.upsert(worktree);
    const round = yield* repo.getById({ worktreeId: worktree.worktreeId });
    assert.isTrue(Option.isSome(round));
    if (Option.isSome(round)) {
      assert.equal(round.value.prState, "merged");
      assert.equal(round.value.prIsDraft, false);
      assert.equal(round.value.issueState, "closed");
    }
  }),
);
```

(`makeProjectId`, `makeWorktreeId`, `nowIso` are helpers already used in this test file — reuse them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run vitest run src/persistence/Layers/ProjectionWorktrees.test.ts`
Expected: FAIL — new fields not persisted.

- [ ] **Step 3: Update upsert SQL**

In `apps/server/src/persistence/Layers/ProjectionWorktrees.ts`, locate `upsertProjectionWorktreeRow` and update the `INSERT` / `ON CONFLICT` clauses to include the three new columns:

```ts
const upsertProjectionWorktreeRow = SqlSchema.void({
  Request: ProjectionWorktree,
  execute: (row) =>
    sql`
      INSERT INTO projection_worktrees (
        worktree_id, project_id, title, branch, worktree_path, origin,
        pr_number, issue_number, pr_title, issue_title,
        pr_state, pr_is_draft, issue_state,
        created_at, updated_at, archived_at, manual_position
      )
      VALUES (
        ${row.worktreeId}, ${row.projectId}, ${row.title ?? null}, ${row.branch},
        ${row.worktreePath}, ${row.origin}, ${row.prNumber}, ${row.issueNumber},
        ${row.prTitle}, ${row.issueTitle},
        ${row.prState}, ${row.prIsDraft === null ? null : row.prIsDraft ? 1 : 0},
        ${row.issueState},
        ${row.createdAt}, ${row.updatedAt}, ${row.archivedAt}, ${row.manualPosition}
      )
      ON CONFLICT (worktree_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        origin = excluded.origin,
        pr_number = excluded.pr_number,
        issue_number = excluded.issue_number,
        pr_title = excluded.pr_title,
        issue_title = excluded.issue_title,
        pr_state = excluded.pr_state,
        pr_is_draft = excluded.pr_is_draft,
        issue_state = excluded.issue_state,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        manual_position = excluded.manual_position
    `,
});
```

- [ ] **Step 4: Update SELECT projections**

In the same file, update `getProjectionWorktreeRow` and `listProjectionWorktreeRows` SELECT lists to include:

```sql
pr_state AS "prState",
CASE pr_is_draft WHEN 1 THEN 1 WHEN 0 THEN 0 ELSE NULL END AS "prIsDraft",
issue_state AS "issueState",
```

Place those rows alongside the existing `pr_title`/`issue_title` projections.

Note: SQLite returns the integer as a number; the `Schema.NullOr(Schema.Boolean)` decoder accepts `null` / `true` / `false`. If decoding fails, transform the integer via `SqlSchema.transform` or coerce in the SELECT to `pr_is_draft = 1` (yielding 0/1) — verify behavior in test.

- [ ] **Step 5: Run tests to verify it passes**

Run: `cd apps/server && bun run vitest run src/persistence/Layers/ProjectionWorktrees.test.ts`
Expected: PASS — round-trip test green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/Layers/ProjectionWorktrees.ts apps/server/src/persistence/Layers/ProjectionWorktrees.test.ts
git commit -m "Persist worktree source-control state in projection rows"
```

---

## Task 6: Add WorktreeSourceControlStateUpdated event and projector handling

**Files:**
- Modify: `packages/contracts/src/orchestration.ts`
- Modify: `apps/server/src/orchestration/projector.ts`
- Modify: `apps/server/src/orchestration/decider.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- Modify: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`

- [ ] **Step 1: Add the schema**

In `packages/contracts/src/orchestration.ts`, near `WorktreeMetaUpdatedPayload`:

```ts
import { PullRequestState, IssueState } from "./worktree.ts"; // adjust import if file already imports from worktree.ts

export const WorktreeSourceControlStateUpdatedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
  updatedAt: IsoDateTime,
});
export type WorktreeSourceControlStateUpdatedPayload =
  typeof WorktreeSourceControlStateUpdatedPayload.Type;
```

Register it wherever the union of orchestration payloads / event kinds is defined (search for `WorktreeMetaUpdated` to find the registration list — add the new entry alongside).

- [ ] **Step 2: Add a decider command**

In `apps/server/src/orchestration/decider.ts`, search for `WorktreeMetaUpdatedPayload` and replicate the same wiring for `WorktreeSourceControlStateUpdated`. The new command path takes `(worktreeId, prState, prIsDraft, issueState)`, emits the event with `updatedAt: now`, and is idempotent if the values match what's already projected.

- [ ] **Step 3: Update projector**

In `apps/server/src/orchestration/projector.ts`, find the `WorktreeMetaUpdated` handler (around the `prTitle`/`issueTitle` upsert) and add a sibling `WorktreeSourceControlStateUpdated` handler that calls `ProjectionWorktreeRepository.upsert` with the merged row (existing row + new state fields). If the worktree row is missing, log and skip.

- [ ] **Step 4: Update ProjectionPipeline.ts**

In `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`, around line 851 where `WorktreeMetaUpdated` is processed, add the equivalent reducer for `WorktreeSourceControlStateUpdated`:

```ts
case "WorktreeSourceControlStateUpdated": {
  yield* repo.upsert({
    ...existing,
    prState: event.payload.prState,
    prIsDraft: event.payload.prIsDraft,
    issueState: event.payload.issueState,
    updatedAt: event.payload.updatedAt,
  });
  break;
}
```

(Match the surrounding pattern — the exact name of `existing` / `repo` will be visible in the file.)

- [ ] **Step 5: Update ProjectionSnapshotQuery.ts**

In `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` (around lines 362, 387 where `pr_title` / `issue_title` are surfaced) add to both SELECT lists:

```sql
pr_state AS "prState",
CASE pr_is_draft WHEN 1 THEN 1 WHEN 0 THEN 0 ELSE NULL END AS "prIsDraft",
issue_state AS "issueState",
```

- [ ] **Step 6: Run server tests**

Run: `cd apps/server && bun run vitest run`
Expected: existing orchestration projector/pipeline tests pass; if any fixture constructs a `Worktree` literal without the new nullable fields, set them to `null` to satisfy the schema. Search results from Task 3 list every such site.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/orchestration.ts apps/server/src/orchestration/
git commit -m "Add WorktreeSourceControlStateUpdated event + projector handling"
```

---

## Task 7: Server-side refresh helper

**Files:**
- Create: `apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts`
- Create: `apps/server/src/sourceControl/refreshWorktreeSourceControlState.test.ts`

The helper is the single funnel for all four refresh sources. Reads the projection row for `(prNumber, issueNumber)`, asks the source control provider for current state, and dispatches the decider command if anything changed.

- [ ] **Step 1: Write the failing test**

`apps/server/src/sourceControl/refreshWorktreeSourceControlState.test.ts`:

```ts
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { refreshWorktreeSourceControlState } from "./refreshWorktreeSourceControlState.ts";
// import test-layer helpers / fakes from existing tests (e.g. fake SourceControlProvider, in-memory ProjectionWorktreeRepository, fake CommandDispatcher)

const layer = it.layer(/* compose your fakes here */);

layer("refreshWorktreeSourceControlState", (it) => {
  it.effect("emits an event when state changed", () =>
    Effect.gen(function* () {
      // seed projection row with prNumber=10, prState=null
      // fake provider returns { state: "merged", isDraft: false }
      yield* refreshWorktreeSourceControlState({ worktreeId: makeWorktreeId("w-1") });

      const events = yield* /* recorded events from fake dispatcher */;
      assert.equal(events.length, 1);
      assert.equal(events[0].kind, "WorktreeSourceControlStateUpdated");
      assert.equal(events[0].payload.prState, "merged");
    }),
  );

  it.effect("is a no-op when state matches the projection", () =>
    Effect.gen(function* () {
      // seed projection with prState="open", prIsDraft=false
      // fake provider returns { state: "open", isDraft: false }
      yield* refreshWorktreeSourceControlState({ worktreeId: makeWorktreeId("w-1") });

      const events = yield* /* recorded events */;
      assert.equal(events.length, 0);
    }),
  );

  it.effect("swallows provider errors and logs", () =>
    Effect.gen(function* () {
      // fake provider returns Effect.fail(...)
      const result = yield* Effect.either(
        refreshWorktreeSourceControlState({ worktreeId: makeWorktreeId("w-err") }),
      );
      assert.isTrue(result._tag === "Right"); // helper returns void successfully
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run vitest run src/sourceControl/refreshWorktreeSourceControlState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts`:

```ts
import { Effect, Option } from "effect";
import type { WorktreeId, PullRequestState, IssueState } from "@ryco/contracts";
import { ProjectionWorktreeRepository } from "../persistence/Services/ProjectionWorktrees.ts";
import { SourceControlProviderRegistry } from "./SourceControlProviderRegistry.ts";
import { OrchestrationCommandDispatcher } from "../orchestration/Services/CommandDispatcher.ts"; // adjust to actual symbol
import { IsoDateTime } from "@ryco/contracts";

export interface RefreshWorktreeSourceControlStateInput {
  readonly worktreeId: WorktreeId;
}

export const refreshWorktreeSourceControlState = Effect.fn("refreshWorktreeSourceControlState")(
  function* (input: RefreshWorktreeSourceControlStateInput) {
    const repo = yield* ProjectionWorktreeRepository;
    const row = yield* repo.getById({ worktreeId: input.worktreeId });
    if (Option.isNone(row)) {
      return;
    }
    const existing = row.value;
    if (existing.prNumber === null && existing.issueNumber === null) {
      return;
    }

    const registry = yield* SourceControlProviderRegistry;
    const provider = yield* registry.providerForProject({ projectId: existing.projectId });

    const nextPr = existing.prNumber !== null
      ? yield* provider.getPullRequestState({ number: existing.prNumber }).pipe(
          Effect.catchAll((cause) =>
            Effect.logWarning("Failed to refresh PR state", { cause }).pipe(
              Effect.as(Option.none<{ state: PullRequestState; isDraft: boolean }>()),
            ),
          ),
        )
      : Option.none<{ state: PullRequestState; isDraft: boolean }>();

    const nextIssue = existing.issueNumber !== null
      ? yield* provider.getIssueState({ number: existing.issueNumber }).pipe(
          Effect.catchAll((cause) =>
            Effect.logWarning("Failed to refresh issue state", { cause }).pipe(
              Effect.as(Option.none<{ state: IssueState }>()),
            ),
          ),
        )
      : Option.none<{ state: IssueState }>();

    const nextPrState = Option.isSome(nextPr) ? nextPr.value.state : existing.prState;
    const nextPrIsDraft = Option.isSome(nextPr) ? nextPr.value.isDraft : existing.prIsDraft;
    const nextIssueState = Option.isSome(nextIssue) ? nextIssue.value.state : existing.issueState;

    const changed =
      nextPrState !== existing.prState ||
      nextPrIsDraft !== existing.prIsDraft ||
      nextIssueState !== existing.issueState;
    if (!changed) {
      return;
    }

    const dispatcher = yield* OrchestrationCommandDispatcher;
    yield* dispatcher.dispatch({
      kind: "WorktreeSourceControlStateUpdated",
      payload: {
        worktreeId: input.worktreeId,
        prState: nextPrState,
        prIsDraft: nextPrIsDraft,
        issueState: nextIssueState,
        updatedAt: IsoDateTime.make(new Date().toISOString()),
      },
    });
  },
);
```

**Adapt names to the codebase:** the exact dispatcher service symbol may be named differently (`CommandReceiver`, `CommandService`, etc.). Search for how `WorktreeMetaUpdated` is dispatched today and mirror that — the helper must use the same path so it benefits from the existing event-log + websocket plumbing.

`provider.getPullRequestState` / `provider.getIssueState` are new methods you add to `SourceControlProviderShape` in `apps/server/src/sourceControl/SourceControlProvider.ts`:

```ts
readonly getPullRequestState: (input: {
  readonly number: number;
}) => Effect.Effect<{ state: PullRequestState; isDraft: boolean }, SourceControlError>;

readonly getIssueState: (input: {
  readonly number: number;
}) => Effect.Effect<{ state: IssueState }, SourceControlError>;
```

Implement them on `GitHubSourceControlProvider` (delegates to `GitHubCliShape.getPullRequest` / `getIssue`, mapping the response). Stub them on the other providers with `Effect.die("not implemented")` for now (they are guarded by the registry; only GitHub-backed projects will ever call them in v1).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run vitest run src/sourceControl/refreshWorktreeSourceControlState.test.ts`
Expected: PASS — three cases green.

- [ ] **Step 5: Typecheck the workspace**

Run: `bun typecheck`
Expected: clean. Any remaining errors from Task 3 should be resolved by the new `null` defaults the projector now writes.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sourceControl/refreshWorktreeSourceControlState.ts apps/server/src/sourceControl/refreshWorktreeSourceControlState.test.ts apps/server/src/sourceControl/SourceControlProvider.ts apps/server/src/sourceControl/GitHubSourceControlProvider.ts apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts apps/server/src/sourceControl/BitbucketSourceControlProvider.ts apps/server/src/sourceControl/ForgejoSourceControlProvider.ts apps/server/src/sourceControl/GitLabSourceControlProvider.ts
git commit -m "Add refreshWorktreeSourceControlState helper + provider methods"
```

---

## Task 8: Refresh source 1 — at link time

**Files:**
- Modify: `apps/server/src/sourceControl/GitHubSourceControlProvider.ts`

When a worktree is created from a PR or issue (existing flow that already fetches `prTitle` / `issueTitle`), the same response carries `state` and `isDraft`. Persist it on the initial worktree row.

- [ ] **Step 1: Locate the link-time fetch**

Run: `grep -n "prTitle\|issueTitle" apps/server/src/sourceControl/GitHubSourceControlProvider.ts`
Expected: a single helper that fetches the title from GitHub when constructing the worktree create payload.

- [ ] **Step 2: Add a failing test**

In `apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts`, replicate the pattern of an existing "fetches PR title at link time" test and add an assertion that the emitted `WorktreeCreatedPayload` includes `prState` and `prIsDraft` (or that a `WorktreeSourceControlStateUpdated` event is emitted immediately after the create event with the captured values — match whichever pattern the existing tests use for `prTitle`).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && bun run vitest run src/sourceControl/GitHubSourceControlProvider.test.ts -t "state at link time"`
Expected: FAIL.

- [ ] **Step 4: Update the link-time path**

In the helper that builds the create payload, also extract `state` and `isDraft` from the same GitHub CLI response (`GitHubPullRequestSummary` already has these fields — see `apps/server/src/sourceControl/GitHubCli.ts:43-45`). Either:
- Include them in `WorktreeCreatedPayload` (preferred — single event), or
- Emit `WorktreeSourceControlStateUpdated` immediately after the create event.

If the contract requires the former, extend `WorktreeCreatedPayload` in `packages/contracts/src/orchestration.ts` with optional `prState`, `prIsDraft`, `issueState`. If you take the second path, no contract change is needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && bun run vitest run src/sourceControl/GitHubSourceControlProvider.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sourceControl/GitHubSourceControlProvider.ts apps/server/src/sourceControl/GitHubSourceControlProvider.test.ts packages/contracts/src/orchestration.ts
git commit -m "Capture PR/issue state at worktree link time"
```

---

## Task 9: Refresh source 2 — on detail fetch (RPC handlers)

**Files:**
- Modify: `apps/server/src/ws.ts` (and any sub-module that owns `getPullRequest` / `getIssue` routing)

- [ ] **Step 1: Find the RPC routes**

Run: `grep -n "getPullRequest\|getIssue\|pullRequestDetail\|issueDetail" apps/server/src/ws.ts apps/server/src/sourceControl`
Expected: handlers that respond to the queries opened by `PullRequestDetail.tsx` / `IssueDetail.tsx`.

- [ ] **Step 2: Add a failing test**

Add a test (`apps/server/src/server.test.ts` or wherever the equivalent integration tests live) that:
1. Seeds a projection row with `prNumber: 10`, `prState: null`.
2. Calls the `getPullRequest` RPC for number 10 with a fake provider response `{ state: "open", isDraft: false }`.
3. Asserts a `WorktreeSourceControlStateUpdated` event is emitted with `prState: "open"`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && bun run vitest run -t "getPullRequest updates projection state"`
Expected: FAIL.

- [ ] **Step 4: Wire the hook**

In the handler body, after the successful detail fetch, find the projection worktree(s) where `prNumber` matches (or `issueNumber` for issues) and call `refreshWorktreeSourceControlState({ worktreeId })` for each. Use the existing `findByOrigin` repository method (see `ProjectionWorktrees.ts:73-75`) to look up the worktree by `(projectId, kind: "pr", number)`.

Don't block the RPC response on the refresh — fire it as a forked effect (`Effect.fork`) so a slow projection write never delays the client.

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ws.ts apps/server/src/server.test.ts
git commit -m "Refresh worktree state on PR/issue detail RPC"
```

---

## Task 10: Refresh source 3 — on thread turn finished

**Files:**
- Modify: `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

A turn finishing on a thread attached to a worktree with a linked PR/issue triggers a single debounced refresh.

- [ ] **Step 1: Locate the turn-finished hook**

Run: `grep -n "TurnFinished\|turnComplete\|threadTurnEnd" apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
Expected: a handler that fires after a turn terminates.

- [ ] **Step 2: Add a failing test**

In `ProviderCommandReactor.test.ts`, add a case that:
1. Seeds a thread attached to a worktree with `prNumber: 42`.
2. Emits a turn-finished event for that thread.
3. Asserts `refreshWorktreeSourceControlState` is called once for the worktree (use a spy / fake).
4. Emits two more turn-finished events within 2s on the same worktree, asserts the helper was still called only once (debounced).

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 4: Implement debounced refresh**

In the reactor, after handling the turn-finished event, look up the worktree via the thread → worktree relation, check whether it has a `prNumber` or `issueNumber`, and schedule a refresh through a per-worktree debounce (in-memory `Map<WorktreeId, FiberHandle>` cleared after the call). 2-second trailing window.

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/orchestration/Layers/ProviderCommandReactor.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts
git commit -m "Refresh worktree state after thread turn finishes"
```

---

## Task 11: Refresh source 4 — on app start

**Files:**
- Modify: `apps/server/src/ws.ts` (or whichever module owns the WebSocket connection lifecycle)

- [ ] **Step 1: Locate the connection-open hook**

Run: `grep -n "onConnection\|connectionOpened\|wsConnected\|sessionStart" apps/server/src/ws.ts apps/server/src/wsServer.ts`
Expected: the handler that fires when a new WebSocket session is established (or the equivalent moment when projects are first loaded for a client).

- [ ] **Step 2: Add a failing test**

Test that on connection:
1. Two non-archived worktrees in the same project have linked PRs (`prNumber: 1`, `prNumber: 2`).
2. The refresh helper is called twice (once per worktree), at most 4 in flight.
3. A second connection in the same app session does **not** re-trigger the batch for already-refreshed projects.

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 4: Implement the batched refresh**

In the connection handler, for each project in the connected session's scope, list `projection_worktrees` rows where `archived_at IS NULL` and (`pr_number IS NOT NULL` OR `issue_number IS NOT NULL`), then call `refreshWorktreeSourceControlState` for each with a concurrency cap of 4 (`Effect.forEach(..., { concurrency: 4 })`).

Track per-(appSession, projectId) state in memory so a reconnect doesn't re-trigger. Reset on server restart.

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ws.ts apps/server/src/wsServer.ts
git commit -m "Batched refresh of worktree state on app connection"
```

---

## Task 12: Extend SidebarWorktree + composeSidebarTree

**Files:**
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.ts`
- Modify: `apps/web/src/components/sidebar/hooks/useSidebarTree.test.ts`

- [ ] **Step 1: Add a failing test**

In `useSidebarTree.test.ts`, add:

```ts
it("propagates prState, prIsDraft, issueState through composeSidebarTree", () => {
  const tree = composeSidebarTree({
    nowMs: Date.now(),
    projects: [makeProject("p")],
    threads: [],
    worktrees: [
      {
        worktreeId: "w-1",
        projectId: "p",
        branch: "feat",
        worktreePath: null,
        origin: "pr",
        prNumber: 10,
        issueNumber: null,
        prState: "merged",
        prIsDraft: false,
        issueState: null,
      },
    ],
  });
  const worktree = tree.projects[0].worktrees[0];
  expect(worktree.worktree.prState).toBe("merged");
  expect(worktree.worktree.prIsDraft).toBe(false);
  expect(worktree.worktree.issueState).toBeNull();
});

it("mergeWorktree picks the freshest state by updatedAt", () => {
  const tree = composeSidebarTree({
    nowMs: Date.now(),
    projects: [makeProject("p")],
    threads: [],
    worktrees: [
      {
        worktreeId: "w-1",
        projectId: "p",
        branch: "feat",
        worktreePath: "/x",
        origin: "pr",
        prNumber: 10,
        issueNumber: null,
        prState: "open",
        prIsDraft: null,
        issueState: null,
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        worktreeId: "w-2",
        projectId: "p",
        branch: "feat",
        worktreePath: "/x",
        origin: "pr",
        prNumber: 10,
        issueNumber: null,
        prState: "merged",
        prIsDraft: null,
        issueState: null,
        updatedAt: "2025-06-01T00:00:00Z",
      },
    ],
  });
  expect(tree.projects[0].worktrees[0].worktree.prState).toBe("merged");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bun run vitest run src/components/sidebar/hooks/useSidebarTree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the type**

In `useSidebarTree.ts`, extend `SidebarWorktree`:

```ts
export interface SidebarWorktree {
  // ...existing fields...
  prState?: "open" | "closed" | "merged" | null | undefined;
  prIsDraft?: boolean | null | undefined;
  issueState?: "open" | "closed" | null | undefined;
}
```

- [ ] **Step 4: Carry through composeSidebarTree**

Since `SidebarWorktree` is the shape of input items, no transform is needed — but `mergeWorktree` must merge the three fields. Update it to preserve the most recent (by `updatedAt`) value, using the same `maxIso` helper used for `title`:

```ts
function mergeWorktree(left: SidebarWorktree, right: SidebarWorktree): SidebarWorktree {
  return {
    ...left,
    // ...existing merges...
    prState: preferByUpdatedAt(left, right, (w) => w.prState ?? null),
    prIsDraft: preferByUpdatedAt(left, right, (w) => w.prIsDraft ?? null),
    issueState: preferByUpdatedAt(left, right, (w) => w.issueState ?? null),
  };
}

function preferByUpdatedAt<T>(
  left: SidebarWorktree,
  right: SidebarWorktree,
  pick: (w: SidebarWorktree) => T,
): T {
  const leftMs = left.updatedAt ? Date.parse(left.updatedAt) : Number.NEGATIVE_INFINITY;
  const rightMs = right.updatedAt ? Date.parse(right.updatedAt) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(rightMs) || rightMs <= leftMs) return pick(left);
  return pick(right);
}
```

Update the WebSocket/RPC adapter (search for where `SidebarWorktree` items are produced from the projection — likely in a sibling `sidebarTreeAdapters.ts` or in `store.ts`) to copy `prState`, `prIsDraft`, `issueState` from the projection row.

- [ ] **Step 5: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/sidebar/hooks/useSidebarTree.ts apps/web/src/components/sidebar/hooks/useSidebarTree.test.ts apps/web/src/components/sidebar/sidebarTreeAdapters.ts apps/web/src/store.ts
git commit -m "Propagate worktree source-control state into sidebar tree"
```

---

## Task 13: Sidebar chip uses the variant map

**Files:**
- Modify: `apps/web/src/components/sidebar/SidebarWorktreeList.tsx`

- [ ] **Step 1: Replace WorktreeSourceControlBadges body**

In `SidebarWorktreeList.tsx`, the function `WorktreeSourceControlBadges` (currently around line 538) builds chips manually with a `tone` parameter. Replace the body so each chip is resolved via `resolveStateBadgeVariant`:

```tsx
import { resolveStateBadgeVariant } from "../sourceControl/stateBadgeVariants";

function WorktreeSourceControlBadges({
  worktree,
  onOpenLinkedItem,
}: {
  worktree: SidebarTreeWorktree;
  onOpenLinkedItem?: (item: LinkedWorktreeItem) => void;
}) {
  const issueNumber = worktree.worktree.issueNumber ?? null;
  const prNumber = worktree.worktree.prNumber ?? null;

  if (issueNumber === null && prNumber === null) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {issueNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "issue",
            state: worktree.worktree.issueState ?? null,
          })}
          number={issueNumber}
          kindLabel="Issue"
          onClick={
            onOpenLinkedItem
              ? () => onOpenLinkedItem({ kind: "issue", number: issueNumber })
              : undefined
          }
        />
      ) : null}
      {prNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "pr",
            state: worktree.worktree.prState ?? null,
            isDraft: worktree.worktree.prIsDraft ?? null,
          })}
          number={prNumber}
          kindLabel="Pull request"
          onClick={
            onOpenLinkedItem
              ? () => onOpenLinkedItem({ kind: "pr", number: prNumber })
              : undefined
          }
        />
      ) : null}
    </span>
  );
}
```

And update `WorktreeSourceControlBadge` to take a `variant: StateBadgeVariant` and a `number: number` + `kindLabel: string` (for the tooltip):

```tsx
import type { StateBadgeVariant } from "../sourceControl/stateBadgeVariants";

function WorktreeSourceControlBadge(props: {
  variant: StateBadgeVariant;
  number: number;
  kindLabel: string;
  onClick?: (() => void) | undefined;
}) {
  const Icon = props.variant.Icon;
  const title = props.variant.label
    ? `${props.kindLabel} #${props.number} — ${props.variant.label}`
    : `${props.kindLabel} #${props.number}`;
  const baseClass =
    "inline-flex h-4 shrink-0 items-center justify-center gap-0.5 rounded-sm border px-1 text-[9px] font-semibold tabular-nums leading-none";

  if (props.onClick) {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onClick?.();
    };
    return (
      <button
        type="button"
        className={cn(
          baseClass,
          props.variant.compactClassName,
          "cursor-pointer hover:brightness-125 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-current",
        )}
        title={title}
        aria-label={title}
        onClick={handleClick}
      >
        <Icon className="size-2.5" />
        <span>#{props.number}</span>
      </button>
    );
  }
  return (
    <span
      className={cn(baseClass, props.variant.compactClassName)}
      title={title}
      aria-label={title}
    >
      <Icon className="size-2.5" />
      <span>#{props.number}</span>
    </span>
  );
}
```

- [ ] **Step 2: Run typecheck and existing tests**

Run: `cd apps/web && bun typecheck && bun run vitest run src/components/sidebar`
Expected: green. Existing browser snapshot for `SidebarWorktreeList` will probably diff because chip colors/icons change — that's expected; we'll regenerate in Task 16.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarWorktreeList.tsx
git commit -m "Sidebar chip uses shared state badge variants"
```

---

## Task 14: Hide idle dot

**Files:**
- Modify: `apps/web/src/components/sidebar/SidebarWorktreeList.tsx`

- [ ] **Step 1: Edit the status dot span**

In `SidebarWorktreeSection` (around line 317), the JSX is:

```tsx
<span
  className={cn(
    "inline-flex size-3 shrink-0 items-center justify-center",
    props.worktree.aggregateStatus === "in_progress" ? "animate-pulse" : "",
  )}
  title={WORKTREE_STATUS_LABELS[props.worktree.aggregateStatus]}
>
  <span
    className={cn(
      "size-2 rounded-full",
      WORKTREE_STATUS_CLASSNAMES[props.worktree.aggregateStatus],
    )}
  />
</span>
```

Replace the inner colored `<span>` so it only renders when `aggregateStatus !== "idle"`:

```tsx
<span
  className={cn(
    "inline-flex size-3 shrink-0 items-center justify-center",
    props.worktree.aggregateStatus === "in_progress" ? "animate-pulse" : "",
  )}
  title={WORKTREE_STATUS_LABELS[props.worktree.aggregateStatus]}
  aria-hidden={props.worktree.aggregateStatus === "idle"}
>
  {props.worktree.aggregateStatus === "idle" ? null : (
    <span
      className={cn(
        "size-2 rounded-full",
        WORKTREE_STATUS_CLASSNAMES[props.worktree.aggregateStatus],
      )}
    />
  )}
</span>
```

Outer `<span>` keeps its `size-3` footprint so layout doesn't shift.

- [ ] **Step 2: Smoke-test locally**

Run the dev server and confirm:
- An idle worktree row has no visible dot but its title is at the same horizontal position as before.
- An `in_progress` worktree row still has the animated dot.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarWorktreeList.tsx
git commit -m "Hide chat-activity dot when worktree is idle"
```

---

## Task 15: Origin label dedup

**Files:**
- Modify: `apps/web/src/components/sidebar/SidebarWorktreeList.tsx`

- [ ] **Step 1: Edit WorktreeOriginLabel**

Replace the function (around line 525):

```tsx
function WorktreeOriginLabel({ worktree }: { worktree: SidebarTreeWorktree }) {
  const origin = worktree.worktree.origin;
  const hasPrChip = worktree.worktree.prNumber != null;
  const hasIssueChip = worktree.worktree.issueNumber != null;

  if (origin === "main" || origin === "branch") {
    return null;
  }
  if (origin === "pr" && hasPrChip) {
    return null;
  }
  if (origin === "issue" && hasIssueChip) {
    return null;
  }

  const label = origin === "pr" ? "PR" : origin === "issue" ? "Issue" : "Manual";
  return (
    <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Smoke-test locally**

Confirm:
- A PR-origin worktree with a `#N` chip no longer shows the duplicate "PR" label.
- A manual-origin worktree still shows "Manual".
- A worktree where the PR number is missing on the projection (e.g., legacy) still shows the "PR" label.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarWorktreeList.tsx
git commit -m "Hide redundant PR/Issue origin label when chip is shown"
```

---

## Task 16: Browser snapshots for all variants

**Files:**
- Modify: `apps/web/src/components/sidebar/SidebarWorktreeList.browser.tsx`
- Regenerate: `apps/web/src/components/sidebar/__screenshots__/SidebarWorktreeList.browser.tsx/*.png`

- [ ] **Step 1: Add a new browser test**

In `SidebarWorktreeList.browser.tsx`, add a story / test case that renders a sidebar with one worktree per variant:

```tsx
it("renders every linked-state variant and the idle/active dot states", async () => {
  const project = makeProject("p");
  const worktrees: SidebarWorktree[] = [
    mk({ worktreeId: "w-issue-open",  origin: "issue", issueNumber: 1,  issueState: "open" }),
    mk({ worktreeId: "w-issue-closed",origin: "issue", issueNumber: 2,  issueState: "closed" }),
    mk({ worktreeId: "w-pr-draft",    origin: "pr",    prNumber: 10,    prState: "open",   prIsDraft: true  }),
    mk({ worktreeId: "w-pr-open",     origin: "pr",    prNumber: 11,    prState: "open",   prIsDraft: false }),
    mk({ worktreeId: "w-pr-merged",   origin: "pr",    prNumber: 12,    prState: "merged" }),
    mk({ worktreeId: "w-pr-closed",   origin: "pr",    prNumber: 13,    prState: "closed" }),
    mk({ worktreeId: "w-unknown-pr",  origin: "pr",    prNumber: 14,    prState: null     }),
  ];

  // render with a fixture that produces:
  // - aggregateStatus "idle" for w-issue-open
  // - aggregateStatus "in_progress" for w-pr-open
  // - aggregateStatus "review" for w-pr-merged
  // - aggregateStatus "done" for w-pr-closed
  // (others default to idle so the no-dot state shows up multiple times)

  const ui = render(/* ... */);
  await expect(ui.container).toMatchScreenshot();
});

function mk(input: Partial<SidebarWorktree> & { worktreeId: string; origin: SidebarWorktreeOrigin }): SidebarWorktree {
  return {
    branch: "feat",
    projectId: "p",
    worktreePath: null,
    prNumber: null,
    issueNumber: null,
    prState: null,
    prIsDraft: null,
    issueState: null,
    archivedAt: null,
    ...input,
  };
}
```

(Follow the existing pattern in the file for how snapshots are wired — e.g., `expect(canvas).toMatchSnapshot()` or the `__screenshots__/` directory convention.)

- [ ] **Step 2: Generate the snapshot**

Run: `cd apps/web && bun run vitest run src/components/sidebar/SidebarWorktreeList.browser.tsx --update`
Expected: new PNG under `__screenshots__/SidebarWorktreeList.browser.tsx/` with all seven variants visible.

- [ ] **Step 3: Eyeball the snapshot**

Open the generated PNG and confirm:
- Issue open chip is emerald with `CircleDot` icon.
- Issue closed chip is violet with `CheckCircle2` icon.
- PR draft chip is zinc with `GitPullRequestDraft` icon.
- PR open chip is emerald with `GitPullRequest` icon.
- PR merged chip is violet with `GitMerge` icon.
- PR closed chip is rose with `XCircle` icon.
- Unknown-state chip looks like today's neutral blue PR chip.
- Idle worktrees have no dot; `in_progress` has an animated colored dot.

- [ ] **Step 4: Run the full suite once**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: all green. (Per `AGENTS.md`, never use plain `bun test` — always `bun run test`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sidebar/SidebarWorktreeList.browser.tsx apps/web/src/components/sidebar/__screenshots__/
git commit -m "Snapshot every state-aware sidebar chip variant"
```

---

## Self-Review (executed after writing the plan)

### Spec coverage

- ✅ State-aware chip variants (issue open/closed, PR draft/open/merged/closed) — Tasks 1, 13.
- ✅ Unknown-state fallback chip — Task 1 (`issue-unknown`, `pr-unknown`).
- ✅ Compact sidebar styling preserved — Task 13 keeps `h-4`, `text-[9px]`, `size-2.5` icon.
- ✅ Click behavior unchanged — Task 13 preserves `LinkedWorktreeItemDialog` opening.
- ✅ Archived rows inherit chip changes — `ArchivedWorktreeRow` uses the same `WorktreeSourceControlBadges`, no extra task needed.
- ✅ Shared variant map between sidebar and `projectExplorer/StateBadge` — Tasks 1, 2.
- ✅ Idle dot suppressed with reserved space — Task 14.
- ✅ Origin label dedup (PR/Issue but not Manual) — Task 15.
- ✅ Contract additions (`PullRequestState`, `IssueState`, three new `Worktree` fields) — Task 3.
- ✅ Migration 037 + repair pattern — Task 4 (note: per the spec the column changes go through the migration system; the existing `repair*` helpers in `Migrations.ts` are for legacy column drift, not new columns).
- ✅ Repository SQL — Task 5.
- ✅ Domain event + projector + pipeline + snapshot query — Task 6.
- ✅ `refreshWorktreeSourceControlState` helper — Task 7.
- ✅ Refresh source 1 (link time) — Task 8.
- ✅ Refresh source 2 (detail fetch) — Task 9.
- ✅ Refresh source 3 (turn finished, debounced) — Task 10.
- ✅ Refresh source 4 (on app start, concurrency 4) — Task 11.
- ✅ Frontend type extension + propagation — Task 12.
- ✅ Visual changes — Tasks 13–15.
- ✅ Snapshot coverage — Task 16.

### Placeholder scan

No `TBD`/`TODO` in the task bodies. Two tasks (8, 9, 10, 11) point the implementor at a `grep` step before writing tests because the exact handler name varies per file — the action is concrete (grep → replicate adjacent pattern) and the resulting test/code is fully specified.

### Type consistency

- `StateBadgeKind` from Task 1 is re-exported in Task 2's `StateBadge.tsx`; both modules agree on the kebab-case kinds.
- `PullRequestState` / `IssueState` from Task 3 are imported in Task 6 (orchestration), Task 7 (helper), and used as type discriminants in Task 12 (sidebar) — consistent.
- `prState`, `prIsDraft`, `issueState` field names used identically in contract (Task 3), persistence (Tasks 4, 5), event payload (Task 6), refresh helper (Task 7), sidebar type (Task 12), and chip resolver (Task 13).
- `refreshWorktreeSourceControlState({ worktreeId })` signature consistent across Tasks 7, 9, 10, 11.

No drift detected.

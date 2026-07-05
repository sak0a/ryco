# Batch 05 — Git / Workflow (Orchestration Prompt)

Copy everything below the line into a **Composer 2.5** lead session.

---

## Role

Orchestrate Ryco batch **Git / Workflow**: features **16, 17, 18, 19**.

Read [AGENTS.md](../../AGENTS.md). Validation:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent? | PR |
|----|---------|-------|-----------|-----|
| 16 | Worktree status chips | Composer 2.5 | Yes | PR 1 (parallel) |
| 17 | Execution env metadata | Composer 2.5 | Yes | PR 2 (parallel) |
| 18 | Forgejo OR Bitbucket parity | GPT 5.5 | Yes — **one provider per PR** | PR 3a / 3b |
| 19 | Jira ↔ worktree flow | **Opus 4.8** | Solo | PR 4 |

## Parallel wave 1

Spawn **2 subagents** simultaneously:

| Subagent | Model | Prompt file | Allowed paths |
|----------|-------|-------------|---------------|
| G1 | Composer 2.5 | [features/16-worktree-status-chips.md](../features/16-worktree-status-chips.md) | `SidebarWorktreeList.tsx`, `worktreeOperations.ts`, contracts/persistence for status |
| G2 | Composer 2.5 | [features/17-execution-env-metadata.md](../features/17-execution-env-metadata.md) | `packages/contracts`, branch picker UI, server env probe, `packages/ssh` |

**Preamble:**

```text
Ryco git/workflow subagent. Implement ONLY assigned feature.
Do not touch the other subagent's paths.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit. Read AGENTS.md.
```

## Wave 2 — Provider parity (split by provider)

**Never one PR for both Forgejo and Bitbucket.**

| Subagent | Model | Prompt | Scope |
|----------|-------|--------|-------|
| G3a | GPT 5.5 | [features/18-forgejo-bitbucket-parity.md](../features/18-forgejo-bitbucket-parity.md) | **Forgejo only** — PR/MR, # picker, publish, tests |
| G3b | GPT 5.5 | Same prompt, Bitbucket scope | **Bitbucket only** — separate PR |

Reference implementation: `GitHubSourceControlProvider.ts`

## Wave 3 — Jira flow (solo Opus)

| Agent | Model | Prompt |
|-------|-------|--------|
| Lead | **Opus 4.8** | [features/19-jira-worktree-flow.md](../features/19-jira-worktree-flow.md) |

Multi-system E2E: Jira ticket → branch → worktree → thread with issue context. Do not subagent unless splitting server vs UI with clear handoff.

## Recommended PR order

```text
1. Merge G1 + G2 (parallel)
2. PR 3a Forgejo parity
3. PR 3b Bitbucket parity (optional same sprint)
4. PR 4 Jira flow (Opus)
```

## Inline prompts

### 16 — Worktree chips

Status buckets: idle, in_progress, review, done. Sidebar badges, context menu change, server persist. Optional auto in_progress on active turn. Extend `SidebarWorktreeList.browser.tsx`.

### 17 — Env metadata

Add `nodeVersion`, `shell` to `ExecutionEnvironmentDescriptor`. Server probe + SSH bootstrap. Show in environment picker. Fix TODO in `overviewSections.tsx`.

### 18 — Provider parity

One provider per PR. Match GitHub flows: PR creation, # attachment, publish, CI status where applicable. Shared abstractions in `SourceControlProvider.ts`.

### 19 — Jira flow

Work item actions: create branch, worktree, agent thread. Link Jira key in thread. Branch naming `PROJ-123-slug`. Pre-fill composer attachment.

## Orchestrator checklist

- [ ] Worktree chips visible + persist
- [ ] Shell/node shown in env picker
- [ ] At least one secondary provider parity PR merged
- [ ] Jira E2E happy path (manual or browser test)
- [ ] Full validation green

## Manual smoke

1. Change worktree status → reload → still set
2. SSH env shows remote shell/node
3. Forgejo/Bitbucket: create PR or attach issue in composer
4. Jira ticket → worktree → thread with context

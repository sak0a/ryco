# 08 — Finish AtomRpc migration (remove React Query)

| Field | Value |
|-------|-------|
| **Batch** | Perf / refactor |
| **Order in batch** | 5 of 6 |
| **Depends on (same batch)** | 04 |

## Prompt

Complete Phase 3 of `.plans/21-concrete-improvement-roadmap.md`: remove remaining `@tanstack/react-query` usage from `apps/web`.

### Context

- Migration target: Effect AtomRpc (`@effect/atom-react`) under `apps/web/src/rpc/`
- Remaining React Query imports: `ChatOverviewPanel`, `ChatView`, `queryClient.ts`, `useSourceControl`, `useAtlassian`, `useWorkItems`, `useProject`, `SourceControlSettings`, `WorkItemsTab`, etc.
- `gitAtoms`, `projectAtoms`, `overviewAtoms`, `sourceControlAtoms` already exist

### Requirements

- Migrate each remaining `useQuery`/`useMutation` to atom hooks
- Preserve hook names where exported (`useProject`, `useGit`, etc.)
- Delete `QueryClientProvider` from router/root when done
- Remove `@tanstack/react-query` from `apps/web/package.json`
- Replace tests (e.g. `gitReactQuery.test.ts` patterns) with atom tests

### Acceptance

- Zero `useQuery`/`useMutation` imports in `apps/web`
- All existing RPC and hook tests pass
- Bootstrap from `routes/__root.tsx` unchanged from user perspective
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass

### Constraints

- Match existing conventions in surrounding files
- Minimize scope — no drive-by refactors
- Do not commit unless explicitly asked

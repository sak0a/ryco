# Client perf profiling

Ryco has opt-in client-side performance instrumentation for thread switches, sidebar interactions, and component render timing.

## Enable profiling

Set `VITE_RYCO_PERF_PROFILE=1` when running the web app or browser tests:

```bash
VITE_RYCO_PERF_PROFILE=1 bun run dev:web
```

```bash
VITE_RYCO_PERF_PROFILE=1 bun --filter @ryco/web run test:browser
```

When disabled, all mark helpers are no-ops and budget tests use mocked `Performance` objects.

## Marks and measures

| Interaction            | Click mark                        | First-paint mark                        | Measure name                |
| ---------------------- | --------------------------------- | --------------------------------------- | --------------------------- |
| Thread tab switch      | `ryco:tab-switch:click:<key>`     | `ryco:tab-switch:first-paint:<key>`     | `ryco:tab-switch:<key>`     |
| Sidebar project expand | `ryco:sidebar-expand:click:<key>` | `ryco:sidebar-expand:first-paint:<key>` | `ryco:sidebar-expand:<key>` |
| Component render       | `ryco:render:<label>:start:N`     | `ryco:render:<label>:end:N`             | `ryco:render:<label>#N`     |

Helpers live in `tabSwitchInstrumentation.ts`. Soft budgets are defined in `budgets.ts`.

## Inspecting results in DevTools

```js
performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("ryco:"));
```

Rate summaries also emit to the console via `perfInstrumentation.ts` when profiling is enabled.

## Budget tests

Unit tests in `budgets.test.ts` validate budget evaluation logic without requiring a live browser.

Browser budget regression coverage lives in `components/perf/ClientPerfBudget.browser.tsx` and runs with the browser test suite when `VITE_RYCO_PERF_PROFILE=1`.

## Debugging memo churn during refactors

Use `useDevPropDiff(props, "ComponentName")` at the top of a memoized component body while refactoring hot paths (`MessagesTimeline`, `ChatComposer`, sidebar rows). It logs which prop identities changed between renders. Remove before merging unless the component is permanently instrumented.

Use `useRenderCounter("ComponentName")` for coarse render-count logging in dev builds.

### Phase 0.2 audit (2026-06-14)

Static prop-diff audit for hot-path components. Findings and Phase 2.1 follow-ups:

- `.plans/21-prop-diff-findings.md`

Top priorities: stabilize `ChatComposer` `onSend` (not `useCallback` today), split `MessagesTimeline` row context, memoize sidebar `orderedProjectThreadKeys`.

## Related docs

- Server traces and OTLP export: `docs/observability.md`
- Improvement roadmap: `.plans/21-concrete-improvement-roadmap.md`

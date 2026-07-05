# Batch 07 — Differentiation (Orchestration Prompt)

Copy everything below the line into a **Composer 2.5** lead session.

---

## Role

Orchestrate Ryco batch **Differentiation**: features **26–30**. This is the **most parallelizable** batch — up to **5 simultaneous subagents** with minimal file overlap.

Read [AGENTS.md](../../AGENTS.md). Validation:

```bash
bun fmt && bun lint && bun typecheck && bun run test
```

Do not commit unless explicitly asked.

## Batch summary

| ID | Feature | Model | Subagent | Overlap risk |
|----|---------|-------|----------|--------------|
| 26 | Project dashboard | Composer 2.5 | D1 | Low — new route/panel |
| 27 | Thread export MD | GPT 5.5 | D2 | Low — serializer + palette |
| 28 | Usage budgets | Composer 2.5 | D3 | Medium — settings + statistics |
| 29 | Project templates | GPT 5.5 | D4 | Medium — project settings dialog |
| 30 | Script presets | Composer 2.5 | D5 | Low — scripts + palette |

**Note:** D3, D4 both touch project settings — either serialize 28→29 or assign D4 import/export to a separate dialog section with non-overlapping files.

## Recommended parallelism

### Option A — Maximum parallel (4 agents)

```text
Parallel:
  D1 → 26 dashboard
  D2 → 27 export
  D5 → 30 scripts

Sequential pair (same settings area):
  D3 → 28 budgets, then D4 → 29 templates
```

### Option B — Full parallel (5 agents with file locks)

Assign explicit non-overlap:

| Subagent | Model | Feature | Allowed paths | Forbidden |
|----------|-------|---------|---------------|-----------|
| D1 | Composer 2.5 | 26 | `routes/`, new dashboard components, `overviewAtoms` read-only | project settings dialog |
| D2 | GPT 5.5 | 27 | `CommandPalette.logic.ts`, new `threadExport.ts`, tests | settings |
| D3 | Composer 2.5 | 28 | `statistics/`, settings schema budgets section, banner UI | templates import/export |
| D4 | GPT 5.5 | 29 | `ProjectSettingsDialog.tsx` templates section only | budget fields |
| D5 | Composer 2.5 | 30 | project scripts schema, palette, worktree quick action | dashboard |

## Subagent preamble (all)

```text
Ryco differentiation subagent. Implement ONLY feature NN from your prompt file.
Stay within allowed paths. Do not modify forbidden paths listed by orchestrator.
Before finishing: bun fmt && bun lint && bun typecheck && bun run test
Do not commit. Minimize scope. Read AGENTS.md.
```

## Spawn commands (copy per subagent)

### D1 — Project dashboard

**Model:** Composer 2.5  
**Prompt file:** [features/26-project-dashboard.md](../features/26-project-dashboard.md)

Project home: worktrees, open PRs, CI, recent threads, weekly token usage. Read-only aggregation from existing RPCs. Lazy load.

---

### D2 — Thread export

**Model:** GPT 5.5  
**Prompt file:** [features/27-thread-export-markdown.md](../features/27-thread-export-markdown.md)

Pure markdown serializer + unit test. Command palette "Export thread as Markdown". Web download / desktop save dialog. No provider calls.

---

### D3 — Usage budgets

**Model:** Composer 2.5  
**Prompt file:** [features/28-usage-budgets.md](../features/28-usage-budgets.md)

Weekly token/USD budget per provider instance. 80%/100% soft banner. Use existing statistics buckets only.

---

### D4 — Project templates

**Model:** GPT 5.5  
**Prompt file:** [features/29-project-templates.md](../features/29-project-templates.md)

Export/import JSON template from project settings. Redact secrets. Import confirmation diff.

---

### D5 — Script presets

**Model:** Composer 2.5  
**Prompt file:** [features/30-project-script-presets.md](../features/30-project-script-presets.md)

Named scripts in project settings. Command palette "Run script". Optional worktree chip action. Terminal drawer output.

## Orchestrator workflow

1. Create branch `batch/differentiation` or 5 feature branches.
2. Spawn D1, D2, D5 in parallel immediately.
3. Spawn D3, then D4 after D3 merges **OR** spawn both with file-lock table above.
4. Merge all; resolve conflicts (likely `ProjectSettingsDialog.tsx` if 28+29+30 all touch it — prefer splitting into subcomponents first).
5. Run full test suite once at end.

## Merge conflict prevention (optional prep PR)

Before spawning 5 agents, lead may land a tiny prep PR:

- Extract `ProjectSettingsBudgetSection.tsx`
- Extract `ProjectSettingsTemplatesSection.tsx`
- Extract `ProjectSettingsScriptsSection.tsx`

Then parallelize safely. **Model:** Composer 2.5, ~1 hour.

## Success criteria

- [ ] Dashboard loads for real project
- [ ] Export produces valid GitHub-flavored markdown
- [ ] Budget banner fires at threshold
- [ ] Template export/import round-trips without secrets
- [ ] Script runs from palette in terminal drawer
- [ ] `bun fmt && bun lint && bun typecheck && bun run test` green

## Manual smoke

1. Open project dashboard → cards populated
2. Export thread → open .md in editor
3. Set $1 budget → trigger banner
4. Export template from project A → import to B
5. Run "test" script from Cmd+K

## Sprint timing

This batch is ideal for a **single afternoon** with 3–5 Cloud Agents or Cursor subagents, provided settings dialog is pre-split or 28/29/30 are serialized.

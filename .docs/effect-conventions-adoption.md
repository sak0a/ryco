# Effect structured-error + service conventions — adoption decision

**Status:** Recommendation (research only — no application code changed)
**Date:** 2026-06-29
**Recommendation:** **(B) Adopt a lighter, ryco-authored subset; migrate incrementally; enforce with ryco's own tooling**
**Scope:** Should ryco adopt the Effect Schema/Data tagged-error + service-module conventions that upstream `t3code` swept across its codebase (~200 `[codex]` PRs, 2026-06-20/21), and if so, how?

> Supersedes an earlier untracked draft (preserved at `.docs/effect-conventions-adoption.prior-draft.md`). This version corrects three factual errors in that draft — it assumed ESLint (ryco has none; it uses `vp lint`), overstated raw-`throw` debt (most is React/Electron/test code, not Effect), and omitted the per-package counts table + the service-shape gap that is actually the largest effort.

---

## TL;DR — go/no-go: **GO, scoped**

- **Adopt the _rules_, not the _runner_.** Upstream's enforcement is a "macroscope" **check-run agent** — an LLM review bot (`model: claude-opus-4-8`, `effort: high`, `conclusion: failure`, tools `browse_code`/`git_tools`/`github_api_read_only`/`modify_pr`) on pingdotgg-internal infra. ryco has **no `.macroscope/` directory**, no macroscope platform, and a different CI (`bun` + `vite-plus`/`vp lint`, **no eslint**). Literal option **(A) is infeasible as-written** — the rules port, the runner does not.
- **ryco is already ~79% aligned on the error model:** 94 `Schema.TaggedErrorClass` defs vs 25 legacy `Data.TaggedError`. Clean in-house exemplars exist (`packages/effect-acp`, `packages/contracts`, `apps/server/.../checkpointing/Errors.ts`, `WorkspacePaths` errors). The convention is the direction ryco was already drifting → low-risk to finish.
- **Not adopting (C) is wrong** because upstream is now uniformly on this style; every future upstream sync conflicts against ryco's divergent shapes. Converging _reduces_ long-term merge pain — **if** we port upstream's own diffs where files still align rather than re-deriving them.
- **The real work is the service-module shape in `apps/server`** (not the errors): 92 `Context.Service` decls next to ~99 separate `*Shape` interfaces, 75 `*Live` layers, a **`Services/`+`Layers/` split across 12 subsystems (25 directories)**, 473 consolidated `from "effect"` imports, 313 redundant `Effect`/`Layer` annotations. This is a **Large**, mechanical, high-merge-conflict effort → do it _after_ the error cleanup.
- **Enforce in two tiers**, neither of which is the upstream agent: (1) cheap deterministic CI guards + the already-wired `@effect/language-service` for the black-and-white rules (advisory→blocking per-package); (2) a Claude-based PR review prompt — a faithful reimplementation of upstream's spec, which ryco _can_ run because it dogfoods Claude — for the judgment-heavy rules (comment-only first).

**Sequence:** Phase 0 (convention doc + advisory guards) → Phase 1 (`ssh`, `tailscale` — fully-legacy leaves) → Phase 2 (`apps/server` error layer) → Phase 3 (`apps/server` service shape) → Phase 4 (`shared`, `client-runtime`, `web`/`desktop` Effect surface). Treat `contracts` + `effect-*` packages as essentially done.

---

## Step 1 — The extracted convention spec

Fetched from upstream (single source of truth, built by PRs #3212/#3380/#3213):
`gh api repos/pingdotgg/t3code/contents/.macroscope/check-run-agents/effect-service-conventions.md --jq '.content' | base64 -d`

It is a **check-run agent prompt**, not a lint config — YAML frontmatter: `model: claude-opus-4-8`, `effort: high`, `input: full_diff`, `conclusion: failure` (defaults to failing), tools `browse_code`/`git_tools`/`github_api_read_only`/`modify_pr`, scope `apps/**` + `packages/**` + `infra/**`. It posts inline PR comments and fails the check on a clear violation.

### The concrete rules (condensed)

**Imports & namespaces**

- Effect library modules: namespace subpath imports — `import * as Effect from "effect/Effect"`, `import * as Layer from "effect/Layer"`. Flag consolidated named imports from `"effect"` _in touched Effect service code_.
- Local service boundary: namespace-import the module and use its public shape — `WorkspacePaths.WorkspacePaths`, `WorkspacePaths.make`, `WorkspacePaths.layer`. Flag aliases like `import { layer as workspacePathsLayer }`.
- **Not a blanket rule.** Keep named imports for whole packages (`@ryco/contracts`) and modules used only for a pure helper/error/schema/config/type. Barrels exposing a whole service module: `export * as TokenStore from "./tokenStore.ts"`.

**Service definition**

- Canonical order: imports → error/schema decls → `Context.Service` tag with **inline** interface → `make` → `layer`.
- Define the interface **inline** in the `Context.Service` generic; delete standalone `FooShape`/`FooServiceShape`. Reference the inferred interface as `Foo["Service"]` everywhere (mocks, tests, MCP, harnesses).
- Export a real `make`; export `export const layer = Layer...`. `Layer.effect` is **not** required — use `Layer.succeed`/`Layer.scoped` to match the impl. Rename `*Live` → `layer`. Concrete impl modules use plain `make`/`layer`; abstract-port modules with multiple impls keep impl-specific names.

**Errors & predicates**

- Define failures with **`Schema.TaggedErrorClass`** + structured attributes; derive `message` via `override get message()` from those attributes — never store an unstructured `message` as the only data.
- **Preserve cause:** thread the immediate underlying error as `cause` alongside structural fields; `cause` required if every construction wraps a failure, optional only if the error can originate without one. Pure validation/domain errors need no cause.
- **Derive `message` only from stable attributes** — never from `cause`/`cause.message`/a stringified defect. Don't replace the error with `error.cause`, don't manufacture an `Error` just to populate `cause`.
- **Redact & bound diagnostics:** never copy raw wire payloads, command args/output, signed URLs, credentials, query strings/fragments/selectors, or arbitrary defect text into `detail`/`reason`/`message` or a parallel log payload. Keep the exact value _only_ as `cause`; expose normalized categories + lengths/counts + safe URL protocol/hostname.
- **No constructor-wrapper anti-pattern:** don't add a helper whose only behavior is `(...args) => new SomeError({ ...args })` (incl. curried `mapError` aliases). Construct inline at the failure boundary. Keep a mapper only for real normalization / domain-error pass-through / reusable context. Prefer a `static from*` factory on the target error class for reusable error→error translation.
- **One discriminator model, not two:** don't encode the same distinction with both a specific error tag _and_ a single-value `operation`/`reason`/`kind`/`phase` literal. Split into separate classes when a discriminator drives the user-facing message or caller control flow; a diagnostic-only discriminator may remain a field.
- **Caller-visible messages are behavior** (HTTP/RPC/persisted/UI) — preserve across structural refactors.
- Use `Effect.catchTags({ ... })` for statically-known tags (even one); avoid `catchIf`+predicate and bare `catchTag` for that. Export `export const isFoo = Schema.is(Foo)`. Use `Schema.Union` of error classes for shared predicates.

**File layout & change discipline**

- Collapse `domain/Services/Foo.ts` + `domain/Layers/Foo.ts` → `domain/Foo.ts`. **Delete** old files, no re-export shims, mechanically update consumers. Preserve comments/invariants. Don't add large tests for a mechanical refactor; do add focused tests if backend behavior changes.

---

## Step 2 — Representative before/after (from upstream diffs)

Reviewed via `gh pr diff <N> -R pingdotgg/t3code`: #3398 (persistence wrapper removal), #3248/#3253 (source-control / Git VCS driver errors), #3242 (client connection causes), #3426 (trace-id traversal across causes), #3187/#3185 (service-module refactors), #3229 (redundant annotations).

### (a) Constructor-wrapper removed → inline `new` + a _meaningful_ static mapper (#3398, persistence)

```ts
// BEFORE — call site routes through thin toPersistence* factory wrappers
import { toPersistenceDecodeError, toPersistenceSqlError } from "./Errors.ts";
const toErr = (sqlOp: string, decodeOp: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(decodeOp)(cause) // wrapper copied the FULL formatter output → leaks rejected values
    : toPersistenceSqlError(sqlOp)(cause);

// AFTER — direct `new` for SQL; a static mapper that adds real value (summarizes issue *tags only*, preserves cause)
import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";
const toErr = (sqlOp: string, decodeOp: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? PersistenceDecodeError.fromSchemaError(decodeOp, cause) // summarizeSchemaIssue() → no rejected payload in `issue`
    : new PersistenceSqlError({ operation: sqlOp, cause });
```

### (b) `Data.TaggedError` → `Schema.TaggedErrorClass`, cause preserved, URL redacted, derived message (#3242, `rpc/http.ts`)

```ts
// BEFORE — Data.TaggedError; message embeds the raw request URL; ad-hoc constructor; no cause
export class RemoteEnvironmentAuthUndeclaredStatusError extends Data.TaggedError(
  "RemoteEnvironmentAuthUndeclaredStatusError",
)<{ readonly message: string; readonly status: number; readonly requestUrl: string }> {
  constructor(requestUrl: string, status: number) {
    super({
      message: `Remote endpoint ${requestUrl} returned undeclared status ${status}.`,
      requestUrl,
      status,
    });
  }
}

// AFTER — Schema.TaggedErrorClass; only redacted diagnostics stored; message derived; static factory threads cause
export class RemoteEnvironmentAuthUndeclaredStatusError extends Schema.TaggedErrorClass<RemoteEnvironmentAuthUndeclaredStatusError>()(
  "RemoteEnvironmentAuthUndeclaredStatusError",
  { ...requestUrlDiagnosticSchema, status: Schema.Number, cause: Schema.Defect() }, // {inputLength, protocol?, hostname?}
) {
  static fromRequestUrl(requestUrl: string, status: number, cause: unknown) {
    return new RemoteEnvironmentAuthUndeclaredStatusError({
      ...requestUrlDiagnosticFields(requestUrl),
      status,
      cause,
    });
  }
  override get message() {
    return `Remote endpoint at ${requestUrlDescription(this)} returned undeclared status ${this.status}.`;
  }
}
export const isRemoteEnvironmentAuthUndeclaredStatusError = Schema.is(
  RemoteEnvironmentAuthUndeclaredStatusError,
);
```

### (c) Redaction + service shape: store lengths not payloads; inline interface + `make`/`layer` + namespace imports (#3253, #3185/#3187)

```ts
// BEFORE — error carries raw args/stderr (leak); service uses a separate *Shape + *Live + named import
export interface DesktopStateShape {
  readonly backendReady: Ref.Ref<boolean>;
  readonly quitting: Ref.Ref<boolean>;
}
export class DesktopState extends Context.Service<DesktopState, DesktopStateShape>()(
  "…/DesktopState",
) {}
export const layer = Layer.effect(
  DesktopState,
  Effect.all({ backendReady: Ref.make(false), quitting: Ref.make(false) }),
);
// consumer: import { ServerConfig } from "./config.ts";  yield* ServerConfig;

// AFTER — GitCommandError stores argumentCount/stdoutLength/stderrLength (not the content); cause preserved.
// service: interface inlined into the Context.Service generic; colocated `make`; exported `layer`; namespace consumer
export class DesktopState extends Context.Service<
  DesktopState,
  {
    readonly backendReady: Ref.Ref<boolean>;
    readonly quitting: Ref.Ref<boolean>;
  }
>()("…/DesktopState") {}
const make = Effect.all({ backendReady: Ref.make(false), quitting: Ref.make(false) });
export const layer = Layer.effect(DesktopState, make);
// consumer: import * as ServerConfig from "./config.ts";  const cfg = yield* ServerConfig.ServerConfig;
```

(#3229 strips inferable `Effect.Effect<…>`/`Layer.Layer<…>`/`ManagedRuntime.make<…>` annotations, keeping explicit types only at exported runtime boundaries via portable source-union aliases. #3426 makes trace-id traversal walk the whole error graph — `AggregateError.errors` + Effect `Cause` `Fail`/`Die` — bounded at 128 nodes, cycle-safe.)

---

## Step 3 — ryco audit (the core)

Counts via `rg` over `apps/*` + `packages/*` (method in Appendix). Read **honestly** — occurrence counts mix definitions, references, and tests; qualified inline.

### Audit table — per package

| Package                          | .ts files | `Data.TaggedError` (legacy) | `Schema.TaggedErrorClass` (target) | plain `extends Error` | separate `*Shape` defs | `*Live` layers | `Context.Service` | named `from "effect"` | namespace `effect/` | redundant `Eff/Layer<>` | `mapError` | `tryPromise` no-catch | Alignment                 |
| -------------------------------- | --------: | --------------------------: | ---------------------------------: | --------------------: | ---------------------: | -------------: | ----------------: | --------------------: | ------------------: | ----------------------: | ---------: | --------------------: | ------------------------- |
| **apps/server**                  |       531 |                      **12** |                                 47 |                     2 |                 **99** |         **75** |            **92** |               **473** |                 197 |                 **313** |    **489** |                 **9** | partial — biggest gap     |
| apps/web                         |       663 |                           1 |                                  0 |                     2 |                      2 |              1 |                 1 |                    60 |                  16 |                       2 |          0 |                     0 | mostly non-Effect (React) |
| apps/desktop                     |        46 |                           0 |                                  0 |                     1 |                      1 |              0 |                 0 |                     4 |                   2 |                       0 |          0 |                     0 | Electron boundary         |
| apps/marketing                   |         0 |                           – |                                  – |                     – |                      – |              – |                 – |                     – |                   – |                       – |          – |                     – | n/a (no `.ts`)            |
| packages/contracts               |        44 |                           0 |                             **36** |                     0 |                      0 |              0 |                 0 |                    43 |                   4 |                       1 |          0 |                     0 | ✅ done (wire contracts)  |
| packages/effect-acp              |        17 |                           0 |                                  5 |                     0 |                      2 |              0 |                 2 |                     1 |              **79** |                      19 |          7 |                     0 | ✅ on-target, polish      |
| packages/effect-codex-app-server |        16 |                           0 |                                  6 |                     0 |                      2 |              0 |                 1 |                     1 |              **41** |                      15 |          5 |                     0 | ✅ on-target, polish      |
| packages/client-runtime          |         8 |                           0 |                                  0 |                     0 |                      0 |              0 |                 0 |                     0 |                   0 |                       0 |          0 |                     0 | tiny                      |
| packages/shared                  |        39 |                           1 |                                  0 |                     0 |                      1 |              0 |                 1 |                    10 |                   3 |                      13 |          0 |                     0 | minor                     |
| **packages/ssh**                 |         9 |                       **8** |                                  0 |                     0 |                      2 |              0 |                 2 |                     9 |                   0 |                       3 |         14 |                     0 | ❌ fully legacy           |
| **packages/tailscale**           |         3 |                       **3** |                                  0 |                     0 |                      0 |              0 |                 0 |                     2 |                   0 |                       9 |          6 |                     0 | ❌ fully legacy           |
| **Totals**                       |           |                      **25** |                             **94** |                     5 |                   ~106 |             76 |                98 |                  ~603 |                ~342 |                    ~372 |       ~521 |                     9 |                           |

### What the numbers mean

- **Error model is ~79% there.** 94 target `Schema.TaggedErrorClass` vs 25 legacy `Data.TaggedError`. Legacy concentrates in **`ssh` (8)**, **`tailscale` (3)**, **12 in `apps/server`** (+1 each in `web`/`shared`). 5 plain `extends Error` are stragglers.
- **`ssh` is the textbook anti-pattern _and_ a real secret-leak surface.** `packages/ssh/src/errors.ts` uses `import { Data } from "effect"` + `Data.TaggedError` with a **free-form `message: string` as primary data** + `cause: unknown`, and worse, `SshCommandError` carries `command: readonly string[]`, `stderr: string`, `stdout?: string` (and `SshLaunchError`/`SshPairingError` carry `stdout: string`) — exactly the raw command/output leak the spec forbids. Fix = `Schema.TaggedErrorClass`, store `argumentCount`/`stdoutLength`/`stderrLength`, keep raw output only in `cause`.
  ```ts
  export class SshHostDiscoveryError extends Data.TaggedError("SshHostDiscoveryError")<{
    readonly message: string; // ← free-form message-as-data
    readonly cause: unknown; // ← untyped cause
  }> {}
  ```
- **ryco already has the target exemplars.** `packages/effect-acp/src/errors.ts` is essentially spec-perfect: `import * as Schema from "effect/Schema"`, `Schema.TaggedErrorClass`, `cause: Schema.Defect`, derived `message` getters, _legitimate_ `static from*` factories (JSON-RPC error codes). `checkpointing/Errors.ts` and `WorkspacePaths` errors likewise. **The convention is already in-house.**
- **The service-module shape is the big lift, all in `apps/server`.** 92 `Context.Service` decls sit next to ~99 separate `*Shape` interfaces (≈1:1 — almost every service uses the separated-interface anti-pattern), 75 `*Live` layers, 473 consolidated `from "effect"` imports, 313 redundant annotations, and a pervasive **`Services/`+`Layers/` split across 12 subsystems (25 directories)**: `auth`, `checkpointing`, `diagnostics`, `environment`, `observability`, `orchestration`, `persistence`, `project`, `provider`, `remote`, `telemetry`, `terminal`, `workspace`. The spec collapses each pair into one `domain/Foo.ts`.
- **Constructor-wrapper anti-pattern is _moderate_, not huge.** Raw `=> new XError(` (73 in server) is mostly legitimate inline construction. Filtering: **~15 standalone + 2 curried wrappers**, used via **12 `mapError(<bareFn>)` call sites**. That is the real surface to unwind.
- **`mapError`-heavy, `catchTags`-light:** `apps/server` has **489 `mapError`** vs **30 `catchTag`** and **1 `catchTags`** repo-wide. Many `mapError`s legitimately type the channel; the 12 `mapError(wrapperFn)` sites and any `mapError(e => isX(e) ? e : wrap(e))` shapes are what the spec rewrites to `Effect.catchTags`.
- **Raw `throw`/`catch` is mostly _not_ Effect debt.** Of 65 `throw new` in `apps/server`, **≥19 are in `*.test.ts`/`*.integration.test.ts`** and 1 in `scripts/`; sampled real-code throws sit at sync boundaries. `apps/web` (165/163) and `apps/desktop` (50/34) are dominated by React/Electron code **outside** the Effect surface — **do not** count these as conversion debt. (The prior draft's "269 raw throws / 226 catches" as the headline risk is misleading for this reason.)
- **Cause loss occurs even in "good" errors.** e.g. `WorkspacePaths.ts`'s `WorkspaceRootCreateFailedError` is a `Schema.TaggedErrorClass` with **no `cause` field**, dropping the underlying `mkdir`/FS failure. Threading `cause` is a cross-cutting cleanup, not just a legacy-class issue.

### ryco-specific before/after (the canonical target)

`apps/server/src/workspace/{Services,Layers}/WorkspacePaths.ts` today — split across two files, separate `*Shape`, consolidated `from "effect"`, `*Live`:

```ts
// Services/WorkspacePaths.ts (today)
import { Schema, Context } from "effect";
import type { Effect } from "effect";
export interface WorkspacePathsShape {
  /* …methods… */
} // ← separate interface
export class WorkspacePaths extends Context.Service<WorkspacePaths, WorkspacePathsShape>()(
  "ryco/workspace/Services/WorkspacePaths",
) {}
// Layers/WorkspacePaths.ts (today)
import { Effect, FileSystem, Layer, Path } from "effect"; // ← consolidated named import
import {
  WorkspacePaths,
  /*…errors…*/ type WorkspacePathsShape,
} from "../Services/WorkspacePaths.ts";
export const WorkspacePathsLive = Layer.effect(WorkspacePaths, makeWorkspacePaths); // ← *Live, split file
```

```ts
// workspace/WorkspacePaths.ts (spec target — one file)
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
// …errors (Schema.TaggedErrorClass, each with `cause` where it wraps an FS failure)…
export class WorkspacePaths extends Context.Service<WorkspacePaths, {
  readonly normalizeWorkspaceRoot: (…) => Effect.Effect<…>;              // ← inline interface
  readonly resolveRelativePathWithinRoot: (…) => Effect.Effect<…>;
}>()("ryco/workspace/WorkspacePaths") {}
const make = Effect.gen(function* () { /* … */ });
export const layer = Layer.effect(WorkspacePaths, make);                  // ← `layer`, not *Live
```

---

## Step 4 — Recommendation & plan

### Decision: **(B)** — adopt a ryco-authored subset, migrate incrementally, enforce with ryco's tooling.

- **Why not (A) verbatim:** the upstream spec is a _check-run agent prompt_ for pingdotgg's "macroscope" platform (an LLM with `browse_code`/`git_tools`/`modify_pr`). ryco has **no `.macroscope/`**, no macroscope runner, and a different CI (`bun` + `vite-plus`/`vp lint`, **no eslint**). You cannot drop the markdown into `.github/workflows` and have it execute. The _rules_ port; the _runner_ does not.
- **Why not (C):** upstream is now uniform on this style; staying divergent maximizes merge-conflict surface on every future sync, and ryco is already 79% aligned with clean in-house exemplars — cost-to-finish is low and the debuggability/redaction wins are real (the ssh leak alone justifies it).

### Phased plan (server-first by error-surface × user-facing failure)

| Phase | Target                                                                                                                                                 | Tier                | Indicative effort | Rationale                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | Convention doc (this subset) + codify exemplars (`effect-acp`, `WorkspacePaths`) + **advisory** CI guards                                              | **S**               | 1–2 days          | Cheap; stops new legacy before migrating old code                                                                                                                                                                                                                                                              |
| **1** | `packages/ssh` + `packages/tailscale`                                                                                                                  | **S** + **S**       | 1 day + 0.5 day   | Smallest, _fully legacy_, leaf packages; kills the worst anti-pattern + the ssh secret leak. User-facing (remote connect). Zero blast radius                                                                                                                                                                   |
| **2** | `apps/server` **error layer**, sub-package by sub-package                                                                                              | **L**               | ~1 week spread    | Highest error-surface + most user-facing (every RPC failure). Convert 12 `Data.TaggedError`, unwind ~17 wrappers + 12 `mapError(fn)`→`catchTags`, thread missing `cause`, add redaction. **Port upstream diffs where files align:** `sourceControl/` ↔ #3248/#3253, `persistence/` ↔ #3398, `ws`+`rpc` ↔ #3242 |
| **3** | `apps/server` **service shape** (inline `*Shape`, `*Live`→`layer`, merge 25 `Services/`+`Layers/` dirs, namespace imports, drop redundant annotations) | **L**               | ~1–2 weeks spread | Biggest churn **and** highest merge-conflict risk → after errors; cherry-pick upstream's #3187-style refactors per file. Split: **3a** annotations (#3229, low-risk) → **3b** namespace imports → **3c** interface-inline + file merges                                                                        |
| **4** | `shared`, `client-runtime`, `apps/web` (Effect surface only), `apps/desktop`                                                                           | **M** / S           | 2–3 days          | Lower error-surface. **Exclude** React/Electron `throw`/`catch` (out of Effect scope)                                                                                                                                                                                                                          |
| **—** | `contracts`, `effect-acp`, `effect-codex-app-server`                                                                                                   | **S (verify only)** | <1 day            | Already on-target. `contracts` errors are wire/persisted — **freeze unless versioned**. Polish a couple `*Shape` + annotations                                                                                                                                                                                 |

### Effort tiers (summary)

- **S:** `ssh`, `tailscale`, `contracts` (verify), `effect-acp`/`effect-codex-app-server` (polish), `client-runtime`, `desktop`, server Phase-3a annotations.
- **M:** `shared`, `apps/web` (Effect surface).
- **L:** `apps/server` error layer (Phase 2), `apps/server` service shape (Phase 3).

### Risks & mitigations

1. **Merge-conflict surface vs upstream syncs (cuts both ways).** Converging _reduces_ steady-state conflicts, but conversion PRs touch the same files upstream rewrote. → **Port upstream's actual diffs** (#3398/#3248/#3253/#3242/#3187/#3229) where files still correspond; hand-convert only ryco-renamed/ryco-specific code (`@ryco/*`, ryco-only services). Do Phase 3 in small per-subsystem PRs to keep rebases tractable.
2. **Behavior change from error reshaping.** Collapsing/splitting tags or changing `message` is observable via RPC responses, UI, persisted projections (the spec flags caller-visible messages as behavior). → **Preserve caller-visible messages**; never collapse tags that drive control flow; add focused tests around reshaped errors.
3. **Persisted/serialized errors.** ryco is event-sourced (orchestration projections); `contracts` errors cross the wire and may be persisted — changing a `Schema` error shape = a migration. → **Freeze `contracts`/persisted error schemas** unless explicitly versioned.
4. **Dogfood stability.** ryco runs inside Ryco.app daily; large refactors risk the driver. → Incremental, leaf-first, behind tests; never land Phase 2/3 as one mega-PR.
5. **Beta API drift.** ryco is on `effect@4.0.0-beta.59` + `@effect/language-service@0.84.2`; upstream may be on a different beta (note `Schema.Defect` vs `Schema.Defect()`). → Pin and adapt snippets to ryco's beta; don't copy upstream API forms blindly.

### Enforcement: **CI check vs lint rule** — two tiers, neither is the upstream agent

- **The macroscope check-run agent is _not_ runnable in ryco's CI.** No macroscope platform, no `.macroscope/`. Don't try to wire it into GitHub Actions.
- **Tier 1 — deterministic guards (advisory→blocking).** ryco has **no eslint** (uses `vp lint`) but **does** wire `@effect/language-service` as a tsconfig plugin (`apps/server/tsconfig.json`). Use:
  - `@effect/language-service` diagnostics (floating effects / missing error handling) surfaced in `typecheck`.
  - A small **CI grep/AST guard** (added to the existing `pull-request-validation.yml`) over _changed_ files for black-and-white rules: ban new `Data.TaggedError` (prefer `Schema.TaggedErrorClass`); ban `*Live` layer names; ban a `message:` _field_ on a `TaggedError` (must be a getter); ban consolidated `from "effect"` in service modules; flag `Effect.tryPromise` without `catch`. **Advisory** first; flip to **blocking per-package** as each is converted (so legacy code doesn't fail CI before its phase).
- **Tier 2 — Claude PR review (the faithful analog).** Reimplement `effect-service-conventions.md` as a ryco `/code-review`-style prompt scoped to changed `.ts`. ryco already dogfoods Claude/Ryco.app, so an LLM review step is natural and low-lift — it captures the judgment rules deterministic guards can't (cause preservation, redaction, no-constructor-wrapper, tag-vs-discriminator modeling). Keep it **comment-only** initially; this mirrors exactly what upstream does, without needing macroscope.

### Decision checkpoints (confirm before implementing)

- [ ] Maintainers accept the two-tier enforcement (guards + Claude review) over replicating the macroscope agent.
- [ ] Scope locked to Phase 0→1 first (`ssh`, `tailscale`); no mid-migration scope creep.
- [ ] Decision on where Tier-1 guards live (a `vp lint` plugin, a standalone script in `pull-request-validation.yml`, or a `vitest` guard).
- [ ] `contracts`/persisted error schemas confirmed frozen (or a versioning plan exists) before any error reshaping.

---

## Appendix — method & caveats

**Provenance:** spec via `gh api repos/pingdotgg/t3code/contents/.macroscope/check-run-agents/effect-service-conventions.md --jq '.content' | base64 -d`. Diffs via `gh pr diff <N> -R pingdotgg/t3code` for #3398, #3253, #3248, #3242, #3426, #3187, #3185, #3229.

**Audit commands (representative):**

```
rg -c 'Data\.TaggedError\('                <dir>   # legacy error defs
rg -c 'Schema\.TaggedErrorClass'           <dir>   # target error defs
rg -c 'extends Context\.Service'           <dir>   # service declarations
rg -c 'export (interface|type) \w+Shape\b' <dir>   # separate-interface anti-pattern
rg -c 'export const \w+Live\b'             <dir>   # *Live layers
rg -c 'from "effect"'                      <dir>   # consolidated named imports
rg -c 'import \* as \w+ from "effect/'     <dir>   # namespace subpath imports
rg -c ': (Effect\.Effect|Layer\.Layer)<'   <dir>   # redundant annotations
rg -c 'Effect\.mapError'                   <dir>
rg -c 'Effect\.tryPromise\('               <dir>   # minus '...\(\{' = no-catch (bare) form
find apps/server -type d \( -name Services -o -name Layers \)   # 25 split dirs / 12 subsystems
```

**Caveats (counts are signals, not exact debt):**

- Occurrence counts include references and test files. `throw new`/`} catch` in `apps/web`/`apps/desktop` is mostly React/Electron, **not** Effect debt; ≥19/65 server `throw new` are tests.
- `from "effect"` (consolidated) and `import * as X from "effect/Sub"` are counted separately; `@effect/*` package imports are excluded.
- `=> new XError(` over-counts the wrapper anti-pattern (most are legit inline construction); true surface ≈ 15 standalone + 2 curried + 12 `mapError(fn)` sites.
- `*Shape` raw occurrence count (230 in server) includes type-only import references; **definition** count is ~99.
- `tryPromise` no-catch = the single-arg (bare) form only (→ `UnknownException`); object-form `tryPromise({ try, catch })` is counted as typed.
- ryco shell is `zsh` — per-directory loops must use literal lists or `${=VAR}` (unquoted `$VAR` does not word-split).

**Note on the prior draft:** an earlier untracked `effect-conventions-adoption.md` appeared mid-session (a Ryco.app dogfood concurrency artifact — `/Users/laurinfrank/Dropbox` and the CloudStorage path share one `.git`). It reached the same (B) recommendation; it is preserved verbatim at `.docs/effect-conventions-adoption.prior-draft.md` and superseded by this version.

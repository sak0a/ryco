# Effect Service Conventions Adoption Analysis

**Date:** 2026-06-29  
**Status:** RECOMMENDATION DOCUMENT — Do not implement without approval  
**Recommendation:** **(B) Adopt a lighter, ryco-specific subset with phased migration**

---

## Executive Summary

Upstream t3code adopted structured Effect conventions across ~200 PRs (2026-06-20 to 06-21) enforced by a CI check-run agent. Ryco is also Effect-based but diverged before most of this landed. A full adoption of the upstream `.macroscope` convention is **not practical** for ryco due to:

1. **Tooling divergence**: t3code uses `pnpm` + standard Node CI; ryco uses `bun` + custom vite-plus tooling + Ryco.app runtime
2. **Scale mismatch**: t3code's check-run agent is cloud-based; ryco's CI is local
3. **Implementation gaps**: ryco has raw throws (269), loose catch blocks (226 instances), and mixed error patterns (119 TaggedErrorClass, 25 Data.TaggedError, 4 plain Error classes)

**Go forward with:** a tailored, lint-rule-driven subset (error naming, cause preservation, service shape) that ryco can enforce and incrementally migrate to, starting with high-error-surface packages.

---

## Part 1: Canonical Upstream Spec (Extracted)

### Imports and Module Namespaces
- **Rule:** Import Effect subpaths as namespaces: `import * as Effect from "effect/Effect"`, `import * as Layer from "effect/Layer"`
- **Service boundaries:** Import local services as namespaces: `import * as WorkspacePaths from "./WorkspacePaths.ts"` → use `WorkspacePaths.WorkspacePaths`, `WorkspacePaths.make`, `WorkspacePaths.layer`
- **Avoid:** Named imports like `import { layer as workspacePathsLayer }` that erase the namespace shape
- **Exception:** Named imports are fine for whole packages (`@t3tools/contracts`) and standalone helpers/types

### Error Definitions (Core)
- **Use `Schema.TaggedErrorClass`** with structured attributes; derive `message` from those attributes only
- **Preserve cause chains:** Pass underlying errors as `cause` alongside structural fields. Make `cause` required when every construction wraps a failure, optional only when the same error can legitimately originate without an underlying failure
- **No tautological details:** Do not copy `cause.message` into a `detail` field and then use it to construct the message. Example—**bad**:
  ```ts
  new PersistenceSqlError({
    operation: "foo",
    detail: error.message,  // redundant copy
    cause: error,
  });
  // message: `SQL error in ${this.operation}: ${this.detail}` // repeats cause
  ```
  **Good:**
  ```ts
  new PersistenceSqlError({
    operation: "foo",
    cause: error,  // keep original
  });
  // message: `SQL error in ${this.operation}` // stable, no copy
  ```
- **Avoid secret leaks:** Do not copy wire payloads, command args, signed URLs, credentials, query strings into error fields. Preserve only as `cause`; expose normalized categories and safe metadata (lengths, protocol, hostname)
- **Static factories with real logic:** Keep error-mapping helpers only when they normalize, pass through domain errors, or add reusable context. Example—**good**:
  ```ts
  static fromSchemaError(operation: string, cause: Schema.SchemaError): PersistenceDecodeError {
    return new PersistenceDecodeError({
      operation,
      issue: summarizeSchemaIssue(cause.issue),  // normalization
      cause,
    });
  }
  ```
- **Catch tagged errors structurally:** Use `Effect.catchTags({ MyError: handler, ... })` instead of `catchIf` with schema predicates or `catchTag`
- **Error class taxonomy:** Split semantically distinct failures into separate classes when a discriminator field drives user-facing messages or control flow. Use one class with a multi-value `operation` field only when failures share identical semantics

### Service Definition
- **Canonical order:** Imports → error/schema declarations → `Context.Service` tag (with inline interface) → `make` → `layer`
- **Inline interface:** Define the service interface directly in the `Context.Service` declaration; remove standalone `FooShape` types
- **Refer to service type as `Foo["Service"]`** in tests, MCP, and orchestration
- **Real `make` exports:** Export a true constructor when the module owns construction; do not create `make = Effect.succeed(...)` just to force `Layer.effect`
- **Layer export:** Export the canonical layer as `export const layer = Layer...`. Use `Layer.succeed`, `Layer.scoped`, or another appropriate constructor; `Layer.effect` is not required

### File Layout and Migrations
- **Hoist from split modules:** Combine `domain/Services/Foo.ts` and `domain/Layers/Foo.ts` into `domain/Foo.ts`
- **Delete old files:** Do not leave re-export shims; mechanically update every consumer (orchestration, MCP, tests, integrations)
- **Preserve documentation:** Keep useful comments, invariants, and specification docs while moving code
- **Avoid unnecessary testing:** Do not require large new tests for mechanical refactors; update existing tests as needed

---

## Part 2: Representative Before/After Patterns

### Pattern 1: Removing Error Constructor Wrappers (PR #3398)

**Before:**
```ts
// Errors.ts
export function toPersistenceSqlError(operation: string) {
  return (cause: unknown): PersistenceSqlError =>
    new PersistenceSqlError({
      operation,
      detail: `Failed to execute ${operation}`,  // Tautological copy
      cause,
    });
}

// Usage: mapError(toPersistenceSqlError("query"))
```

**After:**
```ts
// Errors.ts
export class PersistenceSqlError extends Schema.TaggedErrorClass<PersistenceSqlError>()(
  "PersistenceSqlError",
  {
    operation: Schema.String,
    detail: Schema.optional(Schema.String),  // Now optional
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail === undefined
      ? `SQL error in ${this.operation}`
      : `SQL error in ${this.operation}: ${this.detail}`;
  }
}

// Usage: new PersistenceSqlError({ operation: "query", cause })
```

**Key change:** Direct instantiation at the failure site preserves cause and operation. No wrapper function, no tautological detail copy.

---

### Pattern 2: Enriching Errors with Cause Preservation (PR #3253)

**Before:**
```ts
function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): AuthPairingLinkRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)  // Curried wrapper
      : toPersistenceSqlError(sqlOperation)(cause);
}
```

**After:**
```ts
function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): AuthPairingLinkRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
      : new PersistenceSqlError({ operation: sqlOperation, cause });
}

// Static factory with real logic:
static fromSchemaError(operation: string, cause: Schema.SchemaError): PersistenceDecodeError {
  return new PersistenceDecodeError({
    operation,
    issue: summarizeSchemaIssue(cause.issue),  // Normalizes nested schema issues
    cause,
  });
}
```

**Key change:** Named static factories at the error class replace curried functions. Factories perform real normalization (schema issue summarization) and are visibly attached to the error type.

---

### Pattern 3: Preventing Secret Leaks (PR #3242, #3426)

**Before:**
```ts
// Dangerous: copies command arguments and stderr into error
const error = yield* driver.execute({
  operation: "test",
  cwd,
  args: ["status", `--token=${secret}`],  // Exposed later if error occurs
}).pipe(Effect.flip);
```

**After (test from upstream):**
```ts
it.effect("does not retain git arguments or stderr in command failures", () =>
  Effect.gen(function* () {
    const secret = "secret-token-value";
    const error = yield* driver.execute({
      operation: "GitVcsDriver.test.redactedFailure",
      cwd,
      args: ["status", `--unknown-option=${secret}`],
    }).pipe(Effect.flip);

    // Verify: no `args` or `stderr` properties exposed in error
    assert.notProperty(error, "args");
    assert.notProperty(error, "stderr");
    assert.notInclude(error.detail, secret);
    assert.notInclude(error.message, secret);
  }),
);

// Error structure:
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()(
  "GitCommandError",
  {
    operation: Schema.String,
    command: Schema.String,
    argumentCount: Schema.Number,  // Safe: count, not args
    cwd: Schema.String,
    detail: Schema.optional(Schema.String),
    stderrLength: Schema.optional(Schema.Number),  // Safe: length, not content
    exitCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
```

**Key change:** Error fields store only safe metadata (lengths, paths, operation names). Secrets and raw command output remain in `cause` only, not exposed in diagnostics.

---

## Part 3: Ryco Audit

### Current State Snapshot

| Metric | Count | Notes |
|--------|-------|-------|
| **Effect.try\*** calls | 84 | Untyped catch risk; many lack `.mapError` |
| **TaggedErrorClass (Schema)** | 94 | Adoption present but inconsistent |
| **TaggedError (Data)** | 25 | ssh, packages; mixed with Schema usage |
| **Plain Error classes** | 4 | Outliers; should consolidate |
| **Raw `throw new`** | 269 | Main risk; scattered throughout code |
| **Raw `} catch`** | 226 | Mixing try-catch with Effect code |
| **Context.Service definitions** | 98 | Good: service pattern is widespread |
| **Old `Services/` directories** | 13 | Pre-migration structure lingering |

### Package-by-Package Analysis

#### **apps/server** (Highest Error Surface)
- **Error wrappers:** 7 error modules, 80+ curried factory functions
- **State:** Persistence errors use TaggedErrorClass; provider/orchestration errors are partially structured
- **Gaps:** Many catch blocks lack typed handlers; raw throws in source control, git layers
- **Priority:** **HIGH** — persistence has tight error contracts; orchestration is critical path

#### **packages/ssh** (Medium-High)
- **Error style:** Mixed — uses `Data.TaggedError` with unstructured `message` field
- **State:** `SshCommandError` stores full stderr + command (secret leak risk)
- **Gaps:** No cause chain preservation; no schema validation
- **Priority:** **MEDIUM** — isolated module; lower risk to users; good refactor candidate

#### **packages/effect-acp** (Medium)
- **Error style:** Schema.TaggedErrorClass with static factories (`fromProtocolError`, `parseError`, etc.)
- **State:** Well-structured; cause preservation present in most errors
- **Gaps:** No external spec review; some factory methods could be tightened
- **Priority:** **MEDIUM** — already aligned; needs light audit for cause/secret handling

#### **packages/effect-codex-app-server** (Low-Medium)
- **Error style:** Untyped errors module
- **State:** Single error module, not yet reviewed
- **Priority:** **LOW** — appears simple; defer until bigger modules settle

#### **apps/web, apps/desktop**
- **Error handling:** Not deeply Effect-based; UI error handling is separate concern
- **State:** Minimal Effect services
- **Priority:** **DEFERRED** — focus on server/packages first

---

## Part 4: Recommendation

### **Go/No-Go Decision: (B) Adopt a lighter, ryco-specific subset**

**Rationale:**
- t3code's `.macroscope` check-run agent is a cloud-based Anthropic AI agent enforcing rules on PR diffs. ryco's CI (bun + vite-plus in Ryco.app) cannot easily run that binary.
- Re-implementing the full agent as a lint rule is high effort and would duplicate upstream work.
- **However:** The *principles* behind t3code's conventions (structured errors, cause preservation, no secret leaks, service shape) are sound and directly applicable to ryco.

**Adoption Approach:**

#### Phase 1: Lightweight Lint-Rule Foundation (Effort: **S**)
- Author a simple ESLint plugin or lint rule that catches:
  - Unguarded `Effect.tryPromise` / `Effect.try` without `.mapError` or `.catch`
  - Error classes without `cause` field
  - Raw `throw new Error()` in Effect contexts (flag, don't auto-fix)
  - Service imports with aliases erasing the namespace (e.g., `import { layer as workspacePathsLayer }`)
- **Does NOT** replicate the full check-run logic; focuses on mechanical, low-false-positive signals
- **Deployment:** Integrate into CI as a `vitest` or `eslint` hook; fail on warnings

#### Phase 2: High-Error-Surface Migrations (Effort: **M** per package, start with 2)
1. **apps/server/persistence** (Error.ts + Services/*)
   - Eliminate tautological `detail` fields
   - Convert curried error wrappers → direct construction + static factories
   - Preserve cause chains uniformly
   - Update all callers in repository implementations
   - **Estimated effort:** 1–2 dev-days; high test coverage (existing)

2. **packages/ssh** (errors.ts + all usages)
   - Unify on Schema.TaggedErrorClass
   - Remove secret leaks: replace full `stderr`/`command` with lengths and safe metadata
   - Add cause preservation where missing
   - **Estimated effort:** 1 dev-day; good candidate for early win

3. **apps/server/provider** (provider errors + adapters)
   - Similar to persistence; lower call-site density
   - **Estimated effort:** 1–2 dev-days

#### Phase 3: Remaining Packages (Effort: **M–L**)
- **packages/effect-acp:** Light audit; mostly aligned; tighten secret handling
- **apps/server/orchestration, checkpointing, sourceControl:** Batch migrations once tools settle
- **apps/web, apps/desktop:** Deferred; UI error handling is separate concern

### Implementation Timeline

| Phase | Packages | Effort | Owner | Timeline |
|-------|----------|--------|-------|----------|
| **1** | Lint rules (all) | S | 1 person | 1–2 days |
| **2a** | apps/server/persistence | M | 1–2 people | 2–3 days |
| **2b** | packages/ssh | S | 1 person | 1 day |
| **2c** | apps/server/provider | M | 1 person | 1–2 days |
| **3** | Remaining (acp, orchestration, sourceControl) | L | ongoing | 1 week spread |

---

## Part 5: Risks & Mitigations

### Risk: Merge Conflict Surface

**Concern:** Ryco's error modules are imported by many services. Broad structural changes could cause merge conflicts with in-flight PRs.

**Mitigation:**
- **Phase in:** Start with isolated packages (ssh) before touching persistence
- **Parallel branches:** If multiple teams are working, use short-lived feature branches
- **Communicate:** Announce error refactor windows; batch PRs

### Risk: Behavior Changes from Error Reshaping

**Concern:** Removing `detail` fields or restructuring cause chains could break upstream consumers or API contracts.

**Mitigation:**
- **Audit call sites:** Before refactoring, check how each error is caught and logged
- **Preserve user-facing messages:** If a user-visible message changes, update tests to match
- **Test first:** Expand test coverage for error cases before refactoring

### Risk: Upstream Divergence on Tooling

**Concern:** t3code's check-run agent is not runnable in ryco due to bun + vite-plus differences.

**Mitigation:**
- **Do not port the agent.** Instead:
  - Implement lint rules that cover ~80% of the check-run logic (mechanical patterns)
  - Defer sophisticated analysis (multi-file context, orchestration validation) to code review
  - Treat lint rules as a guardrail, not as a replica of upstream CI

### Risk: Incomplete Migration (Legacy Code Lingering)

**Concern:** After phased migration, some modules may still use old patterns.

**Mitigation:**
- **Lint enforcement:** Lint rules block new violations, preventing regression
- **Tracking:** Maintain a `MIGRATION_STATUS.md` file listing which packages are done
- **Code review:** Flag legacy patterns in PR review; prioritize cleanup over new features

---

## Part 6: Enforcement Strategy

### Lint Rules (Automated, CI-Blocking)

1. **`no-untyped-tryPromise`**: Effect.tryPromise/try without .catch/mapError → warn
2. **`no-bare-throw-in-effect`**: raw throw in Effect context → warn
3. **`service-import-aliases`**: import { layer as X } from service → warn
4. **`error-missing-cause`**: TaggedErrorClass without cause field → warn
5. **`error-detail-redundancy`**: detail field that copies cause.message → warn (may false-positive; use sparingly)

### Code Review (Manual Checks)

- Upstream error chain preservation in catch/mapError handlers
- Ensure static error factories are used instead of curried wrappers
- Spot-check for secret leaks (URLs, credentials, raw wire payloads in error fields)

### Testing

- Existing test suites for error modules should remain and expand (e.g., `Errors.test.ts` for each module)
- Test that cause chains are preserved end-to-end
- Test that secret-sensitive errors do not leak data

---

## Part 7: Decision Checkpoints

Before proceeding to implementation, confirm:

- [ ] **Team agreement:** Lint-rule approach is acceptable to ryco maintainers (vs. full check-run agent replication)
- [ ] **Scope locked:** Start with persistence + ssh; do not expand scope mid-migration
- [ ] **Test coverage sufficient:** Existing error tests cover the surface area; no major test gaps
- [ ] **Timeline feasible:** 1–2 weeks of focused work is available; no conflicting roadmap items
- [ ] **Tooling decision:** Will lint rules be integrated into vite-plus, a standalone eslint config, or a custom script?

---

## Conclusion

Adopt upstream t3code's **principles** (structured errors, cause preservation, no secret leaks) via a **tailored, lint-driven subset** rather than porting the full check-run agent. Start with high-error-surface packages (persistence, ssh), measure adoption, and roll forward incrementally. This balances t3code's rigor with ryco's tooling constraints and reduces the risk of breaking changes.

**Next step:** Convene with team to confirm approach, then spike Phase 1 lint rules in a feature branch.

/**
 * ClaudeModelManifest — allowlisted adapter payloads for the Claude entries
 * of `model-manifest.json`.
 *
 * The generic manifest treats `adapter` fields as opaque; this module gives
 * them a Claude-specific shape:
 *
 *   - profile adapters carry runtime behavior shared by models on a profile
 *     (CLI effort remapping, api-model-id suffixes, context-window token
 *     tables — the token tables are currently unused by Ryco, which reads
 *     window sizes from runtime usage events, but stay in the format so the
 *     file remains interchangeable with upstream t3code manifests);
 *   - model adapters carry Claude Code CLI version compatibility gates.
 *
 * Ported from pingdotgg/t3code (PR #9084), adapted to Ryco's CLI-version
 * helpers.
 */
import { Option, Schema } from "effect";
import { TrimmedNonEmptyString } from "@ryco/contracts";

import { compareCliVersions, isParseableCliVersion } from "./cliVersion.ts";

export const ClaudeCodeProfileSchema = Schema.Struct({
  /**
   * Maps a resolved effort selection onto the value passed to the Claude CLI.
   * `null` means "pass no effort flag" for that selection.
   */
  effortMap: Schema.optional(
    Schema.Record(TrimmedNonEmptyString, Schema.NullOr(TrimmedNonEmptyString)),
  ),
  /** Per-option-value api-model-id suffixes, e.g. `{ contextWindow: { "1m": "[1m]" } }`. */
  modelSuffixes: Schema.optional(
    Schema.Record(
      TrimmedNonEmptyString,
      Schema.Record(TrimmedNonEmptyString, TrimmedNonEmptyString),
    ),
  ),
  contextWindowTokens: Schema.optional(Schema.Record(TrimmedNonEmptyString, Schema.Number)),
  fixedContextWindowTokens: Schema.optional(Schema.Number),
});

export const ClaudeProfileAdapterSchema = Schema.Struct({
  claudeCode: Schema.optional(ClaudeCodeProfileSchema),
});

const ClaudeVersionSchema = TrimmedNonEmptyString.pipe(
  Schema.check(
    Schema.makeFilter((version) => isParseableCliVersion(version), {
      expected: "a supported semantic version",
    }),
  ),
);

const ClaudeCodeCompatibilitySchema = Schema.Struct({
  minVersion: Schema.optional(ClaudeVersionSchema),
  maxVersionExclusive: Schema.optional(ClaudeVersionSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      ({ minVersion, maxVersionExclusive }) =>
        minVersion === undefined ||
        maxVersionExclusive === undefined ||
        compareCliVersions(minVersion, maxVersionExclusive) < 0,
      { expected: "a minimum version below the exclusive maximum version" },
    ),
  ),
);

export const ClaudeModelAdapterSchema = Schema.Struct({
  claudeCode: Schema.optional(ClaudeCodeCompatibilitySchema),
});

export type ClaudeCodeProfile = typeof ClaudeCodeProfileSchema.Type;
export type ClaudeCodeCompatibility = NonNullable<typeof ClaudeModelAdapterSchema.Type.claudeCode>;

export const decodeClaudeProfileAdapter = Schema.decodeUnknownOption(ClaudeProfileAdapterSchema);
export const decodeClaudeModelAdapter = Schema.decodeUnknownOption(ClaudeModelAdapterSchema);

interface ClaudeManifestAdapterInput {
  readonly providers?:
    | Readonly<
        Record<
          string,
          | {
              readonly profiles: Readonly<Record<string, { readonly adapter?: unknown }>>;
              readonly models: ReadonlyArray<{ readonly adapter?: unknown }>;
            }
          | undefined
        >
      >
    | undefined;
}

/**
 * Manifest-level validation hook: a manifest whose Claude adapter payloads do
 * not decode is rejected wholesale, so a bad remote edit falls back to the
 * bundled manifest instead of silently dropping runtime behavior.
 */
export function hasValidClaudeManifestAdapters(manifest: ClaudeManifestAdapterInput): boolean {
  const catalog = manifest.providers?.claudeAgent;
  if (!catalog) return true;

  return (
    Object.values(catalog.profiles).every((profile) =>
      Option.isSome(decodeClaudeProfileAdapter(profile.adapter ?? {})),
    ) &&
    catalog.models.every((model) => Option.isSome(decodeClaudeModelAdapter(model.adapter ?? {})))
  );
}

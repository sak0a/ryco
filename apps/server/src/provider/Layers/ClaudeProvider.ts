import {
  type ClaudeSettings,
  type ModelCapabilities,
  type ModelSelection,
  ProviderDriverKind,
  type ServerProviderModel,
  type ServerProviderRateLimits,
  type ServerProviderSlashCommand,
} from "@ryco/contracts";
import { Effect, Option, Path, Result } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import {
  createModelCapabilities,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@ryco/shared/model";
import {
  query as claudeQuery,
  type SlashCommand as ClaudeSlashCommand,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  buildBooleanOptionDescriptor,
  buildSelectOptionDescriptor,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { compareCliVersions } from "../cliVersion.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";

const DEFAULT_CLAUDE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const PROVIDER = ProviderDriverKind.make("claudeAgent");
const CLAUDE_PRESENTATION = {
  displayName: "Claude",
  showInteractionModeToggle: true,
  supportsAskMode: true,
} as const;
const MINIMUM_CLAUDE_OPUS_5_VERSION = "2.1.219";
const MINIMUM_CLAUDE_OPUS_4_8_VERSION = "2.1.154";
const MINIMUM_CLAUDE_OPUS_4_7_VERSION = "2.1.111";
// Forward-looking gate: Claude Fable 5 is wired up but not yet selectable in
// the Claude Code CLI. Hidden on the current CLI (~2.1.193) and set to surface
// on the next release so it appears as soon as Fable support could land. UPDATE
// to the exact minimum version once Anthropic confirms it, so Fable isn't
// offered on a CLI that can't accept the model.
const MINIMUM_CLAUDE_FABLE_5_VERSION = "2.1.194";

type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode" | "ultrathink";

function buildClaudeEffortOption(value: ClaudeEffortLevel, defaultEffort: ClaudeEffortLevel) {
  const label =
    value === "xhigh" ? "Extra High" : value[0]!.toUpperCase() + value.slice(1).toLowerCase();
  return value === defaultEffort ? { value, label, isDefault: true } : { value, label };
}

function buildClaudeEffortDescriptor(input: {
  readonly levels: ReadonlyArray<ClaudeEffortLevel>;
  readonly defaultEffort: ClaudeEffortLevel;
}) {
  const promptInjectedValues = input.levels.includes("ultrathink") ? ["ultrathink"] : undefined;
  return buildSelectOptionDescriptor({
    id: "effort",
    label: "Reasoning",
    options: input.levels.map((level) => buildClaudeEffortOption(level, input.defaultEffort)),
    ...(promptInjectedValues ? { promptInjectedValues } : {}),
  });
}

function buildClaudeContextWindowDescriptor(defaultContextWindow: "200k" | "1m" = "200k") {
  return buildSelectOptionDescriptor({
    id: "contextWindow",
    label: "Context Window",
    options: [
      { value: "200k", label: "200k", isDefault: defaultContextWindow === "200k" },
      { value: "1m", label: "1M", isDefault: defaultContextWindow === "1m" },
    ],
  });
}

function buildClaudeOpusCapabilities(input: {
  readonly effortLevels: ReadonlyArray<ClaudeEffortLevel>;
  readonly defaultEffort: ClaudeEffortLevel;
  readonly supportsFastMode: boolean;
  readonly supportsContextWindow: boolean;
  readonly defaultContextWindow?: "200k" | "1m";
}) {
  return createModelCapabilities({
    optionDescriptors: [
      buildClaudeEffortDescriptor({
        levels: input.effortLevels,
        defaultEffort: input.defaultEffort,
      }),
      ...(input.supportsFastMode
        ? [
            buildBooleanOptionDescriptor({
              id: "fastMode",
              label: "Fast Mode",
            }),
          ]
        : []),
      ...(input.supportsContextWindow
        ? [buildClaudeContextWindowDescriptor(input.defaultContextWindow)]
        : []),
    ],
  });
}

const CLAUDE_OPUS_ADAPTIVE_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
] as const satisfies ReadonlyArray<ClaudeEffortLevel>;

const CLAUDE_OPUS_4_8_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultrathink",
] as const satisfies ReadonlyArray<ClaudeEffortLevel>;

const CLAUDE_OPUS_LEGACY_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "max",
] as const satisfies ReadonlyArray<ClaudeEffortLevel>;

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-fable-5",
    name: "Claude Fable 5",
    shortName: "Fable 5",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_ADAPTIVE_EFFORT_LEVELS,
      defaultEffort: "high",
      // Fast mode is an Opus-tier feature; Fable does not support it.
      supportsFastMode: false,
      // Fable's context window is 1M by default and at maximum, so there is no
      // 200k/1m toggle to expose.
      supportsContextWindow: false,
    }),
  },
  {
    slug: "claude-opus-5",
    name: "Claude Opus 5",
    shortName: "Opus 5",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_4_8_EFFORT_LEVELS,
      defaultEffort: "high",
      supportsFastMode: true,
      supportsContextWindow: true,
      defaultContextWindow: "1m",
    }),
  },
  {
    slug: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    shortName: "Opus 4.8",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_4_8_EFFORT_LEVELS,
      defaultEffort: "high",
      supportsFastMode: true,
      supportsContextWindow: true,
    }),
  },
  {
    slug: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    shortName: "Opus 4.7",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_ADAPTIVE_EFFORT_LEVELS,
      defaultEffort: "xhigh",
      supportsFastMode: true,
      supportsContextWindow: true,
    }),
  },
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    shortName: "Opus 4.6",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: [...CLAUDE_OPUS_LEGACY_EFFORT_LEVELS, "ultrathink"],
      defaultEffort: "high",
      supportsFastMode: true,
      supportsContextWindow: true,
    }),
  },
  {
    slug: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    shortName: "Opus 4.5",
    isCustom: false,
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_LEGACY_EFFORT_LEVELS,
      defaultEffort: "high",
      // Fast mode is only available on Opus 4.6 and newer; 4.5 predates it.
      supportsFastMode: false,
      supportsContextWindow: false,
    }),
  },
  {
    slug: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    shortName: "Sonnet 5",
    isCustom: false,
    // Sonnet 5 is the first Sonnet-tier model with the full adaptive effort
    // range (including xhigh/max) and a 1M context window. It does not support
    // fast mode, which stays Opus-only.
    capabilities: buildClaudeOpusCapabilities({
      effortLevels: CLAUDE_OPUS_ADAPTIVE_EFFORT_LEVELS,
      defaultEffort: "high",
      supportsFastMode: false,
      supportsContextWindow: true,
    }),
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    shortName: "Sonnet 4.6",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildSelectOptionDescriptor({
          id: "effort",
          label: "Reasoning",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High", isDefault: true },
            { value: "ultrathink", label: "Ultrathink" },
          ],
          promptInjectedValues: ["ultrathink"],
        }),
        buildSelectOptionDescriptor({
          id: "contextWindow",
          label: "Context Window",
          options: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        }),
      ],
    }),
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    shortName: "Haiku 4.5",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        buildBooleanOptionDescriptor({
          id: "thinking",
          label: "Thinking",
        }),
      ],
    }),
  },
];

function supportsMinimumClaudeVersion(
  version: string | null | undefined,
  minimumVersion: string,
): boolean {
  return version ? compareCliVersions(version, minimumVersion) >= 0 : false;
}

function supportsClaudeOpus48(version: string | null | undefined): boolean {
  return supportsMinimumClaudeVersion(version, MINIMUM_CLAUDE_OPUS_4_8_VERSION);
}

function supportsClaudeOpus5(version: string | null | undefined): boolean {
  return supportsMinimumClaudeVersion(version, MINIMUM_CLAUDE_OPUS_5_VERSION);
}

function supportsClaudeOpus47(version: string | null | undefined): boolean {
  return supportsMinimumClaudeVersion(version, MINIMUM_CLAUDE_OPUS_4_7_VERSION);
}

function supportsClaudeFable5(version: string | null | undefined): boolean {
  return supportsMinimumClaudeVersion(version, MINIMUM_CLAUDE_FABLE_5_VERSION);
}

function getBuiltInClaudeModelsForVersion(
  version: string | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  return BUILT_IN_MODELS.filter((model) => {
    if (model.slug === "claude-fable-5") {
      return supportsClaudeFable5(version);
    }
    if (model.slug === "claude-opus-5") {
      return supportsClaudeOpus5(version);
    }
    if (model.slug === "claude-opus-4-8") {
      return supportsClaudeOpus48(version);
    }
    if (model.slug === "claude-opus-4-7") {
      return supportsClaudeOpus47(version);
    }
    return true;
  });
}

function formatClaudeUpgradeMessages(version: string | null): ReadonlyArray<string> {
  const versionLabel = version ? `v${version}` : "the installed version";
  const messages: Array<string> = [];
  // Claude Fable 5 is intentionally omitted here: it is gated on a placeholder
  // version (see MINIMUM_CLAUDE_FABLE_5_VERSION) and not yet released, so we
  // don't nudge users to upgrade for it. Add a message once the version is real.
  if (!supportsClaudeOpus47(version)) {
    messages.push(
      `Claude Code ${versionLabel} is too old for Claude Opus 4.7. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_7_VERSION} or newer to access it.`,
    );
  }
  if (!supportsClaudeOpus48(version)) {
    messages.push(
      `Claude Code ${versionLabel} is too old for Claude Opus 4.8. Upgrade to v${MINIMUM_CLAUDE_OPUS_4_8_VERSION} or newer to access it.`,
    );
  }
  if (!supportsClaudeOpus5(version)) {
    messages.push(
      `Claude Code ${versionLabel} is too old for Claude Opus 5. Upgrade to v${MINIMUM_CLAUDE_OPUS_5_VERSION} or newer to access it.`,
    );
  }
  return messages;
}

export function getClaudeModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_CLAUDE_MODEL_CAPABILITIES
  );
}

export function resolveClaudeEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const descriptors = getProviderOptionDescriptors({
    caps,
    ...(raw ? { selections: [{ id: "effort", value: raw }] } : {}),
  });
  const effortDescriptor = descriptors.find((descriptor) => descriptor.id === "effort");
  const value = getProviderOptionCurrentValue(effortDescriptor);
  return typeof value === "string" ? value : undefined;
}

/**
 * Normalize a resolved Claude effort value into one suitable for the Claude
 * CLI's `--effort` flag.
 *
 * Mirrors the mapping used when invoking the Claude Agent SDK
 * ({@link getEffectiveClaudeAgentEffort} in ClaudeAdapter): `"ultracode"`
 * is paired with the Claude Code settings flag and normalized to `"xhigh"`,
 * while `"ultrathink"` is filtered out because it is a prompt-prefix mode.
 * Returns `undefined` when no flag should be passed.
 */
export function normalizeClaudeCliEffort(
  effort: string | null | undefined,
  model?: string | null | undefined,
): string | undefined {
  if (!effort || effort === "ultrathink") {
    return undefined;
  }
  if (effort === "ultracode") {
    return model === "claude-opus-5" || model === "claude-opus-4-8" ? "xhigh" : undefined;
  }
  return effort;
}

export function isClaudeUltracodeEffort(effort: string | null | undefined): boolean {
  return effort === "ultracode";
}

export function resolveClaudeContextWindow(
  modelSelection: ModelSelection | undefined,
): string | undefined {
  const caps = getClaudeModelCapabilities(modelSelection?.model);
  const raw = getModelSelectionStringOptionValue(modelSelection, "contextWindow");
  const descriptors = getProviderOptionDescriptors({
    caps,
    ...(raw ? { selections: [{ id: "contextWindow", value: raw }] } : {}),
  });
  const descriptor = descriptors.find((candidate) => candidate.id === "contextWindow");
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : undefined;
}

export function resolveClaudeApiModelId(modelSelection: ModelSelection): string {
  switch (resolveClaudeContextWindow(modelSelection)) {
    case "1m":
      return `${modelSelection.model}[1m]`;
    default:
      return modelSelection.model;
  }
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function claudeSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "claudemaxsubscription":
      return "Max";
    case "claudemax5xsubscription":
      return "Max 5x";
    case "claudemax20xsubscription":
      return "Max 20x";
    case "claudeenterprisesubscription":
      return "Enterprise";
    case "claudeteamsubscription":
      return "Team";
    case "claudeprosubscription":
      return "Pro";
    case "claudefreesubscription":
      return "Free";
    case "max":
    case "maxplan":
      return "Max";
    case "max5":
      return "Max 5x";
    case "max20":
      return "Max 20x";
    case "enterprise":
      return "Enterprise";
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function normalizeClaudeAuthMethod(authMethod: string | undefined): string | undefined {
  const normalized = authMethod?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;
  if (
    normalized === "apikey" ||
    normalized === "anthropicapikey" ||
    normalized === "anthropicauthtoken"
  ) {
    return "apiKey";
  }
  return undefined;
}

function formatClaudeSubscriptionAuthLabel(subscriptionType: string): string {
  const subscriptionLabel =
    claudeSubscriptionLabel(subscriptionType) ?? toTitleCaseWords(subscriptionType);
  const normalized = subscriptionLabel.toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized.startsWith("claude") && normalized.endsWith("subscription")) {
    return subscriptionLabel;
  }
  if (normalized.startsWith("claude")) {
    return `${subscriptionLabel} Subscription`;
  }
  if (normalized.endsWith("subscription")) {
    return `Claude ${subscriptionLabel}`;
  }
  return `Claude ${subscriptionLabel} Subscription`;
}

function claudeAuthMetadata(input: {
  readonly subscriptionType: string | undefined;
  readonly authMethod: string | undefined;
}): { readonly type: string; readonly label: string } | undefined {
  if (normalizeClaudeAuthMethod(input.authMethod) === "apiKey") {
    return {
      type: "apiKey",
      label: "Claude API Key",
    };
  }

  if (input.subscriptionType) {
    return {
      type: input.subscriptionType,
      label: formatClaudeSubscriptionAuthLabel(input.subscriptionType),
    };
  }

  return undefined;
}

// ── SDK capability probe ────────────────────────────────────────────

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

function nonEmptyProbeString(value: string): string | undefined {
  const candidate = value.trim();
  return candidate ? candidate : undefined;
}

type ClaudeCapabilitiesProbe = {
  readonly email: string | undefined;
  readonly subscriptionType: string | undefined;
  readonly tokenSource: string | undefined;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
};

type ResolveClaudeCapabilities = (
  claudeSettings: ClaudeSettings,
) => Effect.Effect<ClaudeCapabilitiesProbe | undefined>;

type ResolveClaudeRateLimits = (
  claudeSettings: ClaudeSettings,
  version: string | null,
) => Effect.Effect<ServerProviderRateLimits | undefined>;

function parseClaudeInitializationCommands(
  commands: ReadonlyArray<ClaudeSlashCommand> | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  return dedupeSlashCommands(
    (commands ?? []).flatMap((command) => {
      const name = nonEmptyProbeString(command.name);
      if (!name) {
        return [];
      }

      const description = nonEmptyProbeString(command.description);
      const argumentHint = nonEmptyProbeString(command.argumentHint);

      return [
        {
          name,
          ...(description ? { description } : {}),
          ...(argumentHint ? { input: { hint: argumentHint } } : {}),
        } satisfies ServerProviderSlashCommand,
      ];
    }),
  );
}

function dedupeSlashCommands(
  commands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commandsByName = new Map<string, ServerProviderSlashCommand>();

  for (const command of commands) {
    const name = nonEmptyProbeString(command.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    const existing = commandsByName.get(key);
    if (!existing) {
      commandsByName.set(key, {
        ...command,
        name,
      });
      continue;
    }

    commandsByName.set(key, {
      ...existing,
      ...(existing.description
        ? {}
        : command.description
          ? { description: command.description }
          : {}),
      ...(existing.input?.hint
        ? {}
        : command.input?.hint
          ? { input: { hint: command.input.hint } }
          : {}),
    });
  }

  return [...commandsByName.values()];
}

function waitForAbortSignal(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Probe account information by spawning a lightweight Claude Agent SDK
 * session and reading the initialization result.
 *
 * We pass a never-yielding AsyncIterable as the prompt so that no user
 * message is ever written to the subprocess stdin. This means the Claude
 * Code subprocess completes its local initialization IPC (returning
 * account info and slash commands) but never starts an API request to
 * Anthropic. We read the init data and then abort the subprocess.
 *
 * This is used as a fallback when `claude auth status` does not include
 * subscription type information.
 */
const probeClaudeCapabilities = (
  claudeSettings: ClaudeSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const abort = new AbortController();
  return Effect.gen(function* () {
    const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
    return yield* Effect.tryPromise(async () => {
      const q = claudeQuery({
        // Never yield — we only need initialization data, not a conversation.
        // This prevents any prompt from reaching the Anthropic API.
        // oxlint-disable-next-line require-yield
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await waitForAbortSignal(abort.signal);
        })(),
        options: {
          persistSession: false,
          pathToClaudeCodeExecutable: claudeSettings.binaryPath,
          abortController: abort,
          settingSources: ["user", "project", "local"],
          allowedTools: [],
          env: claudeEnvironment,
          stderr: () => {},
        },
      });
      const init = await q.initializationResult();
      const account = init.account as
        | {
            readonly email?: string;
            readonly subscriptionType?: string;
            readonly tokenSource?: string;
          }
        | undefined;
      return {
        email: account?.email,
        subscriptionType: account?.subscriptionType,
        tokenSource: account?.tokenSource,
        slashCommands: parseClaudeInitializationCommands(init.commands),
      } satisfies ClaudeCapabilitiesProbe;
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!abort.signal.aborted) abort.abort();
      }),
    ),
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) => {
      if (Result.isFailure(result)) return undefined;
      return Option.isSome(result.success) ? result.success.value : undefined;
    }),
  );
};

const runClaudeCommand = Effect.fn("runClaudeCommand")(function* (
  claudeSettings: ClaudeSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const command = ChildProcess.make(claudeSettings.binaryPath, [...args], {
    env: claudeEnvironment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(claudeSettings.binaryPath, command);
});

export const checkClaudeProviderStatus = Effect.fn("checkClaudeProviderStatus")(function* (
  claudeSettings: ClaudeSettings,
  resolveCapabilities?: ResolveClaudeCapabilities,
  environment: NodeJS.ProcessEnv = process.env,
  resolveRateLimits?: ResolveClaudeRateLimits,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude is disabled in Ryco settings.",
      },
    });
  }

  const versionProbe = yield* runClaudeCommand(claudeSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Claude Agent CLI (`claude`) is not installed or not on PATH."
          : `Failed to execute Claude Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Claude Agent CLI is installed but failed to run. ${detail}`
          : "Claude Agent CLI is installed but failed to run.",
      },
    });
  }

  const models = providerModelsFromSettings(
    getBuiltInClaudeModelsForVersion(parsedVersion),
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );
  const upgradeMessage = formatClaudeUpgradeMessages(parsedVersion).join(" ");

  const capabilities = resolveCapabilities
    ? yield* resolveCapabilities(claudeSettings).pipe(Effect.orElseSucceed(() => undefined))
    : undefined;
  const slashCommands = capabilities?.slashCommands ?? [];
  const dedupedSlashCommands = dedupeSlashCommands(slashCommands);
  const rateLimits = resolveRateLimits
    ? yield* resolveRateLimits(claudeSettings, parsedVersion).pipe(
        Effect.orElseSucceed(() => undefined),
      )
    : undefined;

  if (!capabilities) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: claudeSettings.enabled,
      checkedAt,
      models,
      slashCommands: dedupedSlashCommands,
      ...(rateLimits ? { rateLimits } : {}),
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Claude authentication status from initialization result.",
      },
    });
  }

  const authMetadata = claudeAuthMetadata({
    subscriptionType: capabilities.subscriptionType,
    authMethod: capabilities.tokenSource,
  });
  return buildServerProvider({
    presentation: CLAUDE_PRESENTATION,
    enabled: claudeSettings.enabled,
    checkedAt,
    models,
    slashCommands: dedupedSlashCommands,
    ...(rateLimits ? { rateLimits } : {}),
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        ...(capabilities.email ? { email: capabilities.email } : {}),
        ...(authMetadata ? authMetadata : {}),
      },
      ...(upgradeMessage ? { message: upgradeMessage } : {}),
    },
  });
});

export const makePendingClaudeProvider = (claudeSettings: ClaudeSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    claudeSettings.customModels,
    DEFAULT_CLAUDE_MODEL_CAPABILITIES,
  );

  if (!claudeSettings.enabled) {
    return buildServerProvider({
      presentation: CLAUDE_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Claude is disabled in Ryco settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: CLAUDE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Claude provider status has not been checked in this session yet.",
    },
  });
};

export { probeClaudeCapabilities };

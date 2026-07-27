import type { ModelSelection, ServerConfig } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildModelPickerModel, resolveModelPickerSelection } from "./modelPickerModel";

function provider(instanceId: string, driver: string, models: ReadonlyArray<string>) {
  return {
    instanceId,
    driver,
    displayName: undefined,
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    models: models.map((slug) => ({ slug, name: slug.toUpperCase(), capabilities: null })),
  };
}

function config(...providers: ReadonlyArray<ReturnType<typeof provider>>) {
  return { providers } as unknown as ServerConfig;
}

// ProviderInstanceId is a branded string; tests build selections through here.
function selection(instanceId: string, model: string): ModelSelection {
  return { instanceId, model } as unknown as ModelSelection;
}

const CODEX = provider("codex-1", "codex", ["gpt-5.4", "gpt-5.6"]);
const CLAUDE = provider("claude-1", "claudeAgent", ["opus-5"]);

describe("model picker", () => {
  it("reports loading rather than an empty list while the config is null", () => {
    const model = buildModelPickerModel({
      serverConfig: null,
      currentSelection: null,
      providerLocked: false,
    });
    expect(model.loading).toBe(true);
    expect(model.pillLabel).toBe("Loading…");
    expect(model.pillAccessibilityLabel).toBe("Model: loading.");
  });

  it("does not claim to be loading once a config with no providers arrives", () => {
    const model = buildModelPickerModel({
      serverConfig: config(),
      currentSelection: null,
      providerLocked: false,
    });
    expect(model.loading).toBe(false);
    expect(model.groups).toEqual([]);
  });

  it("groups models by provider and marks the current one selected", () => {
    const model = buildModelPickerModel({
      serverConfig: config(CODEX, CLAUDE),
      currentSelection: selection("codex-1", "gpt-5.6"),
      providerLocked: false,
    });
    expect(model.groups.map((group) => group.providerKey)).toEqual(["codex-1", "claude-1"]);
    expect(model.groups[0]?.providerDriver).toBe("codex");
    const selected = model.groups
      .flatMap((group) => group.entries)
      .filter((entry) => entry.selected);
    expect(selected.map((entry) => entry.key)).toEqual(["codex-1:gpt-5.6"]);
    expect(model.pillLabel).toBe("GPT-5.6");
    expect(model.pillProviderDriver).toBe("codex");
  });

  it("locks a started thread to its provider without hiding the others", () => {
    const model = buildModelPickerModel({
      serverConfig: config(CODEX, CLAUDE),
      currentSelection: selection("codex-1", "gpt-5.4"),
      providerLocked: true,
    });
    expect(model.lockedProviderKey).toBe("codex-1");
    expect(model.lockNotice).toContain("already started");

    const codex = model.groups.find((group) => group.providerKey === "codex-1");
    const claude = model.groups.find((group) => group.providerKey === "claude-1");
    // Same-provider models stay switchable...
    expect(codex?.entries.every((entry) => !entry.disabled)).toBe(true);
    // ...the other provider is visible but refused, with a stated reason.
    expect(claude?.entries.every((entry) => entry.disabled)).toBe(true);
    expect(claude?.entries[0]?.disabledReason).toContain("already started");
  });

  it("leaves everything switchable when the thread has not started", () => {
    const model = buildModelPickerModel({
      serverConfig: config(CODEX, CLAUDE),
      currentSelection: selection("codex-1", "gpt-5.4"),
      providerLocked: false,
    });
    expect(model.lockedProviderKey).toBeNull();
    expect(model.groups.flatMap((g) => g.entries).every((entry) => !entry.disabled)).toBe(true);
  });

  it("filters by model and provider name, and drops emptied groups", () => {
    const model = buildModelPickerModel({
      serverConfig: config(CODEX, CLAUDE),
      currentSelection: null,
      providerLocked: false,
      query: "opus",
    });
    expect(model.groups.map((group) => group.providerKey)).toEqual(["claude-1"]);
    expect(model.emptyForQuery).toBe(false);
  });

  it("distinguishes a query that matched nothing from having no models", () => {
    const noMatch = buildModelPickerModel({
      serverConfig: config(CODEX),
      currentSelection: null,
      providerLocked: false,
      query: "zzzz",
    });
    expect(noMatch.emptyForQuery).toBe(true);

    const noModels = buildModelPickerModel({
      serverConfig: config(),
      currentSelection: null,
      providerLocked: false,
    });
    expect(noModels.emptyForQuery).toBe(false);
  });
});

describe("resolveModelPickerSelection", () => {
  const model = buildModelPickerModel({
    serverConfig: config(CODEX, CLAUDE),
    currentSelection: selection("codex-1", "gpt-5.4"),
    providerLocked: true,
  });

  it("returns the selection for an enabled, unselected entry", () => {
    expect(resolveModelPickerSelection(model, "codex-1:gpt-5.6")).toMatchObject({
      instanceId: "codex-1",
      model: "gpt-5.6",
    });
  });

  it("refuses a locked-out provider even if the UI let the tap through", () => {
    expect(resolveModelPickerSelection(model, "claude-1:opus-5")).toBeNull();
  });

  it("ignores the already-selected entry and unknown keys", () => {
    expect(resolveModelPickerSelection(model, "codex-1:gpt-5.4")).toBeNull();
    expect(resolveModelPickerSelection(model, "nope")).toBeNull();
  });
});

describe("model options", () => {
  const CAPS = {
    reasoningEfforts: ["low", "medium", "high"],
    supportsFastMode: true,
  } as never;

  function withCaps(models: ReadonlyArray<string>) {
    return {
      instanceId: "claude-1",
      driver: "claudeAgent",
      displayName: undefined,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: models.map((slug) => ({ slug, name: slug, capabilities: CAPS })),
    } as unknown as ReturnType<typeof provider>;
  }

  it("has no rail when the selected model declares no options", () => {
    // The state that matters: a model without options must get NO rail rather
    // than an empty or disabled one.
    const model = buildModelPickerModel({
      serverConfig: config(CODEX),
      currentSelection: selection("codex-1", "gpt-5.4"),
      providerLocked: false,
    });
    expect(model.options).toEqual([]);
    expect(model.hasOptionRail).toBe(false);
  });

  it("carries capabilities onto every entry so options can be derived", () => {
    const model = buildModelPickerModel({
      serverConfig: config(withCaps(["opus-5"])),
      currentSelection: selection("claude-1", "opus-5"),
      providerLocked: false,
    });
    const entry = model.groups.flatMap((group) => group.entries)[0];
    expect(entry?.capabilities).not.toBeUndefined();
  });

  it("reports no rail while the config is still loading", () => {
    const model = buildModelPickerModel({
      serverConfig: null,
      currentSelection: selection("claude-1", "opus-5"),
      providerLocked: false,
    });
    expect(model.hasOptionRail).toBe(false);
  });
});

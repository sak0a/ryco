import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind } from "@ryco/contracts";
import { Schema } from "effect";

import bundledManifestJson from "./model-manifest.json" with { type: "json" };
import {
  BUNDLED_MODEL_MANIFEST,
  ModelManifestSchema,
  resolveProviderCatalog,
} from "./ModelManifest.ts";

const CLAUDE = ProviderDriverKind.make("claudeAgent");

function cloneManifest(): Record<string, unknown> {
  return structuredClone(bundledManifestJson) as Record<string, unknown>;
}

describe("ModelManifest", () => {
  it("decodes the bundled manifest", () => {
    // `BUNDLED_MODEL_MANIFEST` decodes at module load; reaching this line
    // with the expected shape proves the bundled JSON passes the schema and
    // its cross-reference checks.
    assert.equal(BUNDLED_MODEL_MANIFEST.version, 1);
    assert.deepEqual(BUNDLED_MODEL_MANIFEST.currentModels["claudeAgent"], [
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
  });

  it("resolves the Claude provider catalog with presentation fields", () => {
    const catalog = resolveProviderCatalog(BUNDLED_MODEL_MANIFEST, CLAUDE);
    assert.notEqual(catalog, null);
    if (!catalog) return;

    const fable51 = catalog.models.find((entry) => entry.model.slug === "claude-fable-5-1");
    assert.notEqual(fable51, undefined);
    assert.equal(fable51?.model.name, "Claude Fable 5.1");
    assert.equal(fable51?.model.shortName, "Fable 5.1");
    assert.equal(fable51?.model.badge, "new");
    assert.equal(fable51?.model.isCustom, false);
    assert.equal(fable51?.model.isLegacy, undefined);
    assert.deepEqual(fable51?.model.aliases, ["fable", "fable-5.1", "claude-fable-5.1"]);
    assert.notEqual(fable51?.model.capabilities, null);

    const opus5 = catalog.models.find((entry) => entry.model.slug === "claude-opus-5");
    assert.equal(opus5?.model.isDefault, true);
    assert.equal(catalog.defaults.chat, "claude-opus-5");

    const opus48 = catalog.models.find((entry) => entry.model.slug === "claude-opus-4-8");
    assert.equal(opus48?.model.isLegacy, true);
  });

  it("returns null for a provider without a catalog", () => {
    assert.equal(
      resolveProviderCatalog(BUNDLED_MODEL_MANIFEST, ProviderDriverKind.make("cursor")),
      null,
    );
  });

  it("rejects a manifest whose default model does not exist", () => {
    const manifest = cloneManifest();
    const providers = manifest["providers"] as Record<
      string,
      { defaults: { chat: string }; models: Array<{ slug: string }> }
    >;
    providers["claudeAgent"]!.defaults.chat = "claude-nonexistent";
    assert.throws(() => decodeManifestOrThrow(manifest));
  });

  it("rejects a manifest with duplicate model slugs", () => {
    const manifest = cloneManifest();
    const providers = manifest["providers"] as Record<string, { models: Array<{ slug: string }> }>;
    const models = providers["claudeAgent"]!.models;
    models.push({ ...models[0]! });
    assert.throws(() => decodeManifestOrThrow(manifest));
  });

  it("rejects a manifest referencing a missing profile", () => {
    const manifest = cloneManifest();
    const providers = manifest["providers"] as Record<
      string,
      { models: Array<{ slug: string; profile?: string }> }
    >;
    providers["claudeAgent"]!.models[0]!.profile = "no-such-profile";
    assert.throws(() => decodeManifestOrThrow(manifest));
  });

  it("rejects a manifest with an invalid Claude adapter payload", () => {
    const manifest = cloneManifest();
    const providers = manifest["providers"] as Record<
      string,
      { models: Array<{ adapter?: unknown }> }
    >;
    providers["claudeAgent"]!.models[0]!.adapter = {
      claudeCode: { minVersion: "not-a-version" },
    };
    assert.throws(() => decodeManifestOrThrow(manifest));
  });
});

function decodeManifestOrThrow(manifest: unknown): unknown {
  return Schema.decodeUnknownSync(ModelManifestSchema)(manifest);
}

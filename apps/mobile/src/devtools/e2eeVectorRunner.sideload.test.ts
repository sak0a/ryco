/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const constantsHolder = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { extra: constantsHolder.extra };
    },
  },
}));

import {
  E2EE_SIDELOAD_RUNNER_GLOBAL,
  installE2eeVectorRunnerDevHook,
  runSideloadedE2eeVectors,
  type E2eeSideloadInput,
} from "./e2eeVectorRunner";

const FIXTURE_ROOT = new URL("../../../../packages/shared/fixtures/e2ee/v1/", import.meta.url);
const MANIFEST_JSON = readFileSync(new URL("manifest.json", FIXTURE_ROOT), "utf8");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const dependencies = {
  sha256: async (bytes: Uint8Array) => Uint8Array.from(createHash("sha256").update(bytes).digest()),
};

function family(file: string): { readonly file: string; readonly json: string } {
  return { file, json: readFileSync(new URL(file, FIXTURE_ROOT), "utf8") };
}

function validInput(): E2eeSideloadInput {
  return {
    manifestJson: MANIFEST_JSON,
    manifestSha256: sha256(MANIFEST_JSON),
    families: [
      family("f04-prekey-certificates.json"),
      family("f06-ik-handshake.json"),
      family("f07-nx-handshake.json"),
      family("f17-key-material-validation.json"),
    ],
    fixtureIds: [
      "F04/valid-node-agreement-prekey-certificate",
      "F06/ik-handshake-complete-trace",
      "F07/nx-handshake-complete-trace",
      "F17/p256-public-key-valid-control",
    ],
  };
}

function withManifest(
  input: E2eeSideloadInput,
  mutate: (manifest: Record<string, unknown>) => void,
): E2eeSideloadInput {
  const manifest = JSON.parse(input.manifestJson) as Record<string, unknown>;
  mutate(manifest);
  const manifestJson = JSON.stringify(manifest);
  return { ...input, manifestJson, manifestSha256: sha256(manifestJson) };
}

beforeEach(() => {
  constantsHolder.extra = {};
});

describe("mobile E2EE fixture side-load", () => {
  it("installs the side-load hook only in the development variant", () => {
    for (const appVariant of ["production", "preview", undefined] as const) {
      constantsHolder.extra = appVariant === undefined ? {} : { appVariant };
      const host: Record<string, unknown> = {};
      installE2eeVectorRunnerDevHook(host);
      expect(host[E2EE_SIDELOAD_RUNNER_GLOBAL]).toBeUndefined();
    }

    constantsHolder.extra = { appVariant: "development" };
    const host: Record<string, unknown> = {};
    installE2eeVectorRunnerDevHook(host);
    expect(host[E2EE_SIDELOAD_RUNNER_GLOBAL]).toBe(runSideloadedE2eeVectors);
    expect(Object.keys(host)).toEqual([]);
  });

  it("runs explicitly routed F4, F6, F7, and F17 cases", async () => {
    await expect(runSideloadedE2eeVectors(validInput(), dependencies)).resolves.toEqual([
      { fixtureId: "F04/valid-node-agreement-prekey-certificate", ok: true },
      { fixtureId: "F06/ik-handshake-complete-trace", ok: true },
      { fixtureId: "F07/nx-handshake-complete-trace", ok: true },
      { fixtureId: "F17/p256-public-key-valid-control", ok: true },
    ]);
  });

  it("runs every routed F4 canonical-rejection and F17 P-256 case", async () => {
    const manifest = JSON.parse(MANIFEST_JSON) as {
      readonly portableExecution: {
        readonly routes: readonly {
          readonly fixtureId: string;
          readonly file: string;
          readonly runners: readonly string[];
        }[];
      };
    };
    const fixtureIds = manifest.portableExecution.routes
      .filter(
        (route) =>
          route.runners.includes("mobile-dev-sideload") &&
          (route.file === "f04-prekey-certificates.json" ||
            route.file === "f17-key-material-validation.json"),
      )
      .map((route) => route.fixtureId);
    const input = validInput();
    const results = await runSideloadedE2eeVectors({ ...input, fixtureIds }, dependencies);
    expect(results).toHaveLength(fixtureIds.length);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("rejects a manifest or family whose raw JSON digest does not match", async () => {
    const input = validInput();
    await expect(
      runSideloadedE2eeVectors({ ...input, manifestSha256: "00".repeat(32) }, dependencies),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);

    const families = [...input.families];
    families[1] = { ...families[1]!, json: `${families[1]!.json} ` };
    await expect(runSideloadedE2eeVectors({ ...input, families }, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );
  });

  it("rejects oversized JSON before parsing or digesting it", async () => {
    const input = validInput();
    await expect(
      runSideloadedE2eeVectors(
        { ...input, manifestJson: " ".repeat(2 * 1_024 * 1_024 + 1) },
        dependencies,
      ),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);

    const families = [...input.families];
    families[0] = { ...families[0]!, json: " ".repeat(256 * 1_024 + 1) };
    await expect(runSideloadedE2eeVectors({ ...input, families }, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );
  });

  it("rejects family, case, and aggregate counts outside the channel bounds", async () => {
    const input = validInput();
    await expect(
      runSideloadedE2eeVectors(
        {
          ...input,
          families: Array.from({ length: 33 }, (_, index) => ({
            file: `f${index}.json`,
            json: "{}",
          })),
        },
        dependencies,
      ),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);

    const familyJson = JSON.stringify({ cases: Array.from({ length: 65 }, () => ({})) });
    const overCases = withManifest(
      {
        ...input,
        families: [{ file: "f99-selected.json", json: familyJson }],
        fixtureIds: [],
      },
      (manifest) => {
        const files = manifest.files as Record<string, unknown>;
        files["f99-selected.json"] = { family: 99, sha256: sha256(familyJson), cases: 65 };
      },
    );
    await expect(runSideloadedE2eeVectors(overCases, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );

    const manyFamilies = Array.from({ length: 9 }, (_, familyIndex) => ({
      file: `f${String(familyIndex).padStart(2, "0")}-count.json`,
      json: JSON.stringify({
        cases: Array.from({ length: 64 }, (_, caseIndex) => ({
          name: `case-${caseIndex}`,
          inputs: {},
          expected: {},
        })),
      }),
    }));
    const overTotal = withManifest(
      { ...input, families: manyFamilies, fixtureIds: [] },
      (manifest) => {
        const files = manifest.files as Record<string, unknown>;
        for (const supplied of manyFamilies) {
          files[supplied.file] = { family: 99, sha256: sha256(supplied.json), cases: 64 };
        }
      },
    );
    await expect(runSideloadedE2eeVectors(overTotal, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );
  });

  it("rejects oversized IDs, unrouted cases, recipes, and malformed JSON", async () => {
    const input = validInput();
    await expect(
      runSideloadedE2eeVectors({ ...input, fixtureIds: [`F06/${"x".repeat(129)}`] }, dependencies),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);

    await expect(
      runSideloadedE2eeVectors(
        { ...input, fixtureIds: ["F06/not-explicitly-routed"] },
        dependencies,
      ),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);

    const familyJson = JSON.stringify({ cases: [], payload: { $recipe: { bytes: 1 } } });
    const recipe = withManifest(
      { ...input, families: [{ file: "f99-selected.json", json: familyJson }], fixtureIds: [] },
      (manifest) => {
        const files = manifest.files as Record<string, unknown>;
        files["f99-selected.json"] = { family: 99, sha256: sha256(familyJson), cases: 0 };
      },
    );
    await expect(runSideloadedE2eeVectors(recipe, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );

    await expect(
      runSideloadedE2eeVectors({ ...input, manifestJson: "{" }, dependencies),
    ).rejects.toThrow(/^Invalid E2EE fixture side-load\.$/);
  });

  it("rejects decoded ordinary fixture bytes above 16 KiB", async () => {
    const input = validInput();
    const familyJson = JSON.stringify({
      cases: [],
      payload: { $bytes: "00".repeat(16 * 1_024 + 1) },
    });
    const oversizedBytes = withManifest(
      { ...input, families: [{ file: "f99-selected.json", json: familyJson }], fixtureIds: [] },
      (manifest) => {
        const files = manifest.files as Record<string, unknown>;
        files["f99-selected.json"] = { family: 99, sha256: sha256(familyJson), cases: 0 };
      },
    );
    await expect(runSideloadedE2eeVectors(oversizedBytes, dependencies)).rejects.toThrow(
      /^Invalid E2EE fixture side-load\.$/,
    );
  });
});

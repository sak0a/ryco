import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFERRED_FAMILIES,
  E2EE_FIXTURE_ROOT,
  TRANSCODED_FAMILY_FILE,
  generateE2eeFixtureCorpus,
  writeE2eeFixtureCorpus,
} from "./generate-e2ee-fixtures.ts";

// §16.1: the drift test. It regenerates the corpus IN MEMORY and compares the
// committed files byte for byte; it never updates them. A change to any
// transcript element, domain string, derivation, or bound therefore fails a
// test rather than silently producing a different corpus.

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

interface ManifestFileEntry {
  readonly family: number;
  readonly title: string;
  readonly sections: readonly string[];
  readonly sha256: string;
  readonly origin: string;
  readonly cases?: number;
  readonly deferred?: readonly string[];
}

interface Manifest {
  readonly formatVersion: number;
  readonly warning: string;
  readonly encoding: string;
  readonly files: Readonly<Record<string, ManifestFileEntry>>;
  readonly deferredFamilies: readonly { readonly family: number }[];
  readonly partialFamilies: readonly {
    readonly family: number;
    readonly file: string;
    readonly deferred: readonly string[];
  }[];
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await readFile(`${E2EE_FIXTURE_ROOT}manifest.json`, "utf8")) as Manifest;
}

describe("relay E2EE fixture corpus", () => {
  it("matches deterministic generation byte for byte", async () => {
    const generated = await generateE2eeFixtureCorpus();

    for (const [name, json] of generated.files) {
      expect(await readFile(`${E2EE_FIXTURE_ROOT}${name}`, "utf8"), name).toBe(json);
    }
    expect(await readFile(`${E2EE_FIXTURE_ROOT}manifest.json`, "utf8")).toBe(
      generated.manifestJson,
    );
  });

  it("is byte-identical across two generations in one process", async () => {
    // §16.1 forbids ambient randomness and clock reads. Two runs that disagree
    // would mean one of them slipped in, which the committed-file comparison
    // above cannot see on its own.
    const first = await generateE2eeFixtureCorpus();
    const second = await generateE2eeFixtureCorpus();
    expect([...second.files.entries()]).toEqual([...first.files.entries()]);
    expect(second.manifestJson).toBe(first.manifestJson);
  });

  it("records a correct digest for every file the manifest lists", async () => {
    const manifest = await readManifest();
    for (const [name, entry] of Object.entries(manifest.files)) {
      const bytes = await readFile(`${E2EE_FIXTURE_ROOT}${name}`);
      expect(sha256(bytes), name).toBe(entry.sha256);
    }
  });

  it("lists exactly the family files present on disk", async () => {
    const manifest = await readManifest();
    const onDisk = (await readdir(E2EE_FIXTURE_ROOT))
      .filter((entry) => /^f\d+-.*\.json$/.test(entry))
      .toSorted();
    expect(Object.keys(manifest.files).toSorted()).toEqual(onDisk);
  });

  it("carries the §16.1 test-only warning at the top level and in every family", async () => {
    const manifest = await readManifest();
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.encoding).toBe("deterministic-cbor-rfc8949");
    expect(manifest.warning).toContain("TEST-ONLY MATERIAL");
    expect(manifest.warning).toContain("MUST NEVER be used for a real endpoint");

    for (const name of Object.keys(manifest.files)) {
      const family = JSON.parse(await readFile(`${E2EE_FIXTURE_ROOT}${name}`, "utf8")) as {
        readonly warning: string;
      };
      expect(family.warning, name).toContain("TEST-ONLY");
    }
  });

  it("prefixes every private key field with testOnly", async () => {
    // §16.1: "every key field name carries a `testOnly` prefix". The check is
    // over field NAMES, so a secret added under an innocuous name fails here.
    const manifest = await readManifest();
    const forbidden = /(secretkey|privatekey|seed)$/i;
    for (const name of Object.keys(manifest.files)) {
      const document = JSON.parse(await readFile(`${E2EE_FIXTURE_ROOT}${name}`, "utf8")) as unknown;
      const offenders: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        if (typeof node !== "object" || node === null) return;
        for (const [key, value] of Object.entries(node)) {
          if (forbidden.test(key) && !key.startsWith("testOnly")) offenders.push(key);
          walk(value);
        }
      };
      walk(document);
      expect(offenders, name).toEqual([]);
    }
  });

  it("preserves the transcoded family and its provenance", async () => {
    const manifest = await readManifest();
    const entry = manifest.files[TRANSCODED_FAMILY_FILE];
    expect(entry).toBeDefined();
    expect(entry?.origin).toBe("transcoded-upstream");

    // The generator must not rewrite it: regenerating into a directory holding
    // only that file leaves the file untouched.
    const root = await mkdtemp(join(tmpdir(), "ryco-e2ee-fixtures-"));
    try {
      const original = await readFile(`${E2EE_FIXTURE_ROOT}${TRANSCODED_FAMILY_FILE}`);
      await writeFile(`${root}/${TRANSCODED_FAMILY_FILE}`, original);
      await writeE2eeFixtureCorpus(`${root}/`);
      expect(await readFile(`${root}/${TRANSCODED_FAMILY_FILE}`)).toEqual(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes obsolete generated family files and writes a complete corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-e2ee-fixtures-"));
    try {
      await mkdir(root, { recursive: true });
      const transcoded = await readFile(`${E2EE_FIXTURE_ROOT}${TRANSCODED_FAMILY_FILE}`);
      await writeFile(`${root}/${TRANSCODED_FAMILY_FILE}`, transcoded);
      await writeFile(`${root}/f99-obsolete-family.json`, "{}\n", "utf8");
      await writeFile(`${root}/README.md`, "preserve me\n", "utf8");

      await writeE2eeFixtureCorpus(`${root}/`);

      const written = await readdir(root);
      expect(written).not.toContain("f99-obsolete-family.json");
      expect(await readFile(`${root}/README.md`, "utf8")).toBe("preserve me\n");

      const generated = await generateE2eeFixtureCorpus();
      for (const [name, json] of generated.files) {
        expect(await readFile(`${root}/${name}`, "utf8"), name).toBe(json);
      }
      expect(await readFile(`${root}/manifest.json`, "utf8")).toBe(generated.manifestJson);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names every §16.3 family it does not yet emit", async () => {
    // The corpus is incomplete by design at this point in the rollout, and the
    // one thing that must never happen is an omission nobody can see. Every
    // family number §16.3 defines is either present as a file or listed as
    // deferred with an owner.
    const manifest = await readManifest();
    const present = new Set(Object.values(manifest.files).map((entry) => entry.family));
    const deferred = new Set(manifest.deferredFamilies.map((entry) => entry.family));
    for (let family = 1; family <= 18; family += 1) {
      expect(present.has(family) || deferred.has(family), `family F${family}`).toBe(true);
    }
    expect(manifest.deferredFamilies).toEqual(DEFERRED_FAMILIES);
    for (const entry of DEFERRED_FAMILIES) {
      expect(entry.reason.length, `F${entry.family}`).toBeGreaterThan(0);
      expect(entry.ownedBy.length, `F${entry.family}`).toBeGreaterThan(0);
    }
    // Every family F1–F18 has a file today, so the wholesale-omission list is
    // empty and the deferral has moved INSIDE the families that are partial.
    expect(DEFERRED_FAMILIES).toEqual([]);
    for (let family = 1; family <= 18; family += 1) {
      expect(present.has(family), `family F${family} file`).toBe(true);
    }
  });

  it("lists every partial family in the manifest, with a reason and an owner", async () => {
    // A family that is PRESENT but incomplete is the failure mode the corpus is
    // most likely to hide, so the manifest names it at the top level and the
    // family file repeats it. The two MUST agree, and every reason must name
    // the component that will own the missing cases.
    const manifest = await readManifest();
    const partial = new Map(manifest.partialFamilies.map((entry) => [entry.file, entry]));
    for (const [name, entry] of Object.entries(manifest.files)) {
      const family = JSON.parse(await readFile(`${E2EE_FIXTURE_ROOT}${name}`, "utf8")) as {
        readonly deferred?: readonly string[];
      };
      expect(family.deferred ?? [], name).toEqual(entry.deferred ?? []);
      if ((family.deferred ?? []).length === 0) {
        expect(partial.has(name), name).toBe(false);
        continue;
      }
      expect(partial.get(name)?.deferred, name).toEqual(family.deferred);
      for (const reason of family.deferred ?? []) {
        expect(reason.length, name).toBeGreaterThan(40);
      }
      // Each partial family either names the component that will own its
      // missing cases, or says in as many words that §16.3 excludes them from
      // the corpus on purpose. "Missing, and nobody said why" is the one state
      // this assertion exists to make impossible.
      const rationale = (family.deferred ?? []).join(" ");
      expect(
        /Owned by|belongs to implementation tests|constrains an implementation/.test(rationale),
        name,
      ).toBe(true);
    }
    expect([...partial.keys()].toSorted()).toEqual(
      manifest.partialFamilies.map((entry) => entry.file).toSorted(),
    );
  });
});

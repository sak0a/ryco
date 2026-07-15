import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  generateRelayFixtureCorpus,
  RELAY_FIXTURE_ROOT,
  writeRelayFixtureCorpus,
} from "./generate-relay-fixtures.ts";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function committedFixturePaths(): Promise<readonly string[]> {
  const entries = await readdir(RELAY_FIXTURE_ROOT, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".cbor"))
    .map((entry) => entry.replaceAll("\\", "/"))
    .toSorted();
}

describe("canonical relay fixtures", () => {
  it("removes obsolete fixture files without removing root documentation", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "ryco-relay-fixtures-"));
    try {
      await mkdir(`${fixtureRoot}/valid`, { recursive: true });
      await mkdir(`${fixtureRoot}/invalid`, { recursive: true });
      await writeFile(`${fixtureRoot}/valid/obsolete.cbor`, Uint8Array.of(0));
      await writeFile(`${fixtureRoot}/invalid/obsolete.cbor`, Uint8Array.of(0));
      await writeFile(`${fixtureRoot}/README.md`, "preserve me\n", "utf8");

      await writeRelayFixtureCorpus(fixtureRoot);

      expect(await readdir(`${fixtureRoot}/valid`)).not.toContain("obsolete.cbor");
      expect(await readdir(`${fixtureRoot}/invalid`)).not.toContain("obsolete.cbor");
      expect(await readFile(`${fixtureRoot}/README.md`, "utf8")).toBe("preserve me\n");
      expect(await readFile(`${fixtureRoot}/manifest.json`, "utf8")).toBe(
        generateRelayFixtureCorpus().manifestJson,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("matches deterministic generation byte for byte", async () => {
    const generated = generateRelayFixtureCorpus();
    const expectedPaths = [...generated.files.keys()].toSorted();

    expect(await committedFixturePaths()).toEqual(expectedPaths);
    for (const [relativePath, expectedBytes] of generated.files) {
      const committedBytes = new Uint8Array(
        await readFile(`${RELAY_FIXTURE_ROOT}/${relativePath}`),
      );
      expect(Buffer.from(committedBytes).equals(Buffer.from(expectedBytes)), relativePath).toBe(
        true,
      );
    }
    expect(await readFile(`${RELAY_FIXTURE_ROOT}/manifest.json`, "utf8")).toBe(
      generated.manifestJson,
    );
  });

  it("records and verifies every fixture digest", async () => {
    const generated = generateRelayFixtureCorpus();

    for (const fixture of generated.manifest.fixtures) {
      const bytes = new Uint8Array(await readFile(`${RELAY_FIXTURE_ROOT}/${fixture.path}`));
      expect(bytes.byteLength, fixture.path).toBe(fixture.encodedBytes);
      expect(sha256(bytes), fixture.path).toBe(fixture.sha256);
    }
  });

  it("decodes valid fixtures and re-encodes all known-field fixtures exactly", async () => {
    const generated = generateRelayFixtureCorpus();

    for (const fixture of generated.manifest.fixtures) {
      if (fixture.expected.status !== "success") {
        continue;
      }
      const bytes = new Uint8Array(await readFile(`${RELAY_FIXTURE_ROOT}/${fixture.path}`));
      const decoded = decodeRelayFrame(bytes);
      expect(decoded.ok, fixture.path).toBe(true);

      if (fixture.path.endsWith("future-optional-channel-open.cbor")) {
        continue;
      }
      if (!decoded.ok) {
        throw new Error(`Expected ${fixture.path} to decode`);
      }
      const encoded = encodeRelayFrame(decoded.value);
      expect(encoded.ok, fixture.path).toBe(true);
      if (!encoded.ok) {
        throw new Error(`Expected ${fixture.path} to encode`);
      }
      expect(Buffer.from(encoded.value).equals(Buffer.from(bytes)), fixture.path).toBe(true);
    }
  });

  it("returns the manifest error code for every invalid fixture", async () => {
    const generated = generateRelayFixtureCorpus();

    for (const fixture of generated.manifest.fixtures) {
      if (fixture.expected.status !== "error") {
        continue;
      }
      const bytes = new Uint8Array(await readFile(`${RELAY_FIXTURE_ROOT}/${fixture.path}`));
      expect(decodeRelayFrame(bytes), fixture.path).toEqual({
        ok: false,
        error: expect.objectContaining({ code: fixture.expected.code }),
      });
    }
  });
});

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  generateNodeIdentityFixtureManifest,
  NODE_IDENTITY_FIXTURE_ROOT,
  writeNodeIdentityFixtureManifest,
} from "./generate-node-identity-fixtures.ts";

describe("canonical node identity fixtures", () => {
  it("matches the checked-in manifest", async () => {
    const checkedIn = await readFile(`${NODE_IDENTITY_FIXTURE_ROOT}/manifest.json`, "utf8");
    expect(generateNodeIdentityFixtureManifest()).toBe(checkedIn);
  });

  it("writes a deterministic corpus to a clean directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-node-identity-fixtures-"));
    await writeNodeIdentityFixtureManifest(root);
    expect(await readFile(`${root}/manifest.json`, "utf8")).toBe(
      generateNodeIdentityFixtureManifest(),
    );
  });
});

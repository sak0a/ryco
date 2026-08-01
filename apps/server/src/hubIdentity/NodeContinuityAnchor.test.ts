import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeNodeContinuityAnchor } from "./NodeContinuityAnchor.ts";

const CONTINUITY_ID = `nct_${"A".repeat(22)}`;

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "ryco-continuity-anchor-"));
  const path = join(root, "anchors", "hub-continuity.json");
  return { root, path, open: () => makeNodeContinuityAnchor({ path }) };
}

describe("node continuity anchor (§5.7)", () => {
  it("stays unwritten until something is actually anchored", async () => {
    const test = await harness();
    const anchor = await test.open();

    // "Never written" is a state the §7.5 cross-check depends on: it is the one
    // condition in which minting a continuity id is permitted, so a no-op must
    // not quietly turn it into "written, and empty".
    expect(await anchor.read()).toBeNull();
    await anchor.setContinuityId(null);
    await anchor.reserveGeneration(0);
    await anchor.commitGeneration(0);
    expect(await anchor.read()).toBeNull();

    await anchor.setContinuityId(CONTINUITY_ID);
    expect(await anchor.read()).toEqual({
      continuityId: CONTINUITY_ID,
      generationHighWater: 0,
      pendingGeneration: 0,
    });
    // Owner-only, like every other durable security record here.
    expect((await stat(test.path)).mode & 0o777).toBe(0o600);
  });

  it("advances both marks monotonically and never lowers either", async () => {
    const test = await harness();
    const anchor = await test.open();

    // Reserved before the certificate is signed, committed after it is durable,
    // so the pair spans exactly the window a crash can land in.
    await anchor.reserveGeneration(1);
    expect(await anchor.read()).toMatchObject({ generationHighWater: 0, pendingGeneration: 1 });
    await anchor.commitGeneration(1);
    expect(await anchor.read()).toMatchObject({ generationHighWater: 1, pendingGeneration: 1 });

    // A lower value is the rollback these marks exist to detect. Accepting one
    // would erase the evidence, so the record refuses it rather than the caller.
    await anchor.commitGeneration(0);
    await anchor.reserveGeneration(0);
    expect(await anchor.read()).toMatchObject({ generationHighWater: 1, pendingGeneration: 1 });

    // Survives a restart: it is a second durable home, not a cache.
    expect(await (await test.open()).read()).toMatchObject({ generationHighWater: 1 });
  });

  it("reports an unreadable anchor rather than reading it as absent", async () => {
    const test = await harness();
    const anchor = await test.open();
    await anchor.setContinuityId(CONTINUITY_ID);

    for (const invalid of [
      { version: 2 },
      { generationHighWater: -1 },
      { pendingGeneration: 1.5 },
      // A reservation below the committed mark could not have been written by a
      // conforming node, and reading it would understate what has been issued.
      { generationHighWater: 3, pendingGeneration: 2 },
      { continuityId: "not-a-continuity-id" },
    ]) {
      await writeFile(
        test.path,
        `${JSON.stringify({
          version: 1,
          continuityId: CONTINUITY_ID,
          generationHighWater: 1,
          pendingGeneration: 1,
          ...invalid,
        })}\n`,
        { mode: 0o600 },
      );
      // §7.5 forbids minting whenever a stored value exists, so an anchor that
      // cannot be read must never be mistaken for one that was never written.
      await expect((await test.open()).read()).rejects.toMatchObject({ code: "anchor_corrupt" });
    }

    // Only the recovery command may replace it, and only with a mark no lower
    // than the evidence its caller still holds.
    await (
      await test.open()
    ).reset({ continuityId: CONTINUITY_ID, generationHighWater: 4, pendingGeneration: 0 });
    expect(await (await test.open()).read()).toEqual({
      continuityId: CONTINUITY_ID,
      generationHighWater: 4,
      pendingGeneration: 4,
    });
  });

  it("round-trips fields a newer binary wrote", async () => {
    const test = await harness();
    const anchor = await test.open();
    await anchor.setContinuityId(CONTINUITY_ID);
    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    await writeFile(test.path, `${JSON.stringify({ ...stored, futureMark: 9 })}\n`, {
      mode: 0o600,
    });

    await (await test.open()).commitGeneration(2);

    const after = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    expect(after.futureMark).toBe(9);
    expect(after.generationHighWater).toBe(2);
  });
});

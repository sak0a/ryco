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
      policyGenerationHighWater: 0,
      pendingPolicyGeneration: 0,
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
      // The last file written above carried none, so there was nothing to
      // salvage for the pair this caller does not own.
      policyGenerationHighWater: 0,
      pendingPolicyGeneration: 0,
    });
  });

  it("never lowers the §5.7 policy pair through a continuity-driven repair", async () => {
    const test = await harness();
    const anchor = await test.open();
    await anchor.setContinuityId(CONTINUITY_ID);
    await anchor.commitPolicyGeneration(7);
    // The repair case: the record as a whole no longer validates, so the
    // continuity pair has to be replaced from the caller's own evidence.
    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    await writeFile(test.path, `${JSON.stringify({ ...stored, pendingGeneration: -1 })}\n`, {
      mode: 0o600,
    });
    await expect((await test.open()).read()).rejects.toMatchObject({ code: "anchor_corrupt" });

    await (
      await test.open()
    ).reset({ continuityId: CONTINUITY_ID, generationHighWater: 2, pendingGeneration: 2 });

    // The policy mark survives, because it is the ONLY thing that can tell a
    // restored policy record from a current one. Zeroing it here would let a
    // restore be blessed at whatever generation it carried.
    expect(await (await test.open()).read()).toEqual({
      continuityId: CONTINUITY_ID,
      generationHighWater: 2,
      pendingGeneration: 2,
      policyGenerationHighWater: 7,
      pendingPolicyGeneration: 7,
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

  it("carries an independent §5.7 policy-generation pair", async () => {
    const test = await harness();
    const anchor = await test.open();

    await anchor.reservePolicyGeneration(3);
    // Independent of the rotation pair: nothing about a policy change says
    // anything about the identity chain, so neither pair may move the other.
    expect(await anchor.read()).toEqual({
      continuityId: null,
      generationHighWater: 0,
      pendingGeneration: 0,
      policyGenerationHighWater: 0,
      pendingPolicyGeneration: 3,
    });
    await anchor.commitPolicyGeneration(3);
    expect(await anchor.read()).toMatchObject({
      policyGenerationHighWater: 3,
      pendingPolicyGeneration: 3,
      generationHighWater: 0,
    });

    // Monotone in the record itself: a lower value is the rollback this exists
    // to detect, so it is refused here and not only in the caller.
    await anchor.commitPolicyGeneration(1);
    await anchor.reservePolicyGeneration(1);
    expect(await anchor.read()).toMatchObject({ policyGenerationHighWater: 3 });

    // A second durable home, not a cache.
    expect(await (await test.open()).read()).toMatchObject({ policyGenerationHighWater: 3 });
  });

  it("reads an anchor written before the policy pair existed as zero, not corrupt", async () => {
    const test = await harness();
    await (await test.open()).commitGeneration(2);
    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    delete stored["policyGenerationHighWater"];
    delete stored["pendingPolicyGeneration"];
    await writeFile(test.path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });

    // An anchor minted by a release that predates the §5.7 policy generation is
    // a valid anchor for everything it does record, and zero accuses nothing of
    // a rollback.
    const reopened = await test.open();
    expect(await reopened.read()).toMatchObject({
      generationHighWater: 2,
      policyGenerationHighWater: 0,
    });
    await reopened.commitPolicyGeneration(1);
    expect(await reopened.read()).toMatchObject({
      generationHighWater: 2,
      policyGenerationHighWater: 1,
    });
  });

  it("refuses a policy reservation below its committed mark", async () => {
    const test = await harness();
    await (await test.open()).commitPolicyGeneration(4);
    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    await writeFile(test.path, `${JSON.stringify({ ...stored, pendingPolicyGeneration: 1 })}\n`, {
      mode: 0o600,
    });
    // Not a shape a conforming node could have written, and reading it would
    // understate what has been issued.
    await expect((await test.open()).read()).rejects.toMatchObject({ code: "anchor_corrupt" });
  });
});

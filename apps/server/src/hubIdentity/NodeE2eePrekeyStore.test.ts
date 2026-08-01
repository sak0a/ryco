import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeNodeE2eePrekeyStore } from "./NodeE2eePrekeyStore.ts";

const PREKEY = {
  hubOrigin: "https://relay.example",
  nodeId: `node_${"N".repeat(22)}`,
  identityKeyId: `nkey_${"K".repeat(22)}`,
  prekeyId: `epk_${"P".repeat(22)}`,
  secretName: "e2ee-prekey.0123456789abcdef0123456789abcdef",
  agreementPublicKey: Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),
  crossSignature: Buffer.from(new Uint8Array(64).fill(9)).toString("base64url"),
  createdAt: 1_000,
  expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1_000,
};

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "ryco-prekey-store-"));
  const path = join(root, "hub-e2ee-prekey.json");
  const write = async (overrides: Record<string, unknown>): Promise<void> => {
    await writeFile(
      path,
      `${JSON.stringify({
        version: 1,
        revision: 1,
        e2eePrekey: PREKEY,
        outgoingE2eePrekey: null,
        ...overrides,
      })}\n`,
      { mode: 0o600 },
    );
  };
  return { path, write, store: await makeNodeE2eePrekeyStore({ path }) };
}

describe("node E2EE prekey store", () => {
  it("validates the persisted certificate as public material", async () => {
    const test = await harness();

    await test.write({});
    expect((await test.store.read()).e2eePrekey).toEqual(PREKEY);

    // A record written before the field existed reads as "no prekey", not as a
    // corrupt file: §6.4 makes that the re-signing trigger.
    await test.write({ e2eePrekey: undefined, outgoingE2eePrekey: undefined });
    expect((await test.store.read()).e2eePrekey).toBeNull();

    for (const invalid of [
      // Wrong identifier families.
      { prekeyId: `nkey_${"P".repeat(22)}` },
      { identityKeyId: `epk_${"K".repeat(22)}` },
      // Key and signature lengths, and a non-canonical base64url tail — two
      // encodings that decode to one key would let a file name it twice.
      { agreementPublicKey: Buffer.from(new Uint8Array(31)).toString("base64url") },
      { crossSignature: Buffer.from(new Uint8Array(63)).toString("base64url") },
      { agreementPublicKey: `${PREKEY.agreementPublicKey.slice(0, 42)}B` },
      // §6.4 bounds the certificate lifetime, so a longer one is not a
      // certificate this node could have issued.
      { expiresAt: PREKEY.createdAt + 30 * 24 * 60 * 60 * 1_000 + 1 },
      { expiresAt: PREKEY.createdAt },
      { secretName: "E2EE-Prekey.Uppercase" },
    ]) {
      await test.write({ e2eePrekey: { ...PREKEY, ...invalid } });
      await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });
    }
  });

  it("refuses a record that points both prekey slots at one key", async () => {
    const test = await harness();
    // An overlap slot exists only alongside its successor, and never names the
    // successor's key: the §6.4 sweep destroys the key this slot names.
    const outgoing = { ...PREKEY, prekeyId: `epk_${"Q".repeat(22)}`, retainUntil: 2_000 };
    await test.write({ e2eePrekey: null, outgoingE2eePrekey: outgoing });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });
    await test.write({ outgoingE2eePrekey: { ...outgoing, retainUntil: -1 } });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });
    await test.write({ outgoingE2eePrekey: { ...PREKEY, retainUntil: 2_000 } });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });

    await test.write({
      outgoingE2eePrekey: {
        ...outgoing,
        secretName: "e2ee-prekey.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect((await test.store.read()).outgoingE2eePrekey?.retainUntil).toBe(2_000);
  });

  it("refuses to queue a key that is still in service for destruction", async () => {
    const test = await harness();
    // The drain destroys every name on this list. A name that is also a slot in
    // service would let it destroy the key a channel is about to hand shake
    // against, so the two sets must be disjoint by construction.
    await test.write({ retiringSecretNames: [PREKEY.secretName] });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });
    await test.write({ retiringSecretNames: ["e2ee-prekey.gone", "e2ee-prekey.gone"] });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });
    await test.write({ retiringSecretNames: ["E2EE-Prekey.Uppercase"] });
    await expect(test.store.read()).rejects.toMatchObject({ code: "prekey_state_corrupt" });

    await test.write({ retiringSecretNames: ["e2ee-prekey.gone"] });
    expect((await test.store.read()).retiringSecretNames).toEqual(["e2ee-prekey.gone"]);
  });

  it("hands back both agreement-key names, which is the only handle a leave has", async () => {
    const test = await harness();
    await test.write({
      outgoingE2eePrekey: {
        ...PREKEY,
        prekeyId: `epk_${"Q".repeat(22)}`,
        secretName: "e2ee-prekey.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        retainUntil: 2_000,
      },
    });
    expect((await test.store.secretNames()).toSorted()).toEqual([
      "e2ee-prekey.0123456789abcdef0123456789abcdef",
      "e2ee-prekey.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);

    // A key queued for destruction is still a key this node holds, so a leave
    // must erase it too — it is exactly the name a crash mid-destroy leaves.
    await test.write({
      retiringSecretNames: ["e2ee-prekey.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    });
    expect((await test.store.secretNames()).toSorted()).toEqual([
      "e2ee-prekey.0123456789abcdef0123456789abcdef",
      "e2ee-prekey.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);

    await test.store.reset();
    expect(await test.store.secretNames()).toEqual([]);
  });

  it("round-trips fields a newer binary wrote instead of deleting them", async () => {
    const test = await harness();
    await test.write({ futureField: { addedBy: "a newer binary" } });

    await test.store.update((current) => ({ ...current, revision: current.revision + 1 }));

    // The trap this record exists to avoid: the identity state file drops what
    // it does not know, which for the agreement-key names would leave private
    // keys nothing can ever collect. Rebuilding that trap one version later
    // would defeat the point of the move.
    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    expect(stored.futureField).toEqual({ addedBy: "a newer binary" });
    expect(stored.revision).toBe(2);
  });

  it("refuses a compare-and-update that does not advance the revision", async () => {
    const test = await harness();
    await test.write({});
    await expect(test.store.update((current) => current)).rejects.toMatchObject({
      code: "prekey_state_operation_failed",
    });
  });
});

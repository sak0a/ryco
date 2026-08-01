import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign as signBytes,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { E2EE_CONTINUITY_CHAIN_MAX_LENGTH } from "@ryco/shared/relayE2eeConstants";
import {
  decodeNodeIdentityContinuityTranscript,
  validateNodeE2eeContinuityChain,
} from "@ryco/shared/relayE2eeTranscripts";
import { describe, expect, it } from "vite-plus/test";

import {
  makeNodeContinuityAnchor,
  type NodeContinuityAnchor,
  NodeContinuityAnchorError,
  type NodeContinuityAnchorRecord,
} from "./NodeContinuityAnchor.ts";
import {
  decodeContinuityEntries,
  makeNodeIdentityContinuityStore,
  nodeIdentityContinuityChainStatus,
  type NodeIdentityContinuityStore,
} from "./NodeIdentityContinuityStore.ts";

const hubOrigin = "https://hub.example.com";
const SPKI_PREFIX_BYTES = 12;

interface TestKey {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
  readonly sign: (transcript: Uint8Array) => Promise<Uint8Array>;
}

let keyCounter = 0;

function testKey(): TestKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const spki = createPublicKey(privateKey as KeyObject).export({ format: "der", type: "spki" });
  keyCounter += 1;
  return {
    keyId: `nkey_${String(keyCounter).padStart(22, "0")}`,
    publicKey: Uint8Array.from(spki.subarray(SPKI_PREFIX_BYTES)),
    sign: async (transcript) => Uint8Array.from(signBytes(null, transcript, privateKey)),
  };
}

/**
 * The real anchor over a real file, plus a switch that makes reads unreadable —
 * the §7.5 "anchor unreadable" condition, which is a distinct outcome from
 * "anchor absent" and must never mint.
 *
 * Deliberately the production implementation and not a fake: the anchor's whole
 * job is to be a second durable home, and a fake in memory would be neither
 * durable nor separate.
 */
async function testAnchor(path: string): Promise<
  NodeContinuityAnchor & {
    unreadable: boolean;
    readonly forget: () => Promise<void>;
    readonly value: () => Promise<string | null>;
    readonly record: () => Promise<NodeContinuityAnchorRecord | null>;
  }
> {
  const inner = await makeNodeContinuityAnchor({ path });
  const wrapper = {
    ...inner,
    unreadable: false,
    read: async () => {
      if (wrapper.unreadable) throw new NodeContinuityAnchorError("anchor_corrupt");
      return inner.read();
    },
    forget: async () => {
      await rm(path, { force: true });
    },
    value: async () => (await inner.read())?.continuityId ?? null,
    record: () => inner.read(),
  };
  return wrapper;
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "ryco-continuity-"));
  const path = join(root, "hub-continuity.json");
  const anchorPath = join(root, "anchor", "hub-continuity.json");
  const anchor = await testAnchor(anchorPath);
  const open = (): Promise<NodeIdentityContinuityStore> =>
    makeNodeIdentityContinuityStore({ path, anchor });
  return { path, anchorPath, anchor, open, store: await open() };
}

async function resolvedId(store: NodeIdentityContinuityStore): Promise<string> {
  const resolution = await store.resolveContinuityId();
  if (resolution.status !== "resolved") throw new Error(`unresolvable: ${resolution.reason}`);
  return resolution.continuityId;
}

/** Append `count` links, each rotating away from the previous link's new key. */
async function appendChain(
  store: NodeIdentityContinuityStore,
  continuityId: string,
  count: number,
  start: TestKey = testKey(),
) {
  let current = start;
  const keys = [start];
  const appended = [];
  for (let index = 0; index < count; index += 1) {
    const next = testKey();
    keys.push(next);
    appended.push(
      await store.append({
        hubOrigin,
        continuityId,
        oldKeyId: current.keyId,
        oldPublicKey: current.publicKey,
        newKeyId: next.keyId,
        newPublicKey: next.publicKey,
        createdAt: 1_700_000_000_000 + index,
        sign: current.sign,
      }),
    );
    current = next;
  }
  return { results: appended, current, keys };
}

describe("node identity continuity store", () => {
  it("mints the continuity id once, anchor first, and returns it unchanged across restarts", async () => {
    const test = await harness();
    const first = await test.store.resolveContinuityId();
    expect(first).toMatchObject({ status: "resolved", minted: true, repair: null });
    if (first.status !== "resolved") throw new Error("unreachable");
    expect(first.continuityId).toMatch(/^nct_[A-Za-z0-9_-]{22}$/);
    // §7.5: the anchor is committed before anything can advertise the value, so
    // it is observable the moment the mint returns.
    expect(await test.anchor.value()).toBe(first.continuityId);

    // A restart is a fresh store over the same two durable homes.
    const restarted = await test.open();
    const second = await restarted.resolveContinuityId();
    expect(second).toMatchObject({
      status: "resolved",
      continuityId: first.continuityId,
      repair: null,
      minted: false,
    });
  });

  it("restores the stored id from the anchor after a rollback, and never mints a replacement", async () => {
    const test = await harness();
    const minted = await resolvedId(test.store);

    // The §17.11 benign case: an operator restore of the state directory rolls
    // the record back to before the id existed. The anchor is the only thing
    // that can tell this apart from a node that has never advertised.
    await writeFile(
      test.path,
      `${JSON.stringify({
        version: 1,
        revision: 0,
        continuityId: null,
        hubOrigin: null,
        chain: [],
        generationHighWater: 0,
        lastBreak: null,
      })}\n`,
      { mode: 0o600 },
    );

    const repaired = await (await test.open()).resolveContinuityId();
    expect(repaired).toMatchObject({
      status: "resolved",
      continuityId: minted,
      repair: "restored_from_anchor",
      minted: false,
    });
    // Silent on the wire by requirement: the identical value is re-advertised,
    // so every pin still matches and no client sees an identity event.
    expect(await test.anchor.value()).toBe(minted);
  });

  it("adopts a stored id into a lost anchor rather than minting", async () => {
    const test = await harness();
    const minted = await resolvedId(test.store);
    await test.anchor.forget();

    const adopted = await (await test.open()).resolveContinuityId();
    expect(adopted).toMatchObject({
      status: "resolved",
      continuityId: minted,
      repair: "anchor_adopted",
      minted: false,
    });
    expect(await test.anchor.value()).toBe(minted);
  });

  it("declines to advertise and declines to mint when the anchor cannot decide the lineage", async () => {
    const disagreeing = await harness();
    const minted = await resolvedId(disagreeing.store);
    await disagreeing.anchor.setContinuityId(`nct_${"Z".repeat(22)}`);
    const conflicted = await (await disagreeing.open()).resolveContinuityId();
    expect(conflicted).toMatchObject({ status: "unresolvable", reason: "anchor_disagrees" });
    if (conflicted.status !== "unresolvable") throw new Error("unreachable");
    expect(conflicted.remedy).toContain("break continuity");
    // Neither value was chosen and nothing was minted: two values claim the
    // lineage and §7.5 forbids the node from picking one.
    expect((await disagreeing.store.read()).continuityId).toBe(minted);

    const unreadable = await harness();
    unreadable.anchor.unreadable = true;
    expect(await unreadable.store.resolveContinuityId()).toMatchObject({
      status: "unresolvable",
      reason: "anchor_unreadable",
    });
    unreadable.anchor.unreadable = false;
    expect(await unreadable.anchor.value()).toBeNull();
  });

  it("issues a certificate the Phase 1 chain validator accepts under the outgoing key", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const outgoing = testKey();
    const incoming = testKey();

    const appended = await test.store.append({
      hubOrigin,
      continuityId,
      oldKeyId: outgoing.keyId,
      oldPublicKey: outgoing.publicKey,
      newKeyId: incoming.keyId,
      newPublicKey: incoming.publicKey,
      createdAt: 1_700_000_000_000,
      sign: outgoing.sign,
    });
    expect(appended.generation).toBe(1);
    expect(appended.pruned).toBe(false);

    // The acceptance test that matters is the client's, so it is the client's
    // validator that runs here — not a local restatement of the chain rules.
    expect(
      validateNodeE2eeContinuityChain({
        chain: appended.chain,
        hubOrigin,
        continuityId,
        identityPublicKey: incoming.publicKey,
      }),
    ).toMatchObject({ kind: "ok" });

    // A pinned client anchored at the outgoing key reaches the new one, which is
    // the §13.3 silent pin update.
    const [entry] = appended.chain;
    if (entry === undefined) throw new Error("unreachable");
    const decoded = decodeNodeIdentityContinuityTranscript(entry.transcript);
    expect(decoded).toMatchObject({ kind: "ok" });
    if (decoded.kind !== "ok") throw new Error("unreachable");
    expect(
      validateNodeE2eeContinuityChain({
        chain: appended.chain,
        hubOrigin,
        continuityId,
        identityPublicKey: incoming.publicKey,
        pinnedIdentityFingerprint: decoded.value.oldFingerprint,
      }),
    ).toMatchObject({ kind: "ok", pinnedFingerprintUnchanged: false });

    // The signature is the outgoing key's: swapping the identity the chain is
    // checked against is exactly what a spliced chain looks like.
    expect(
      validateNodeE2eeContinuityChain({
        chain: appended.chain,
        hubOrigin,
        continuityId,
        identityPublicKey: outgoing.publicKey,
      }),
    ).toEqual({ kind: "error", failure: "identity_key_mismatch" });
  });

  it("keeps generations consecutive and prunes only the oldest, only beyond the bound", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const overflow = E2EE_CONTINUITY_CHAIN_MAX_LENGTH + 1;
    const { results, current } = await appendChain(test.store, continuityId, overflow);

    expect(results.map((result) => result.generation)).toEqual(
      Array.from({ length: overflow }, (_, index) => index + 1),
    );
    expect(results.slice(0, E2EE_CONTINUITY_CHAIN_MAX_LENGTH).every((r) => !r.pruned)).toBe(true);
    expect(results[overflow - 1]?.pruned).toBe(true);

    const record = await test.store.read();
    expect(record.chain).toHaveLength(E2EE_CONTINUITY_CHAIN_MAX_LENGTH);
    expect(record.generationHighWater).toBe(overflow);

    // Pruning removes the oldest and leaves a chain that still verifies whole:
    // generation 1 is gone, the retained run is consecutive, and it reaches the
    // node's current key.
    const entries = decodeContinuityEntries(record.chain);
    const validated = validateNodeE2eeContinuityChain({
      chain: entries,
      hubOrigin,
      continuityId,
      identityPublicKey: current.publicKey,
    });
    expect(validated).toMatchObject({ kind: "ok" });
    if (validated.kind !== "ok") throw new Error("unreachable");
    expect(validated.certificates.map((certificate) => certificate.generation)).toEqual(
      Array.from({ length: E2EE_CONTINUITY_CHAIN_MAX_LENGTH }, (_, index) => index + 2),
    );
  });

  it("fails closed instead of reusing a generation a rollback erased", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const { keys } = await appendChain(test.store, continuityId, 3);
    const record = await test.store.read();

    // A restore that returns the chain AND the identity key to generation 2
    // while the high-water mark remembers that generation 3 was issued. The
    // chain is internally consistent and reaches the key the node now holds, so
    // the Phase 1 validator accepts it — the high-water comparison is the only
    // thing that can see the rollback at all.
    const restoredKey = keys[2];
    if (restoredKey === undefined) throw new Error("unreachable");
    const rolledBack = { ...record, chain: record.chain.slice(0, 2) };
    expect(
      validateNodeE2eeContinuityChain({
        chain: decodeContinuityEntries(rolledBack.chain),
        hubOrigin,
        continuityId,
        identityPublicKey: restoredKey.publicKey,
      }),
    ).toMatchObject({ kind: "ok" });
    expect(
      nodeIdentityContinuityChainStatus({
        record: rolledBack,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: restoredKey.publicKey,
      }),
    ).toEqual({ status: "broken", reason: "rolled_back" });

    await writeFile(test.path, `${JSON.stringify({ ...rolledBack, revision: 99 })}\n`, {
      mode: 0o600,
    });
    const reopened = await test.open();
    const next = testKey();
    // §7.5: no generation is reused and no missing link is synthesized. The
    // append refuses rather than issuing generation 3 a second time.
    await expect(
      reopened.append({
        hubOrigin,
        continuityId,
        oldKeyId: restoredKey.keyId,
        oldPublicKey: restoredKey.publicKey,
        newKeyId: next.keyId,
        newPublicKey: next.publicKey,
        createdAt: 1_700_000_100_000,
        sign: restoredKey.sign,
      }),
    ).rejects.toMatchObject({ code: "continuity_generation_unavailable" });
    expect((await reopened.read()).chain).toHaveLength(2);
  });

  it("reads a chain that leads the identity record only while the incoming key is staged", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const outgoing = testKey();
    const incoming = testKey();
    await test.store.append({
      hubOrigin,
      continuityId,
      oldKeyId: outgoing.keyId,
      oldPublicKey: outgoing.publicKey,
      newKeyId: incoming.keyId,
      newPublicKey: incoming.publicKey,
      createdAt: 1_700_000_000_000,
      sign: outgoing.sign,
    });
    const record = await test.store.read();

    // §7.5 requires the certificate to be durable before the promotion
    // completes, so there is a window where the identity record still names the
    // outgoing key. That window is the staged rotation, and nothing else.
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: outgoing.publicKey,
        stagedIdentityPublicKey: incoming.publicKey,
      }),
    ).toMatchObject({ status: "intact", generation: 1 });
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: outgoing.publicKey,
      }),
    ).toEqual({ status: "broken", reason: "identity_key_mismatch" });
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin: "https://other.example.com",
        activeIdentityPublicKey: incoming.publicKey,
      }),
    ).toEqual({ status: "broken", reason: "hub_origin_changed" });
    // A chain that lost its certificates with no break recorded is a rollback,
    // not a node that never rotated.
    expect(
      nodeIdentityContinuityChainStatus({
        record: { ...record, chain: [] },
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: incoming.publicKey,
      }),
    ).toEqual({ status: "broken", reason: "rolled_back" });

    // The other half of that window: a promotion interrupted between its commit
    // and the destruction of the outgoing key leaves the record naming a key the
    // node no longer holds. The chain still reaches the incoming key, so nothing
    // is broken.
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: undefined,
        stagedIdentityPublicKey: incoming.publicKey,
      }),
    ).toMatchObject({ status: "intact", generation: 1 });
    // And a node holding neither key is a chain that reaches nothing in
    // custody: §7.5 answers that with a broken chain, not with a failure of the
    // check itself.
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: undefined,
      }),
    ).toEqual({ status: "broken", reason: "identity_key_mismatch" });
  });

  it("is idempotent on the old-to-new pair, so a retried promotion cannot wedge the chain", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const outgoing = testKey();
    const incoming = testKey();
    const input = {
      hubOrigin,
      continuityId,
      oldKeyId: outgoing.keyId,
      oldPublicKey: outgoing.publicKey,
      newKeyId: incoming.keyId,
      newPublicKey: incoming.publicKey,
      createdAt: 1_700_000_000_000,
      sign: outgoing.sign,
    };

    const first = await test.store.append(input);
    // The promotion this certificate describes commits AFTER it, so any failure
    // in between brings the operator back here with the work already done. A
    // second certificate for one rotation would produce a chain whose links no
    // longer meet — every later retry would fail validation forever — and it
    // would advance the mark past a generation that was never issued.
    const retried = await test.store.append(input);
    expect(retried.generation).toBe(first.generation);
    expect(retried.chain).toEqual(first.chain);
    expect((await test.store.read()).chain).toHaveLength(1);
    expect((await test.anchor.record())?.generationHighWater).toBe(1);

    // A genuinely different rotation still appends.
    const next = testKey();
    const appended = await test.store.append({
      ...input,
      oldKeyId: incoming.keyId,
      oldPublicKey: incoming.publicKey,
      newKeyId: next.keyId,
      newPublicKey: next.publicKey,
      sign: incoming.sign,
    });
    expect(appended.generation).toBe(2);
  });

  it("verifies a certificate's signature before letting its generation move the mark", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    await appendChain(test.store, continuityId, 1);
    const stored = JSON.parse(await readFile(test.path, "utf8")) as {
      readonly chain: readonly { readonly transcript: string; readonly signature: string }[];
    };
    const entry = stored.chain[0];
    if (entry === undefined) throw new Error("unreachable");

    // The mark trailing the chain is the ordinary crash window between
    // retaining a certificate and advancing the mark, and the store heals it by
    // adopting the newest retained certificate's generation. Sound only if that
    // certificate is verified first: the mark never comes back down, so a
    // corrupted or fabricated entry claiming any generation at all would
    // ratchet it past every generation this node can legitimately issue and
    // leave it permanently unable to rotate.
    const rewind = () =>
      test.anchor.reset({ continuityId, generationHighWater: 0, pendingGeneration: 0 });
    await rewind();
    expect((await (await test.open()).read()).generationHighWater).toBe(1);

    await rewind();
    const signature = Buffer.from(entry.signature, "base64url");
    signature.set([(signature[0] ?? 0) ^ 0xff], 0);
    await writeFile(
      test.path,
      `${JSON.stringify({
        ...stored,
        chain: [{ ...entry, signature: signature.toString("base64url") }],
      })}\n`,
      { mode: 0o600 },
    );
    const reopened = await test.open();
    expect((await reopened.read()).generationHighWater).toBe(0);
    expect((await test.anchor.record())?.generationHighWater).toBe(0);
    // And the unverifiable entry is not evidence of a previous generation
    // either, so §7.5's fail-closed refusal applies rather than a guess.
    const outgoing = testKey();
    const incoming = testKey();
    await expect(
      reopened.append({
        hubOrigin,
        continuityId,
        oldKeyId: outgoing.keyId,
        oldPublicKey: outgoing.publicKey,
        newKeyId: incoming.keyId,
        newPublicKey: incoming.publicKey,
        createdAt: 1_700_000_200_000,
        sign: outgoing.sign,
      }),
    ).rejects.toMatchObject({ code: "continuity_chain_invalid" });
  });

  it("catches a rollback that takes the chain and the record's own mark with it", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const { keys } = await appendChain(test.store, continuityId, 2);
    const rolledBack = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;

    // The restore: the operator puts back a copy of the state directory taken
    // after generation 2. Then another rotation happens.
    const third = testKey();
    const second = keys[2];
    if (second === undefined) throw new Error("unreachable");
    await test.store.append({
      hubOrigin,
      continuityId,
      oldKeyId: second.keyId,
      oldPublicKey: second.publicKey,
      newKeyId: third.keyId,
      newPublicKey: third.publicKey,
      createdAt: 1_700_002_000_000,
      sign: second.sign,
    });
    await writeFile(test.path, `${JSON.stringify(rolledBack)}\n`, { mode: 0o600 });

    // The chain is internally valid at generation 2 and consistent with the key
    // it names, so nothing inside the state directory can tell. Only a mark the
    // restore could not reach can, which is why it does not live in this file.
    const restored = await test.open();
    const record = await restored.read();
    expect(record.chain).toHaveLength(2);
    expect(record.generationHighWater).toBe(3);
    expect(
      nodeIdentityContinuityChainStatus({
        record,
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: second.publicKey,
      }),
    ).toEqual({ status: "broken", reason: "rolled_back" });
  });

  it("breaks explicitly: the chain goes, the lineage and the high-water mark stay", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const { current } = await appendChain(test.store, continuityId, 2);

    const broken = await test.store.recordBreak({ reason: "left_hub", at: 1_700_000_500_000 });
    expect(broken.chain).toEqual([]);
    expect(broken.hubOrigin).toBeNull();
    expect(broken.continuityId).toBe(continuityId);
    expect(broken.generationHighWater).toBe(2);
    expect(broken.lastBreak).toEqual({ reason: "left_hub", at: 1_700_000_500_000, generation: 2 });
    expect(await test.anchor.value()).toBe(continuityId);

    // A break is not a reset: the next rotation continues past every generation
    // this node ever issued, so no client can be shown a reused generation.
    const resumed = await appendChain(test.store, continuityId, 1, current);
    expect(resumed.results[0]?.generation).toBe(3);

    // Idempotent, because a resumed teardown replays it.
    const again = await test.store.recordBreak({ reason: "left_hub", at: 1_700_000_600_000 });
    const repeat = await test.store.recordBreak({ reason: "left_hub", at: 1_700_000_700_000 });
    expect(repeat.revision).toBe(again.revision);
    expect(repeat.lastBreak?.at).toBe(1_700_000_600_000);

    // An empty chain plus a recorded break is not a rollback: it is a node whose
    // lineage is intact and whose chain deliberately reaches nothing.
    expect(
      nodeIdentityContinuityChainStatus({
        record: await test.store.read(),
        continuityId,
        hubOrigin,
        activeIdentityPublicKey: testKey().publicKey,
      }),
    ).toMatchObject({ status: "intact", generation: 3 });
  });

  it("mints a fresh lineage only through the explicit recovery outcomes", async () => {
    const test = await harness();
    const original = await resolvedId(test.store);
    await appendChain(test.store, original, 1);

    const minted = await test.store.breakAndRemint({
      reason: "operator_break",
      at: 1_700_001_000_000,
    });
    expect(minted).not.toBe(original);
    expect(await test.anchor.value()).toBe(minted);
    const afterRemint = await test.store.read();
    expect(afterRemint.continuityId).toBe(minted);
    expect(afterRemint.chain).toEqual([]);
    expect(afterRemint.generationHighWater).toBe(1);
    expect(await resolvedId(await test.open())).toBe(minted);

    // The other outcome: re-adopt a value the operator confirms. Adopting a
    // different lineage retires the chain rather than renaming its entries,
    // because every entry carries the id as a signed element.
    await appendChain(test.store, minted, 1);
    const adopted = await test.store.adoptContinuityId(original, 1_700_002_000_000);
    expect(adopted).toBe(original);
    expect(await test.anchor.value()).toBe(original);
    const afterAdopt = await test.store.read();
    expect(afterAdopt.continuityId).toBe(original);
    expect(afterAdopt.chain).toEqual([]);
    expect(afterAdopt.lastBreak?.reason).toBe("continuity_id_replaced");
    expect(afterAdopt.generationHighWater).toBe(2);
  });

  it("round-trips fields a newer binary wrote instead of deleting them", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    const record = await test.store.read();

    // The downgrade case this record exists to survive. A newer release adds a
    // field; this binary must hand it back untouched, because the alternative —
    // reconstructing from known keys alone, as the identity state file does — is
    // what silently destroys lineage on a rollback.
    await writeFile(
      test.path,
      `${JSON.stringify({
        ...record,
        futureField: { retainedBy: "a newer binary", entries: [1, 2, 3] },
      })}\n`,
      { mode: 0o600 },
    );

    const reopened = await test.open();
    await appendChain(reopened, continuityId, 1);
    await reopened.recordBreak({ reason: "operator_break", at: 1_700_003_000_000 });

    const stored = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    expect(stored.futureField).toEqual({ retainedBy: "a newer binary", entries: [1, 2, 3] });
    expect(stored.continuityId).toBe(continuityId);
    // The mark is NOT here. It lives in the anchor, outside the state directory,
    // because a mark this record carried would roll back with the very chain it
    // exists to police (§5.7). A break keeps it, so the next rotation cannot
    // land on a generation this node already issued.
    expect(stored.generationHighWater).toBeUndefined();
    expect((await test.anchor.record())?.generationHighWater).toBe(1);
    expect((await reopened.read()).generationHighWater).toBe(1);
  });

  it("rejects a stored record that names certificates without a lineage", async () => {
    const test = await harness();
    const continuityId = await resolvedId(test.store);
    await appendChain(test.store, continuityId, 1);
    const record = await test.store.read();

    await writeFile(test.path, `${JSON.stringify({ ...record, continuityId: null })}\n`, {
      mode: 0o600,
    });
    const reopened = await test.open();
    await expect(reopened.read()).rejects.toMatchObject({ code: "continuity_state_corrupt" });
  });
});

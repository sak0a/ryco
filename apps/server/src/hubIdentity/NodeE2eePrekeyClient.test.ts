import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
  E2EE_PREKEY_ROTATION_OVERLAP,
} from "@ryco/shared/relayE2eeConstants";
import {
  deriveE2eeAgreementPublicKey,
  e2eeKeyFingerprint,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import {
  encodeNodeE2eePrekeyTranscript,
  verifyNodeE2eeCapabilityCrossSignature,
} from "@ryco/shared/relayE2eeTranscripts";
import { describe, expect, it } from "vite-plus/test";

import { makeLocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import { makeNodeAgreementIdentity } from "./NodeAgreementIdentity.ts";
import {
  E2EE_PREKEY_EXPIRED_REMEDY,
  makeNodeE2eePrekeyClient,
  type NodeE2eePrekeyCertificate,
  nodeE2eePrekeyValidity,
} from "./NodeE2eePrekeyClient.ts";
import {
  makeNodeE2eePrekeyStore,
  type NodeE2eePrekeyRecord,
  type NodeE2eePrekeyStore,
} from "./NodeE2eePrekeyStore.ts";
import { makeNodeSigningIdentity, type NodeSigningIdentity } from "./NodeSigningIdentity.ts";
import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

const HUB_ORIGIN = "https://relay.example";
const NODE_ID = `node_${"N".repeat(22)}`;
const KEY_ID = `nkey_${"K".repeat(22)}`;
const START = 1_700_000_000_000;

const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

function memoryStore(): ProtectedSecretStore & { readonly values: Map<string, Uint8Array> } {
  const values = new Map<string, Uint8Array>();
  return {
    backend: "permissioned-file",
    values,
    get: async (name) => {
      const value = values.get(name);
      return value === undefined ? null : Uint8Array.from(value);
    },
    create: async (name, value) => {
      if (values.has(name)) {
        throw Object.assign(new Error("conflict"), { code: "protected_store_conflict" });
      }
      values.set(name, Uint8Array.from(value));
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

async function harness(overrides?: { readonly nodeId?: string }) {
  const root = await mkdtemp(join(tmpdir(), "ryco-e2ee-prekey-"));
  const statePath = join(root, "hub-identity.json");
  const prekeyPath = join(root, "hub-e2ee-prekey.json");
  const stateStore = await makeLocalHubIdentityStateStore(statePath);
  const prekeyStore = await makeNodeE2eePrekeyStore({ path: prekeyPath });
  const secrets = memoryStore();
  const base = makeNodeSigningIdentity(secrets);
  let signs = 0;
  const signingIdentity: NodeSigningIdentity = {
    ...base,
    sign: async (secretName, transcript) => {
      signs += 1;
      return base.sign(secretName, transcript);
    },
  };
  const identity = await signingIdentity.generate("node-key.active");
  await stateStore.readOrCreate();
  await stateStore.update((current) => ({
    ...current,
    revision: current.revision + 1,
    protectedStoreBackend: "os",
    activeNode: {
      hubOrigin: HUB_ORIGIN,
      nodeId: overrides?.nodeId ?? NODE_ID,
      activeKeyId: KEY_ID,
      activeKeySecretName: "node-key.active",
      cleanupPollingSecretName: null,
      enrolledAt: 1,
    },
  }));

  let clock = START;
  let authenticationKey = { keyId: KEY_ID, secretName: "node-key.active" };
  const agreementIdentity = makeNodeAgreementIdentity(secrets);
  const makeClient = (prekeyStoreOverride: NodeE2eePrekeyStore = prekeyStore) =>
    makeNodeE2eePrekeyClient({
      agreementIdentity,
      signingIdentity,
      keySelector: { authenticationKey: async () => authenticationKey },
      stateStore,
      prekeyStore: prekeyStoreOverride,
      now: () => clock,
    });

  return {
    statePath,
    prekeyPath,
    stateStore,
    prekeyStore,
    secrets,
    identity,
    agreementIdentity,
    signingIdentity,
    client: makeClient(),
    makeClient,
    read: (): Promise<NodeE2eePrekeyRecord> => prekeyStore.read(),
    signCount: () => signs,
    setClock: (value: number) => {
      clock = value;
    },
    setAuthenticationKey: (value: { keyId: string; secretName: string }) => {
      authenticationKey = value;
    },
  };
}

function crossSignatureVerifies(
  certificate: NodeE2eePrekeyCertificate,
  identityPublicKey: Uint8Array,
): boolean {
  return verifyNodeE2eeCapabilityCrossSignature({
    hubOrigin: certificate.hubOrigin,
    nodeId: certificate.nodeId,
    identityKeyId: certificate.identityKeyId,
    identityPublicKey,
    identityFingerprint: e2eeKeyFingerprint("node-identity", identityPublicKey),
    prekeyCertificate: {
      ...certificate,
      agreementFingerprint: e2eeKeyFingerprint("agreement", certificate.agreementPublicKey),
    },
  });
}

describe("node E2EE prekey certificate (§6.4, §7.3)", () => {
  it("issues a certificate that the Phase 1 verifier accepts", async () => {
    const context = await harness();
    const certificate = await context.client.ensure(HUB_ORIGIN);

    expect(certificate.prekeyId).toMatch(/^epk_[A-Za-z0-9_-]{22}$/);
    expect(certificate.hubOrigin).toBe(HUB_ORIGIN);
    expect(certificate.nodeId).toBe(NODE_ID);
    expect(certificate.identityKeyId).toBe(KEY_ID);
    expect(certificate.agreementPublicKey).toHaveLength(32);
    expect(certificate.crossSignature).toHaveLength(64);
    // §6.4: issuers SHOULD use exactly `E2EE_PREKEY_LIFETIME`.
    expect(certificate.createdAt).toBe(START);
    expect(certificate.expiresAt - certificate.createdAt).toBe(E2EE_PREKEY_LIFETIME);

    // The §7.6 reconstruction — the check a client actually runs.
    expect(crossSignatureVerifies(certificate, context.identity.publicKey)).toBe(true);

    // And the same bytes through the §7.3 encoder directly, so the certificate is
    // pinned to the named encoder rather than to whatever this module produced.
    const transcript = encodeNodeE2eePrekeyTranscript({
      hubOrigin: HUB_ORIGIN,
      nodeId: NODE_ID,
      identityKeyId: KEY_ID,
      prekeyId: certificate.prekeyId,
      identityPublicKey: context.identity.publicKey,
      agreementPublicKey: certificate.agreementPublicKey,
      createdAt: certificate.createdAt,
      expiresAt: certificate.expiresAt,
    });
    expect(
      verifyE2eeSignature({
        algorithm: "ed25519",
        publicKey: context.identity.publicKey,
        message: transcript,
        signature: certificate.crossSignature,
      }),
    ).toBe(true);

    // A prekey lifted onto another node's identity does not verify.
    const other = await makeNodeSigningIdentity(memoryStore()).generate("node-key.other");
    expect(crossSignatureVerifies(certificate, other.publicKey)).toBe(false);
  });

  it("persists public material only, and the secret only in the protected store", async () => {
    const context = await harness();
    const certificate = await context.client.ensure(HUB_ORIGIN);
    const record = (await context.read()).e2eePrekey!;

    expect(record.secretName).toMatch(/^e2ee-prekey\.[0-9a-f]{32}$/);
    expect(record.agreementPublicKey).toBe(
      Buffer.from(certificate.agreementPublicKey).toString("base64url"),
    );
    expect(record.crossSignature).toBe(
      Buffer.from(certificate.crossSignature).toString("base64url"),
    );

    // The scalar lives in custody and nowhere else. Comparing against the actual
    // stored bytes is what makes this an assertion rather than an assumption.
    const stored = context.secrets.values.get(record.secretName)!;
    expect(stored).toHaveLength(32);
    expect(hex(deriveE2eeAgreementPublicKey(stored))).toBe(hex(certificate.agreementPublicKey));
    const serialized = JSON.stringify(await context.read());
    expect(serialized).not.toContain(Buffer.from(stored).toString("base64url"));
    expect(serialized).not.toContain(hex(stored));

    // The record survives a restart and re-parses byte-identically, so the
    // parser accepts exactly what the writer emits.
    const reopened = await makeNodeE2eePrekeyStore({ path: context.prekeyPath });
    expect((await reopened.read()).e2eePrekey).toEqual(record);
  });

  it("advertises the stored certificate without re-signing per channel", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);
    const signsAfterIssue = context.signCount();

    const first = await context.client.advertised(HUB_ORIGIN);
    const second = await context.client.advertised(HUB_ORIGIN);
    const reEnsured = await context.client.ensure(HUB_ORIGIN);

    expect(first).toEqual(issued);
    expect(second).toEqual(issued);
    expect(reEnsured).toEqual(issued);
    expect(context.signCount()).toBe(signsAfterIssue);
    expect((await context.read()).e2eePrekey!.prekeyId).toBe(issued.prekeyId);
  });
});

describe("node E2EE prekey expiry (§6.4)", () => {
  const window = { createdAt: START, expiresAt: START + E2EE_PREKEY_LIFETIME };

  it("evaluates the validity window against the clock-skew allowance", () => {
    expect(nodeE2eePrekeyValidity(window, START)).toBe("usable");

    // Upper bound: valid through `expiresAt`, still valid through the full skew
    // allowance, expired one millisecond later.
    expect(nodeE2eePrekeyValidity(window, window.expiresAt)).toBe("renewable");
    expect(nodeE2eePrekeyValidity(window, window.expiresAt + E2EE_MAX_CLOCK_SKEW)).toBe(
      "renewable",
    );
    expect(nodeE2eePrekeyValidity(window, window.expiresAt + E2EE_MAX_CLOCK_SKEW + 1)).toBe(
      "expired",
    );

    // Lower bound: a clock that jumped back further than the allowance makes the
    // node's own certificate evidence no verifier would accept.
    expect(nodeE2eePrekeyValidity(window, window.createdAt - E2EE_MAX_CLOCK_SKEW)).toBe("usable");
    expect(nodeE2eePrekeyValidity(window, window.createdAt - E2EE_MAX_CLOCK_SKEW - 1)).toBe(
      "expired",
    );

    // The §6.4 re-sign trigger: expiring within the rotation overlap.
    expect(nodeE2eePrekeyValidity(window, window.expiresAt - E2EE_PREKEY_ROTATION_OVERLAP)).toBe(
      "renewable",
    );
    expect(
      nodeE2eePrekeyValidity(window, window.expiresAt - E2EE_PREKEY_ROTATION_OVERLAP - 1),
    ).toBe("usable");
  });

  it("re-signs on the advertisement path rather than expiring while the node runs", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);

    // Still usable: a pure read, and no signature.
    const signsAfterIssue = context.signCount();
    context.setClock(issued.expiresAt - E2EE_PREKEY_ROTATION_OVERLAP - 1);
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(issued.prekeyId);
    expect(context.signCount()).toBe(signsAfterIssue);

    // §6.4's re-sign trigger reached, with no restart and no operator action.
    // Startup is a floor, not the only opportunity: a node that runs past its
    // own expiry would otherwise stop advertising E2EE until it was restarted.
    context.setClock(issued.expiresAt + E2EE_MAX_CLOCK_SKEW + 1);
    const replaced = await context.client.advertised(HUB_ORIGIN);
    expect(replaced.prekeyId).not.toBe(issued.prekeyId);
    expect(crossSignatureVerifies(replaced, context.identity.publicKey)).toBe(true);
    // And it settles: the next advertisement is a pure read again.
    const signsAfterRepair = context.signCount();
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(replaced.prekeyId);
    expect(context.signCount()).toBe(signsAfterRepair);

    // The §6.4 diagnostic stays reachable where it is the answer: a channel that
    // advertised the old prekey before it expired cannot complete against it.
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, issued.prekeyId, () => "unreachable"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_expired" });
    // §6.4 pairs the diagnostic with a specific repair, and names both halves of
    // it: the re-sign and the forced rotation command.
    expect(E2EE_PREKEY_EXPIRED_REMEDY).toContain("startup");
    expect(E2EE_PREKEY_EXPIRED_REMEDY).toContain("rotation");
  });

  it("re-signs at startup while the certificate is still valid but renewable", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);

    context.setClock(issued.expiresAt - E2EE_PREKEY_ROTATION_OVERLAP - 1);
    expect((await context.client.ensure(HUB_ORIGIN)).prekeyId).toBe(issued.prekeyId);

    context.setClock(issued.expiresAt - E2EE_PREKEY_ROTATION_OVERLAP);
    const renewed = await context.client.ensure(HUB_ORIGIN);
    expect(renewed.prekeyId).not.toBe(issued.prekeyId);
    // Still valid, so it enters the overlap rather than being destroyed (§6.4).
    expect((await context.read()).outgoingE2eePrekey?.prekeyId).toBe(issued.prekeyId);
  });

  it("re-signs when the identity key it was cross-signed under has rotated", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);

    const rotatedKeyId = `nkey_${"R".repeat(22)}`;
    const rotated = await context.signingIdentity.generate("node-key.rotated");
    context.setAuthenticationKey({ keyId: rotatedKeyId, secretName: "node-key.rotated" });

    // Advertising the old certificate now would put a stale `identityKeyId` in
    // the §7.6 statement, which the reconstruction rejects. Failing instead
    // would be worse than useless: the binding changes the moment a rotation
    // activates, so the node would be off E2EE on every channel until someone
    // restarted it. The advertisement path re-signs.
    const reissued = await context.client.advertised(HUB_ORIGIN);
    expect(reissued.identityKeyId).toBe(rotatedKeyId);
    expect(reissued.prekeyId).not.toBe(issued.prekeyId);
    expect(crossSignatureVerifies(reissued, rotated.publicKey)).toBe(true);
    expect(crossSignatureVerifies(reissued, context.identity.publicKey)).toBe(false);
  });

  it("re-signs when the stored certificate no longer verifies", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);

    // A state file whose signature was replaced with a well-formed but wrong
    // one: structurally valid, cryptographically worthless.
    await context.prekeyStore.update((current) => ({
      ...current,
      revision: current.revision + 1,
      e2eePrekey: {
        ...current.e2eePrekey!,
        crossSignature: Buffer.from(new Uint8Array(64).fill(9)).toString("base64url"),
      },
    }));

    const repaired = await context.client.ensure(HUB_ORIGIN);
    expect(repaired.prekeyId).not.toBe(issued.prekeyId);
    expect(crossSignatureVerifies(repaired, context.identity.publicKey)).toBe(true);
  });

  it("refuses to issue for a node id this protocol version cannot encode", async () => {
    // Pre-existing grammar disagreement: the Hub may mint node ids longer than
    // the §7.1 identifier format admits. Such a node cannot be represented in a
    // §7.3 transcript at all, which must read as "cannot serve E2EE" and must
    // not leave an agreement key behind.
    const context = await harness({ nodeId: `node_${"L".repeat(30)}` });
    await expect(context.client.ensure(HUB_ORIGIN)).rejects.toMatchObject({
      code: "e2ee_prekey_unavailable",
    });
    expect((await context.read()).e2eePrekey).toBeNull();
    expect(context.secrets.values.has("node-key.active")).toBe(true);
    expect([...context.secrets.values.keys()].filter((n) => n.startsWith("e2ee-prekey."))).toEqual(
      [],
    );
  });

  it("refuses every operation when no active node owns the origin", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    for (const call of [
      () => context.client.ensure("https://other.example"),
      () => context.client.rotate("https://other.example"),
      () => context.client.advertised("https://other.example"),
      () => context.client.ensure("not-an-origin"),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "e2ee_prekey_unavailable" });
    }
  });
});

describe("node E2EE prekey staged rotation and overlap (§6.4)", () => {
  it("stages, promotes, and retains the outgoing key for the overlap window", async () => {
    const context = await harness();
    const outgoing = await context.client.ensure(HUB_ORIGIN);

    context.setClock(START + 60_000);
    const revisionBefore = (await context.read()).revision;
    const incoming = await context.client.rotate(HUB_ORIGIN);
    const state = await context.read();

    // The promotion is ONE compare-and-update, so a crash lands on one side of
    // it and never on a torn mixture.
    expect(state.revision).toBe(revisionBefore + 1);
    expect(state.e2eePrekey!.prekeyId).toBe(incoming.prekeyId);
    expect(state.outgoingE2eePrekey!.prekeyId).toBe(outgoing.prekeyId);
    expect(state.outgoingE2eePrekey!.retainUntil).toBe(
      START + 60_000 + E2EE_PREKEY_ROTATION_OVERLAP,
    );
    expect(state.outgoingE2eePrekey!.secretName).not.toBe(state.e2eePrekey!.secretName);

    // Both private halves are alive during the window, and each certificate
    // still verifies within its own validity period.
    for (const certificate of [incoming, outgoing]) {
      expect(crossSignatureVerifies(certificate, context.identity.publicKey)).toBe(true);
      const derived = await context.client.withPrekeySecret(
        HUB_ORIGIN,
        certificate.prekeyId,
        (secretKey) => hex(deriveE2eeAgreementPublicKey(secretKey)),
      );
      expect(derived).toBe(hex(certificate.agreementPublicKey));
    }

    // Only the incoming one is advertised.
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(incoming.prekeyId);
  });

  it("closes the overlap on its deadline and destroys the outgoing key", async () => {
    const context = await harness();
    const outgoing = await context.client.ensure(HUB_ORIGIN);
    const incoming = await context.client.rotate(HUB_ORIGIN);
    const retainUntil = (await context.read()).outgoingE2eePrekey!.retainUntil;
    const outgoingSecretName = (await context.read()).outgoingE2eePrekey!.secretName;

    // The deadline is inclusive: a handshake at exactly `retainUntil` still
    // resolves against the prekey that channel was advertised.
    context.setClock(retainUntil);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, outgoing.prekeyId, () => "ok"),
    ).resolves.toBe("ok");
    await context.client.sweep();
    expect((await context.read()).outgoingE2eePrekey).not.toBeNull();

    context.setClock(retainUntil + 1);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, outgoing.prekeyId, () => "ok"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_not_found" });

    await context.client.sweep();
    expect((await context.read()).outgoingE2eePrekey).toBeNull();
    expect(context.secrets.values.has(outgoingSecretName)).toBe(false);
    // The active prekey is untouched by the sweep.
    expect(context.secrets.values.has((await context.read()).e2eePrekey!.secretName)).toBe(true);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, incoming.prekeyId, () => "ok"),
    ).resolves.toBe("ok");
  });

  it("sweeps a due overlap as part of the startup re-sign, and is idempotent", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    await context.client.rotate(HUB_ORIGIN);
    const outgoingSecretName = (await context.read()).outgoingE2eePrekey!.secretName;

    context.setClock(START + E2EE_PREKEY_ROTATION_OVERLAP + 1);
    await context.client.ensure(HUB_ORIGIN);
    expect((await context.read()).outgoingE2eePrekey).toBeNull();
    expect(context.secrets.values.has(outgoingSecretName)).toBe(false);

    // Repeating either operation changes nothing.
    const before = await context.read();
    await context.client.sweep();
    await context.client.sweep();
    expect(await context.read()).toEqual(before);
  });

  it("keeps one overlap slot, ending an older overlap early rather than losing its key", async () => {
    const context = await harness();
    const first = await context.client.ensure(HUB_ORIGIN);
    const second = await context.client.rotate(HUB_ORIGIN);
    const firstSecretName = (await context.read()).outgoingE2eePrekey!.secretName;

    const third = await context.client.rotate(HUB_ORIGIN);
    const state = await context.read();
    expect(state.e2eePrekey!.prekeyId).toBe(third.prekeyId);
    expect(state.outgoingE2eePrekey!.prekeyId).toBe(second.prekeyId);
    // The displaced key is destroyed rather than orphaned in the credential
    // store, which is the whole reason the slot is bounded at one.
    expect(context.secrets.values.has(firstSecretName)).toBe(false);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, first.prekeyId, () => "ok"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_not_found" });
  });

  it("resolves only the prekey a channel was advertised", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, `epk_${"Z".repeat(22)}`, () => "ok"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_not_found" });
    // Resolution is per (origin, prekey id): the same id offered for another
    // origin is not the prekey this node advertised on that channel.
    const active = (await context.read()).e2eePrekey!.prekeyId;
    await expect(
      context.client.withPrekeySecret("https://other.example", active, () => "ok"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_not_found" });
  });

  it("reports the borrow's own failure unchanged", async () => {
    const context = await harness();
    const certificate = await context.client.ensure(HUB_ORIGIN);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, certificate.prekeyId, () => {
        throw new Error("handshake construction failed");
      }),
    ).rejects.toThrow("handshake construction failed");
  });
});

describe("node E2EE prekey crash points (§6.4)", () => {
  it("stage one — an uncommitted replacement leaves the old certificate whole", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);
    const before = await context.read();

    // A crash between creating the replacement secret and committing the
    // promotion: the new key exists, nothing names it.
    await context.agreementIdentity.generate("e2ee-prekey.orphaned");
    expect(await context.read()).toEqual(before);
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(issued.prekeyId);
    expect((await context.client.ensure(HUB_ORIGIN)).prekeyId).toBe(issued.prekeyId);
    // The orphan is inert: it is not the advertised key and no sweep touches it.
    expect((await context.read()).e2eePrekey!.secretName).not.toBe("e2ee-prekey.orphaned");
  });

  it("stage two — a failed promotion restores custody and keeps the old certificate", async () => {
    const context = await harness();
    const issued = await context.client.ensure(HUB_ORIGIN);
    const before = await context.read();
    const namesBefore = [...context.secrets.values.keys()].toSorted();

    const failing = context.makeClient({
      ...context.prekeyStore,
      update: async () => {
        throw new Error("state write failed");
      },
    });
    await expect(failing.rotate(HUB_ORIGIN)).rejects.toMatchObject({
      code: "e2ee_prekey_state_failed",
    });

    expect(await context.read()).toEqual(before);
    // Compensation ran: no unreferenced replacement survives.
    expect([...context.secrets.values.keys()].toSorted()).toEqual(namesBefore);
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(issued.prekeyId);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, issued.prekeyId, () => "ok"),
    ).resolves.toBe("ok");
  });

  it("stage three — a crash between queueing and destroying is resumable, and loses nothing", async () => {
    const context = await harness();
    const outgoing = await context.client.ensure(HUB_ORIGIN);
    await context.client.rotate(HUB_ORIGIN);
    const retainUntil = (await context.read()).outgoingE2eePrekey!.retainUntil;
    const outgoingSecretName = (await context.read()).outgoingE2eePrekey!.secretName;

    context.setClock(retainUntil + 1);
    // Everything commits; the destroy itself is what fails.
    const brokenCustody = makeNodeE2eePrekeyClient({
      agreementIdentity: {
        ...context.agreementIdentity,
        delete: async () => {
          throw new Error("credential store unavailable");
        },
      },
      signingIdentity: context.signingIdentity,
      keySelector: {
        authenticationKey: async () => ({ keyId: KEY_ID, secretName: "node-key.active" }),
      },
      stateStore: context.stateStore,
      prekeyStore: context.prekeyStore,
      now: () => retainUntil + 1,
    });
    await expect(brokenCustody.sweep()).rejects.toMatchObject({
      code: "e2ee_prekey_custody_failed",
    });

    // The slot no longer claims the key is usable, and the name is still durably
    // recorded, so the destroy is owed and reachable. Neither a usable slot
    // naming a deleted secret nor a deleted-secret name nothing can reach.
    const stalled = await context.read();
    expect(stalled.outgoingE2eePrekey).toBeNull();
    expect(stalled.retiringSecretNames).toEqual([outgoingSecretName]);
    expect(context.secrets.values.has(outgoingSecretName)).toBe(true);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, outgoing.prekeyId, () => "ok"),
    ).rejects.toMatchObject({ code: "e2ee_prekey_not_found" });

    // The next pass finishes the job — §6.4's destroy actually happens.
    await context.client.sweep();
    expect(await context.read()).toMatchObject({
      outgoingE2eePrekey: null,
      retiringSecretNames: [],
    });
    expect(context.secrets.values.has(outgoingSecretName)).toBe(false);
  });

  it("keeps the displaced key until the promotion that stops naming it commits", async () => {
    const context = await harness();
    const first = await context.client.ensure(HUB_ORIGIN);
    await context.client.rotate(HUB_ORIGIN);
    const displaced = (await context.read()).outgoingE2eePrekey!;
    expect(displaced.prekeyId).toBe(first.prekeyId);

    // A second rotation inside the overlap ends the older prekey's overlap
    // early, and its promotion fails.
    const failing = context.makeClient({
      ...context.prekeyStore,
      update: async () => {
        throw new Error("state write failed");
      },
    });
    await expect(failing.rotate(HUB_ORIGIN)).rejects.toMatchObject({
      code: "e2ee_prekey_state_failed",
    });

    // Durable state still names the displaced key and its overlap has not
    // elapsed, so it must still exist: destroying it before the commit would
    // break a handshake the state says must work, and would destroy a live key
    // outright whenever the commit then failed.
    expect(context.secrets.values.has(displaced.secretName)).toBe(true);
    expect((await context.read()).outgoingE2eePrekey?.secretName).toBe(displaced.secretName);
    await expect(
      context.client.withPrekeySecret(HUB_ORIGIN, first.prekeyId, () => "ok"),
    ).resolves.toBe("ok");

    // And a rotation that does commit collects it.
    await context.client.rotate(HUB_ORIGIN);
    expect(context.secrets.values.has(displaced.secretName)).toBe(false);
  });

  it("destroys a retired key on the advertisement path, not only at startup", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    const active = await context.client.rotate(HUB_ORIGIN);
    const outgoing = (await context.read()).outgoingE2eePrekey!;

    // §6.4 destroys the outgoing key once its overlap ends. On a node that runs
    // for months the startup pass never runs again, so the path every new
    // channel takes has to be the one that collects it.
    context.setClock(outgoing.retainUntil + 1);
    expect((await context.client.advertised(HUB_ORIGIN)).prekeyId).toBe(active.prekeyId);
    expect((await context.read()).outgoingE2eePrekey).toBeNull();
    expect(context.secrets.values.has(outgoing.secretName)).toBe(false);
    // Only the retired key. The prekey in service is untouched and still usable.
    const remaining = (await context.read()).e2eePrekey!;
    expect(remaining.prekeyId).toBe(active.prekeyId);
    expect(context.secrets.values.has(remaining.secretName)).toBe(true);
  });

  it("issues one replacement for concurrent advertisements, not one each", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    // The binding changes under them: every waiting channel wants the same
    // single new certificate, and two racing issues would leave the loser's
    // compare-and-update failing after it had already generated a key.
    context.setAuthenticationKey({
      keyId: `nkey_${"R".repeat(22)}`,
      secretName: "node-key.active",
    });

    const advertised = await Promise.all([
      context.client.advertised(HUB_ORIGIN),
      context.client.advertised(HUB_ORIGIN),
      context.client.advertised(HUB_ORIGIN),
    ]);
    const ids = new Set(advertised.map((certificate) => certificate.prekeyId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe((await context.read()).e2eePrekey!.prekeyId);
    expect(
      [...context.secrets.values.keys()].filter((name) => name.startsWith("e2ee-prekey.")),
    ).toHaveLength(2);
  });

  it("keeps advertising when the credential store will not complete a destroy", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    const active = await context.client.rotate(HUB_ORIGIN);
    const outgoing = (await context.read()).outgoingE2eePrekey!;
    context.setClock(outgoing.retainUntil + 1);

    const brokenCustody = makeNodeE2eePrekeyClient({
      agreementIdentity: {
        ...context.agreementIdentity,
        delete: async () => {
          throw new Error("credential store unavailable");
        },
      },
      signingIdentity: context.signingIdentity,
      keySelector: {
        authenticationKey: async () => ({ keyId: KEY_ID, secretName: "node-key.active" }),
      },
      stateStore: context.stateStore,
      prekeyStore: context.prekeyStore,
      now: () => outgoing.retainUntil + 1,
    });

    // Housekeeping must not decide whether this node can advertise. Under
    // effective `requireE2EE` a failed advertisement is a fatal channel
    // disposition (§11.2), and an undestroyed key is a retry, not that.
    expect((await brokenCustody.advertised(HUB_ORIGIN)).prekeyId).toBe(active.prekeyId);
    // The work is still owed and still reachable.
    expect((await context.read()).retiringSecretNames).toEqual([outgoing.secretName]);
    // And the operator command that asks for it directly still reports why.
    await expect(brokenCustody.sweep()).rejects.toMatchObject({
      code: "e2ee_prekey_custody_failed",
    });
    await context.client.sweep();
    expect((await context.read()).retiringSecretNames).toEqual([]);
  });

  it("survives a restart at every stage by re-reading only what was committed", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    const rotated = await context.client.rotate(HUB_ORIGIN);

    const reopened = await makeNodeE2eePrekeyStore({ path: context.prekeyPath });
    const restarted = context.makeClient(reopened);
    expect((await restarted.advertised(HUB_ORIGIN)).prekeyId).toBe(rotated.prekeyId);
    expect((await restarted.ensure(HUB_ORIGIN)).prekeyId).toBe(rotated.prekeyId);
    const derived = await restarted.withPrekeySecret(HUB_ORIGIN, rotated.prekeyId, (secretKey) =>
      hex(deriveE2eeAgreementPublicKey(secretKey)),
    );
    expect(derived).toBe(hex(rotated.agreementPublicKey));
  });

  it("stage three — a sweep that loses the race reports success, not a failure", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    await context.client.rotate(HUB_ORIGIN);
    context.setClock(START + E2EE_PREKEY_ROTATION_OVERLAP + 1);

    // Another pass finishes the sweep between this one's read and its commit.
    const racing = context.makeClient({
      ...context.prekeyStore,
      update: async (change) => {
        await context.prekeyStore.update((current) => ({
          ...current,
          revision: current.revision + 1,
          outgoingE2eePrekey: null,
        }));
        return context.prekeyStore.update(change);
      },
    });
    await racing.sweep();
    expect((await context.read()).outgoingE2eePrekey).toBeNull();
    expect((await context.read()).e2eePrekey).not.toBeNull();
  });

  it("rejects a state file that points both prekey slots at one key", async () => {
    const context = await harness();
    await context.client.ensure(HUB_ORIGIN);
    await context.client.rotate(HUB_ORIGIN);

    // The sweep destroys the secret the outgoing slot names. A file that aimed
    // both slots at the same name would make the sweep destroy the key in
    // service, so it must not parse at all.
    await expect(
      context.prekeyStore.update((current) => ({
        ...current,
        revision: current.revision + 1,
        outgoingE2eePrekey: {
          ...current.outgoingE2eePrekey!,
          secretName: current.e2eePrekey!.secretName,
        },
      })),
    ).rejects.toMatchObject({ code: "prekey_state_corrupt" });
  });
});

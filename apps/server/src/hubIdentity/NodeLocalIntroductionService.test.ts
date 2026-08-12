import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign as signBytes, type KeyObject } from "node:crypto";

import {
  encodeLocalIntroductionRequestTbs,
  verifyLocalIntroductionApproval,
  type LocalIntroductionRequestInput,
} from "@ryco/shared/relayE2eeLocalIntroduction";
import { e2eeKeyFingerprint, generateE2eeAgreementKeyPair } from "@ryco/shared/relayE2eeKeys";
import { describe, expect, it } from "vite-plus/test";

import { makeNodeClientAuthorizationClient } from "./NodeClientAuthorizationClient.ts";
import { makeNodeClientAuthorizationStore } from "./NodeClientAuthorizationStore.ts";
import {
  makeNodeLocalIntroductionLedger,
  type NodeLocalIntroductionLedger,
  NodeLocalIntroductionLedgerError,
} from "./NodeLocalIntroductionLedger.ts";
import {
  makeNodeLocalIntroductionService,
  NodeLocalIntroductionError,
  type NodeLocalIntroductionService,
} from "./NodeLocalIntroductionService.ts";

const NOW = 1_800_000_000_000;
const ED25519_SPKI_PREFIX_BYTES = 12;
const rawEd25519Public = (key: KeyObject): Uint8Array =>
  Uint8Array.from(
    (key.export({ format: "der", type: "spki" }) as Buffer).subarray(ED25519_SPKI_PREFIX_BYTES),
  );
const rawP256Public = (key: KeyObject): Uint8Array => {
  const jwk = key.export({ format: "jwk" });
  return Uint8Array.from([
    0x04,
    ...Buffer.from(jwk.x!, "base64url"),
    ...Buffer.from(jwk.y!, "base64url"),
  ]);
};
const NODE_KEYS = generateKeyPairSync("ed25519");
const OTHER_NODE_KEYS = generateKeyPairSync("ed25519");
const CLIENT_KEYS = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const OTHER_CLIENT_KEYS = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const NODE_PUBLIC = rawEd25519Public(NODE_KEYS.publicKey);
const OTHER_NODE_PUBLIC = rawEd25519Public(OTHER_NODE_KEYS.publicKey);
const CLIENT_PUBLIC = rawP256Public(CLIENT_KEYS.publicKey);
const OTHER_CLIENT_PUBLIC = rawP256Public(OTHER_CLIENT_KEYS.publicKey);
const agreementKeys = generateE2eeAgreementKeyPair();
const AGREEMENT_PUBLIC = agreementKeys.publicKey;
agreementKeys.secretKey.fill(0);

const BASE_REQUEST: LocalIntroductionRequestInput = {
  hubOrigin: "https://hub.example.test",
  accountId: `acct_${"A".repeat(22)}`,
  claimId: `nclaim_${"B".repeat(22)}`,
  installationId: `install_${"C".repeat(22)}`,
  environmentId: `env_${"D".repeat(22)}`,
  nodeId: `node_${"E".repeat(22)}`,
  nodeIdentityPublicKey: NODE_PUBLIC,
  clientIdentityPublicKey: CLIENT_PUBLIC,
  clientAgreementPublicKey: AGREEMENT_PUBLIC,
  introductionId: Uint8Array.from({ length: 32 }, (_, index) => index),
  nonce: Uint8Array.from({ length: 32 }, (_, index) => 0xff - index),
  maxRole: "owner",
  capabilitySet: ["ryco.rpc"],
  displayLabel: "Desktop",
  nodeContinuityId: `nct_${"F".repeat(22)}`,
  nodePolicyGeneration: 7,
  claimDisposition: "created",
  issuedAt: NOW - 1_000,
  expiresAt: NOW + 299_000,
};

function signedRequest(
  overrides: Partial<LocalIntroductionRequestInput> = {},
  privateKey: KeyObject = CLIENT_KEYS.privateKey,
) {
  const requestTbs = encodeLocalIntroductionRequestTbs({ ...BASE_REQUEST, ...overrides });
  const requestSignature = Uint8Array.from(
    signBytes("sha256", requestTbs, { key: privateKey, dsaEncoding: "ieee-p1363" }),
  );
  return { requestTbs, requestSignature };
}

interface Harness {
  readonly service: NodeLocalIntroductionService;
  readonly authorization: Awaited<ReturnType<typeof makeNodeClientAuthorizationClient>>;
  readonly ledger: NodeLocalIntroductionLedger;
  readonly authorizationPath: string;
  readonly ledgerPath: string;
  readonly at: (value: number) => void;
  readonly setActive: (change: Partial<LocalIntroductionRequestInput>) => void;
}

async function harness(options: { ledger?: NodeLocalIntroductionLedger } = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "ryco-lti-service-"));
  const authorizationPath = join(root, "clients.json");
  const ledgerPath = join(root, "introductions.json");
  let clock = NOW;
  let active = { ...BASE_REQUEST };
  const authorization = await makeNodeClientAuthorizationClient({
    store: await makeNodeClientAuthorizationStore({ path: authorizationPath }),
    now: () => clock,
  });
  const ledger = options.ledger ?? (await makeNodeLocalIntroductionLedger({ path: ledgerPath }));
  const service = makeNodeLocalIntroductionService({
    active: async () => ({
      hubOrigin: active.hubOrigin,
      environmentId: active.environmentId,
      nodeId: active.nodeId,
      nodeIdentityPublicKey: active.nodeIdentityPublicKey,
      nodeContinuityId: active.nodeContinuityId,
      nodePolicyGeneration: active.nodePolicyGeneration,
      signApproval: async (approvalTbs) =>
        Uint8Array.from(signBytes(null, approvalTbs, NODE_KEYS.privateKey)),
    }),
    authorization,
    ledger,
    now: () => clock,
  });
  return {
    service,
    authorization,
    ledger,
    authorizationPath,
    ledgerPath,
    at: (value) => {
      clock = value;
    },
    setActive: (change) => {
      active = { ...active, ...change };
    },
  };
}

describe("node Local Trusted Introduction service", () => {
  it("publishes the active descriptor and completes mutual signed approval", async () => {
    const test = await harness();
    await expect(test.service.descriptor()).resolves.toMatchObject({
      hubOrigin: BASE_REQUEST.hubOrigin,
      environmentId: BASE_REQUEST.environmentId,
      nodeId: BASE_REQUEST.nodeId,
      nodeIdentityPublicKey: NODE_PUBLIC,
      nodeIdentityFingerprint: e2eeKeyFingerprint("node-identity", NODE_PUBLIC),
      nodeContinuityId: BASE_REQUEST.nodeContinuityId,
      nodePolicyGeneration: 7,
    });

    const request = signedRequest();
    const result = await test.service.complete(request);
    expect(result.disposition).toBe("created");
    expect(
      verifyLocalIntroductionApproval({
        requestTbs: request.requestTbs,
        approvalTbs: result.approvalTbs,
        signature: result.approvalSignature,
      }),
    ).toBeDefined();
    const key = {
      hubOrigin: BASE_REQUEST.hubOrigin,
      accountId: BASE_REQUEST.accountId,
      clientIdentityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_PUBLIC),
    };
    expect(await test.authorization.get(key)).toMatchObject({
      status: "approved",
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
      displayLabel: "Desktop",
    });
  });

  it("returns the exact stored result after expiry and after active-key state changes", async () => {
    const test = await harness();
    const request = signedRequest();
    const first = await test.service.complete(request);
    test.at(BASE_REQUEST.expiresAt + 1_000_000);
    test.setActive({
      nodeIdentityPublicKey: OTHER_NODE_PUBLIC,
      nodePolicyGeneration: 99,
    });
    const replay = await test.service.complete(request);
    expect(replay).toEqual({ ...first, disposition: "reconciled" });
  });

  it("rejects bad signatures, expiry, authority widening, and every active-node mismatch", async () => {
    const badSignature = await harness();
    const invalid = signedRequest();
    invalid.requestSignature[0] = invalid.requestSignature[0]! ^ 0x80;
    await expect(badSignature.service.complete(invalid)).rejects.toMatchObject({
      code: "local_introduction_rejected",
    });

    const expired = await harness();
    expired.at(BASE_REQUEST.expiresAt + 30_000);
    await expect(expired.service.complete(signedRequest())).rejects.toMatchObject({
      code: "local_introduction_expired",
    });

    const authority = await harness();
    await expect(
      authority.service.complete(signedRequest({ maxRole: "operator" })),
    ).rejects.toMatchObject({ code: "local_introduction_rejected" });

    const mismatches: readonly Partial<LocalIntroductionRequestInput>[] = [
      { hubOrigin: "https://other.example.test" },
      { environmentId: `env_${"Z".repeat(22)}` },
      { nodeId: `node_${"Z".repeat(22)}` },
      {
        nodeIdentityPublicKey: OTHER_NODE_PUBLIC,
      },
      { nodeContinuityId: `nct_${"Z".repeat(22)}` },
      { nodePolicyGeneration: 8 },
    ];
    for (const mismatch of mismatches) {
      const test = await harness();
      test.setActive(mismatch);
      await expect(test.service.complete(signedRequest())).rejects.toMatchObject({
        code: "local_introduction_conflict",
      });
    }
  });

  it("serializes conflicting reuse so only one client can be approved", async () => {
    const test = await harness();
    const first = signedRequest();
    const second = signedRequest(
      {
        clientIdentityPublicKey: OTHER_CLIENT_PUBLIC,
        nonce: Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index),
      },
      OTHER_CLIENT_KEYS.privateKey,
    );
    const results = await Promise.allSettled([
      test.service.complete(first),
      test.service.complete(second),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "local_introduction_conflict" },
    });
    const state = JSON.parse(await readFile(test.authorizationPath, "utf8")) as {
      readonly approved: readonly unknown[];
    };
    expect(state.approved).toHaveLength(1);
  });

  it("reconciles a crash after authorization but before the ledger commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-lti-failing-ledger-"));
    const real = await makeNodeLocalIntroductionLedger({ path: join(root, "ledger.json") });
    let fail = true;
    const ledger: NodeLocalIntroductionLedger = {
      ...real,
      commit: async (input) => {
        if (fail) {
          fail = false;
          throw new NodeLocalIntroductionLedgerError("local_introduction_ledger_operation_failed");
        }
        return real.commit(input);
      },
    };
    const test = await harness({ ledger });
    const request = signedRequest();
    await expect(test.service.complete(request)).rejects.toMatchObject({
      code: "local_introduction_unavailable",
    });
    expect(
      (JSON.parse(await readFile(test.authorizationPath, "utf8")) as { approved: unknown[] })
        .approved,
    ).toHaveLength(1);
    const retry = await test.service.complete(request);
    expect(retry.disposition).toBe("reconciled");
    expect(
      verifyLocalIntroductionApproval({
        requestTbs: request.requestTbs,
        approvalTbs: retry.approvalTbs,
        signature: retry.approvalSignature,
      }),
    ).toBeDefined();
  });

  it("never re-approves a revoked client through a new introduction id", async () => {
    const test = await harness();
    await test.service.complete(signedRequest());
    const key = {
      hubOrigin: BASE_REQUEST.hubOrigin,
      accountId: BASE_REQUEST.accountId,
      clientIdentityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_PUBLIC),
    };
    await test.authorization.revoke(key);
    await expect(
      test.service.complete(
        signedRequest({
          introductionId: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
          nonce: Uint8Array.from({ length: 32 }, (_, index) => index + 2),
        }),
      ),
    ).rejects.toMatchObject({ code: "local_introduction_conflict" });
    expect(await test.authorization.get(key)).toMatchObject({ status: "revoked" });
  });

  it("collapses ledger corruption to the stable unavailable error", async () => {
    const test = await harness();
    await test.service.complete(signedRequest());
    const stored = JSON.parse(await readFile(test.ledgerPath, "utf8")) as {
      entries: { approvalSignature: string }[];
    };
    stored.entries[0]!.approvalSignature = "invalid";
    await writeFile(test.ledgerPath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
    await expect(test.service.complete(signedRequest())).rejects.toBeInstanceOf(
      NodeLocalIntroductionError,
    );
    await expect(test.service.complete(signedRequest())).rejects.toMatchObject({
      code: "local_introduction_unavailable",
    });
  });
});

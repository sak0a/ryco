import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LTI_CLOCK_SKEW_MS,
  LTI_MAX_LIFETIME_MS,
  decodeLocalIntroductionApprovalTbs,
  decodeLocalIntroductionRequestTbs,
  encodeLocalIntroductionApprovalTbs,
  encodeLocalIntroductionRequestTbs,
  localIntroductionRequestDigest,
  localIntroductionRequestIsCurrent,
  type LocalIntroductionRequestInput,
  verifyLocalIntroductionApproval,
  verifyLocalIntroductionRequestSignature,
} from "./relayE2eeLocalIntroduction.ts";
import { RelayE2eeValidationError } from "./relayE2eeKeys.ts";

const NODE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const CLIENT_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 0xa0 + index);
const AGREEMENT_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);

const NODE_PUBLIC = ed25519.getPublicKey(NODE_SECRET);
const CLIENT_PUBLIC = p256.getPublicKey(CLIENT_SECRET, false);
const AGREEMENT_PUBLIC = x25519.getPublicKey(AGREEMENT_SECRET);

const requestInput = (
  overrides: Partial<LocalIntroductionRequestInput> = {},
): LocalIntroductionRequestInput => ({
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
  displayLabel: "Studio Mac",
  nodeContinuityId: `nct_${"F".repeat(22)}`,
  nodePolicyGeneration: 7,
  claimDisposition: "created",
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_300_000,
  ...overrides,
});

const signRequest = (requestTbs: Uint8Array): Uint8Array =>
  p256.sign(sha256(requestTbs), CLIENT_SECRET, {
    prehash: false,
    lowS: false,
    format: "compact",
  });

const signApproval = (approvalTbs: Uint8Array): Uint8Array =>
  ed25519.sign(approvalTbs, NODE_SECRET);

const fixtureDirectory = new URL("../fixtures/e2ee/local-introduction/v1/", import.meta.url);
const decodeFixtureBytes = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, "base64url"));

describe("relay E2EE Local Trusted Introduction transcripts", () => {
  it("encodes and strictly round-trips the exact request and approval structures", () => {
    const requestTbs = encodeLocalIntroductionRequestTbs(requestInput());
    const request = decodeLocalIntroductionRequestTbs(requestTbs);
    expect(request).toMatchObject({
      hubOrigin: "https://hub.example.test",
      accountId: `acct_${"A".repeat(22)}`,
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
      displayLabel: "Studio Mac",
      nodePolicyGeneration: 7,
      claimDisposition: "created",
    });
    expect(encodeLocalIntroductionRequestTbs(request)).toEqual(requestTbs);

    const approvalTbs = encodeLocalIntroductionApprovalTbs({
      requestTbs,
      approvedAt: request.issuedAt + 1_000,
    });
    const approval = decodeLocalIntroductionApprovalTbs(approvalTbs);
    expect(approval).toMatchObject({
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
      nodeContinuityId: request.nodeContinuityId,
      nodePolicyGeneration: 7,
      approvedAt: request.issuedAt + 1_000,
      requestExpiresAt: request.expiresAt,
    });
    expect(approval.requestDigest).toEqual(localIntroductionRequestDigest(requestTbs));
  });

  it("verifies both signatures and every request-to-approval binding", () => {
    const requestTbs = encodeLocalIntroductionRequestTbs(requestInput());
    const requestSignature = signRequest(requestTbs);
    expect(
      verifyLocalIntroductionRequestSignature({ requestTbs, signature: requestSignature }),
    ).toEqual(decodeLocalIntroductionRequestTbs(requestTbs));

    const approvalTbs = encodeLocalIntroductionApprovalTbs({
      requestTbs,
      approvedAt: requestInput().issuedAt + 1_000,
    });
    const approvalSignature = signApproval(approvalTbs);
    expect(
      verifyLocalIntroductionApproval({ requestTbs, approvalTbs, signature: approvalSignature }),
    ).toEqual(decodeLocalIntroductionApprovalTbs(approvalTbs));

    const wrongRequest = encodeLocalIntroductionRequestTbs(
      requestInput({ accountId: `acct_${"Z".repeat(22)}` }),
    );
    expect(
      verifyLocalIntroductionRequestSignature({
        requestTbs: wrongRequest,
        signature: requestSignature,
      }),
    ).toBeUndefined();
    expect(
      verifyLocalIntroductionApproval({
        requestTbs: wrongRequest,
        approvalTbs,
        signature: approvalSignature,
      }),
    ).toBeUndefined();

    const corruptRequestSignature = Uint8Array.from(requestSignature);
    corruptRequestSignature[0] = corruptRequestSignature[0]! ^ 0x80;
    expect(
      verifyLocalIntroductionRequestSignature({
        requestTbs,
        signature: corruptRequestSignature,
      }),
    ).toBeUndefined();

    const corruptApprovalSignature = Uint8Array.from(approvalSignature);
    corruptApprovalSignature[0] = corruptApprovalSignature[0]! ^ 0x80;
    expect(
      verifyLocalIntroductionApproval({
        requestTbs,
        approvalTbs,
        signature: corruptApprovalSignature,
      }),
    ).toBeUndefined();
  });

  it("pins deterministic canonical bytes and a domain-separated request digest", () => {
    const requestTbs = encodeLocalIntroductionRequestTbs(requestInput());
    const approvalTbs = encodeLocalIntroductionApprovalTbs({
      requestTbs,
      approvedAt: requestInput().issuedAt + 1_000,
    });
    expect(Buffer.from(requestTbs).toString("hex")).toMatch(/^[0-9a-f]+$/);
    expect(Buffer.from(requestTbs).byteLength).toBeLessThan(4_096);
    expect(Buffer.from(approvalTbs).byteLength).toBeLessThan(4_096);
    expect(Buffer.from(localIntroductionRequestDigest(requestTbs)).toString("hex")).toHaveLength(
      64,
    );
    expect(localIntroductionRequestDigest(requestTbs)).not.toEqual(sha256(requestTbs));
  });

  it("matches the checksummed public deterministic vector byte-for-byte", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("manifest.json", fixtureDirectory), "utf8"),
    ) as {
      readonly protocol: string;
      readonly version: number;
      readonly files: readonly {
        readonly name: string;
        readonly sha256: string;
        readonly cases: number;
      }[];
    };
    expect(manifest).toMatchObject({
      protocol: "ryco-e2ee-local-introduction",
      version: 1,
    });
    const entry = manifest.files[0]!;
    const raw = readFileSync(new URL(entry.name, fixtureDirectory));
    expect(createHash("sha256").update(raw).digest("hex")).toBe(entry.sha256);
    expect(entry.cases).toBe(1);
    const vector = JSON.parse(raw.toString("utf8")) as {
      readonly nodePublicKey: string;
      readonly clientPublicKey: string;
      readonly agreementPublicKey: string;
      readonly requestTbs: string;
      readonly requestDigest: string;
      readonly requestSignature: string;
      readonly approvalTbs: string;
      readonly approvalSignature: string;
    };

    const requestTbs = encodeLocalIntroductionRequestTbs(requestInput());
    const approvalTbs = encodeLocalIntroductionApprovalTbs({
      requestTbs,
      approvedAt: requestInput().issuedAt + 1_000,
    });
    expect(decodeFixtureBytes(vector.nodePublicKey)).toEqual(NODE_PUBLIC);
    expect(decodeFixtureBytes(vector.clientPublicKey)).toEqual(CLIENT_PUBLIC);
    expect(decodeFixtureBytes(vector.agreementPublicKey)).toEqual(AGREEMENT_PUBLIC);
    expect(decodeFixtureBytes(vector.requestTbs)).toEqual(requestTbs);
    expect(decodeFixtureBytes(vector.requestDigest)).toEqual(
      localIntroductionRequestDigest(requestTbs),
    );
    expect(decodeFixtureBytes(vector.requestSignature)).toEqual(signRequest(requestTbs));
    expect(decodeFixtureBytes(vector.approvalTbs)).toEqual(approvalTbs);
    expect(decodeFixtureBytes(vector.approvalSignature)).toEqual(signApproval(approvalTbs));
  });

  it("rejects non-canonical authority, identifiers, labels, lifetimes, and framing", () => {
    const invalid: readonly Partial<LocalIntroductionRequestInput>[] = [
      { hubOrigin: "https://hub.example.test/extra" },
      { claimId: "nclaim_short" },
      { installationId: "install_short" },
      { environmentId: "env_short" },
      { nodeId: "node_short" },
      { nodeContinuityId: "nct_short" },
      { maxRole: "administrator" },
      { capabilitySet: ["ryco.rpc", "ryco.rpc"] },
      { capabilitySet: ["not-a-capability"] },
      { displayLabel: " padded" },
      { displayLabel: "" },
      { expiresAt: requestInput().issuedAt },
      { expiresAt: requestInput().issuedAt + LTI_MAX_LIFETIME_MS + 1 },
      { nodePolicyGeneration: -1 },
      { claimDisposition: "updated" as never },
      { introductionId: new Uint8Array(31) },
      { nonce: new Uint8Array(33) },
    ];
    for (const overrides of invalid) {
      expect(() => encodeLocalIntroductionRequestTbs(requestInput(overrides))).toThrow(
        RelayE2eeValidationError,
      );
    }

    const canonical = encodeLocalIntroductionRequestTbs(requestInput());
    const trailing = new Uint8Array(canonical.byteLength + 1);
    trailing.set(canonical);
    expect(() => decodeLocalIntroductionRequestTbs(trailing)).toThrow(RelayE2eeValidationError);
  });

  it("enforces the exact request-receipt clock-skew boundaries", () => {
    const request = decodeLocalIntroductionRequestTbs(
      encodeLocalIntroductionRequestTbs(requestInput()),
    );
    expect(localIntroductionRequestIsCurrent(request, request.issuedAt - LTI_CLOCK_SKEW_MS)).toBe(
      true,
    );
    expect(
      localIntroductionRequestIsCurrent(request, request.issuedAt - LTI_CLOCK_SKEW_MS - 1),
    ).toBe(false);
    expect(
      localIntroductionRequestIsCurrent(request, request.expiresAt + LTI_CLOCK_SKEW_MS - 1),
    ).toBe(true);
    expect(localIntroductionRequestIsCurrent(request, request.expiresAt + LTI_CLOCK_SKEW_MS)).toBe(
      false,
    );
    expect(localIntroductionRequestIsCurrent(request, -1)).toBe(false);
  });

  it("omits the optional display label without changing its position", () => {
    const requestTbs = encodeLocalIntroductionRequestTbs(requestInput({ displayLabel: undefined }));
    const decoded = decodeLocalIntroductionRequestTbs(requestTbs);
    expect(decoded.displayLabel).toBeUndefined();
    expect(encodeLocalIntroductionRequestTbs(decoded)).toEqual(requestTbs);
  });
});

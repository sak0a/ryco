import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { RELAY_MAX_QUEUED_BYTES } from "./relay.ts";
import {
  HubConnectorStatus,
  HubEnrollmentCeremonyDetail,
  HubEnrollmentStartResult,
  HubIdentitySummary,
} from "./hubConnector.ts";

const decode = Schema.decodeUnknownSync(HubConnectorStatus);

const disabled = {
  state: "disabled",
  transitionedAt: "2026-07-16T00:00:00.000Z",
  activeChannels: 0,
  queuedBytes: 0,
} as const;

describe("HubConnectorStatus", () => {
  it("accepts bounded disabled, degraded, and online snapshots", () => {
    expect(decode(disabled)).toEqual(disabled);
    expect(
      decode({
        ...disabled,
        state: "degraded",
        degradedMode: "backing_off",
        failure: "network_unavailable",
        reconnectAttempt: 7,
        nextRetryAt: "2026-07-16T00:01:00.000Z",
      }),
    ).toEqual({
      ...disabled,
      state: "degraded",
      degradedMode: "backing_off",
      failure: "network_unavailable",
      reconnectAttempt: 7,
      nextRetryAt: "2026-07-16T00:01:00.000Z",
    });
    expect(
      decode({
        ...disabled,
        state: "online",
        protocolMajor: 1,
        protocolMinor: 2,
        activeChannels: 8,
        queuedBytes: RELAY_MAX_QUEUED_BYTES,
      }),
    ).toMatchObject({ state: "online", activeChannels: 8 });
  });

  it("rejects inconsistent state-specific fields and unbounded counters", () => {
    expect(() => decode({ ...disabled, state: "degraded" })).toThrow();
    expect(() => decode({ ...disabled, degradedMode: "backing_off" })).toThrow();
    expect(() => decode({ ...disabled, nextRetryAt: disabled.transitionedAt })).toThrow();
    expect(() =>
      decode({ ...disabled, state: "online", protocolMajor: 1, protocolMinor: 1 }),
    ).toThrow();
    expect(() => decode({ ...disabled, activeChannels: 1 })).toThrow();
    expect(() => decode({ ...disabled, queuedBytes: RELAY_MAX_QUEUED_BYTES + 1 })).toThrow();
    expect(() => decode({ ...disabled, reconnectAttempt: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  // Canary. The connector design declares this schema closed, and it carries a
  // cross-field invariant over every legal combination of these fields. A new
  // field arrives with no invariant and quietly weakens that property, so adding
  // one must be a deliberate review event rather than a passing test run.
  // Node-side state that is not connector state belongs in a sibling schema —
  // see HubIdentitySummary.
  it("exposes exactly the closed status field set", () => {
    expect(Object.keys(HubConnectorStatus.fields).toSorted()).toEqual([
      "activeChannels",
      "degradedMode",
      "failure",
      "nextRetryAt",
      "protocolMajor",
      "protocolMinor",
      "queuedBytes",
      "reconnectAttempt",
      "state",
      "transitionedAt",
    ]);
  });

  it("does not admit URLs, identifiers, raw errors, or arbitrary failure text", () => {
    for (const extra of [
      { hubOrigin: "https://sensitive.example" },
      { nodeId: "node_sensitive" },
      { error: "sensitive-error" },
      { payload: "sensitive-payload" },
    ]) {
      const decoded = decode({ ...disabled, ...extra });
      expect(decoded).toEqual(disabled);
      expect(JSON.stringify(decoded)).not.toContain("sensitive");
    }
    expect(() => decode({ ...disabled, failure: "sensitive-failure" })).toThrow();
  });
});

describe("HubIdentitySummary", () => {
  const decodeSummary = Schema.decodeUnknownSync(HubIdentitySummary);

  it("reports only whether an identity exists", () => {
    for (const enrolled of ["none", "pending", "active", "unknown"] as const) {
      expect(decodeSummary({ enrolled })).toEqual({ enrolled });
    }
  });

  it("admits no origin, identifier, or fingerprint", () => {
    const decoded = decodeSummary({
      enrolled: "active",
      hubOrigin: "https://sensitive.example",
      nodeId: "node_sensitive",
      fingerprint: `SHA256:${"A".repeat(43)}`,
    });
    expect(decoded).toEqual({ enrolled: "active" });
    expect(JSON.stringify(decoded)).not.toContain("sensitive");
    expect(JSON.stringify(decoded)).not.toContain("SHA256");
  });

  it("rejects an unknown enrollment phase", () => {
    expect(() => decodeSummary({ enrolled: "revoked" })).toThrow();
    expect(() => decodeSummary({})).toThrow();
  });
});

describe("HubEnrollmentStartResult", () => {
  const decodeEnrollment = Schema.decodeUnknownSync(HubEnrollmentStartResult);
  const fingerprint = `SHA256:${"A".repeat(43)}`;
  const enrollment = {
    status: { ...disabled, state: "awaiting_approval" },
    deviceCode: "ABCD-EFGH",
    fingerprint,
    label: "Ryco node",
    platformOs: "darwin",
    platformArch: "arm64",
    clientVersion: "0.1.8",
    algorithm: "ed25519",
    expiresAt: "2026-07-16T00:05:00.000Z",
    pollIntervalMs: 1_000,
  } as const;

  it("accepts the canonical SHA-256 public-key fingerprint", () => {
    expect(decodeEnrollment(enrollment)).toEqual(enrollment);
  });

  it("carries every field the approval screen asks a reviewer to compare", () => {
    // The node and the Hub are held side by side. A field on one and not the
    // other silently narrows the comparison, so this set is deliberate.
    expect(Object.keys(HubEnrollmentCeremonyDetail.fields).toSorted()).toEqual([
      "algorithm",
      "clientVersion",
      "deviceCode",
      "expiresAt",
      "fingerprint",
      "label",
      "platformArch",
      "platformOs",
      "pollIntervalMs",
    ]);
  });

  it("rejects an unbounded label or client version", () => {
    expect(() => decodeEnrollment({ ...enrollment, label: "" })).toThrow();
    expect(() => decodeEnrollment({ ...enrollment, label: "x".repeat(129) })).toThrow();
    expect(() => decodeEnrollment({ ...enrollment, clientVersion: "" })).toThrow();
    expect(() => decodeEnrollment({ ...enrollment, clientVersion: "x".repeat(65) })).toThrow();
  });

  it("rejects an unknown platform or signing algorithm", () => {
    expect(() => decodeEnrollment({ ...enrollment, platformOs: "solaris" })).toThrow();
    expect(() => decodeEnrollment({ ...enrollment, platformArch: "riscv" })).toThrow();
    expect(() => decodeEnrollment({ ...enrollment, algorithm: "rsa" })).toThrow();
  });

  it("rejects non-canonical fingerprint prefixes, alphabets, padding, and lengths", () => {
    for (const invalid of [
      `sha256:${"A".repeat(43)}`,
      `SHA256:${"+".repeat(43)}`,
      `SHA256:${"A".repeat(42)}=`,
      `SHA256:${"A".repeat(42)}B`,
      `SHA256:${"A".repeat(42)}`,
      `SHA256:${"A".repeat(44)}`,
    ]) {
      expect(() => decodeEnrollment({ ...enrollment, fingerprint: invalid })).toThrow();
    }
  });
});

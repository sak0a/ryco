import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { RELAY_MAX_QUEUED_BYTES } from "./relay.ts";
import { HubConnectorStatus, HubEnrollmentStartResult } from "./hubConnector.ts";

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

describe("HubEnrollmentStartResult", () => {
  const decodeEnrollment = Schema.decodeUnknownSync(HubEnrollmentStartResult);
  const fingerprint = `SHA256:${"A".repeat(43)}`;
  const enrollment = {
    status: { ...disabled, state: "awaiting_approval" },
    deviceCode: "ABCD-EFGH",
    fingerprint,
    expiresAt: "2026-07-16T00:05:00.000Z",
    pollIntervalMs: 1_000,
  } as const;

  it("accepts the canonical SHA-256 public-key fingerprint", () => {
    expect(decodeEnrollment(enrollment)).toEqual(enrollment);
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

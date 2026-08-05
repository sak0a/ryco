import {
  deriveE2eeServerConfirmationKey,
  E2eeRecordSession,
  type E2eeProtectResult,
  type E2eeRecordAeadFactory,
} from "@ryco/shared/relayE2eeSession";
import { e2eeChannelSizeBudget } from "@ryco/shared/relayE2eeConstants";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "@ryco/shared/relayE2eeWire";

import f01Raw from "../../../packages/shared/fixtures/e2ee/v1/f01-payload-discrimination.json?raw";
import f02Raw from "../../../packages/shared/fixtures/e2ee/v1/f02-carrier-compatibility.json?raw";
import f03Raw from "../../../packages/shared/fixtures/e2ee/v1/f03-capability-statement.json?raw";
import f04Raw from "../../../packages/shared/fixtures/e2ee/v1/f04-prekey-certificates.json?raw";
import f06Raw from "../../../packages/shared/fixtures/e2ee/v1/f06-ik-handshake.json?raw";
import f07Raw from "../../../packages/shared/fixtures/e2ee/v1/f07-nx-handshake.json?raw";
import f08Raw from "../../../packages/shared/fixtures/e2ee/v1/f08-record-protection.json?raw";
import f14Raw from "../../../packages/shared/fixtures/e2ee/v1/f14-verification-display.json?raw";
import f16Raw from "../../../packages/shared/fixtures/e2ee/v1/f16-authorization-context.json?raw";
import f17Raw from "../../../packages/shared/fixtures/e2ee/v1/f17-key-material-validation.json?raw";

// THE §16.3 CORPUS, READ THE SAME WAY IN BOTH RUNTIMES.
//
// docs/relay-e2ee-protocol.md §16.4 requires part of the corpus to run in the
// web browser suite as well as under Node, and calls a vector that produces
// different bytes on any supported runtime a release-blocking defect. That
// comparison is only worth having against the COMMITTED bytes, so every family
// is imported as raw text from `packages/shared/fixtures/e2ee/v1/` — a data
// directory this app reads and never writes. Nothing here regenerates a
// fixture, copies one into `apps/web`, or derives an expectation from anything
// but the case's own inputs.
//
// This module carries the reader and the §9 session harness. It carries no
// assertions: those live in the `*.browser.tsx` files, which is the only place
// `apps/web/vitest.browser.config.ts` looks (`src/components/**/*.browser.tsx`).

export interface E2eeFixtureCase {
  readonly name: string;
  readonly sections: readonly string[];
  readonly note?: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>>;
}

export interface E2eeFixtureFamily {
  readonly family: { readonly number: number; readonly title: string };
  readonly deferred?: readonly string[];
  readonly testKeyMaterial: Readonly<Record<string, unknown>>;
  readonly cases: readonly E2eeFixtureCase[];
}

export const F01: E2eeFixtureFamily = JSON.parse(f01Raw) as E2eeFixtureFamily;
export const F02: E2eeFixtureFamily = JSON.parse(f02Raw) as E2eeFixtureFamily;
export const F03: E2eeFixtureFamily = JSON.parse(f03Raw) as E2eeFixtureFamily;
export const F04: E2eeFixtureFamily = JSON.parse(f04Raw) as E2eeFixtureFamily;
export const F06: E2eeFixtureFamily = JSON.parse(f06Raw) as E2eeFixtureFamily;
export const F07: E2eeFixtureFamily = JSON.parse(f07Raw) as E2eeFixtureFamily;
export const F08: E2eeFixtureFamily = JSON.parse(f08Raw) as E2eeFixtureFamily;
export const F14: E2eeFixtureFamily = JSON.parse(f14Raw) as E2eeFixtureFamily;
export const F16: E2eeFixtureFamily = JSON.parse(f16Raw) as E2eeFixtureFamily;
export const F17: E2eeFixtureFamily = JSON.parse(f17Raw) as E2eeFixtureFamily;

/** §16.2: byte strings are `{"$bytes": "<lowercase hex>"}` and nothing else. */
export function fixtureBytes(value: unknown): Uint8Array {
  const hex = (value as { readonly $bytes?: unknown }).$bytes;
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})*$/.test(hex)) {
    throw new Error("fixture value is not a §16.2 byte string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function hexOf(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fixtureCase(family: E2eeFixtureFamily, name: string): E2eeFixtureCase {
  const found = family.cases.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing §16.3 fixture case ${name}`);
  return found;
}

/**
 * Cases whose name matches a pattern, PINNED TO AN EXACT COUNT.
 *
 * A loop over a filtered set deletes itself the moment the filter stops
 * matching: nothing fails, the body simply never runs, and the file goes on
 * reporting green over a family it no longer reads. The count is the thing that
 * makes both directions fail — a case renamed out of the set, and a case
 * quietly added to it.
 */
export function fixtureCasesMatching(
  family: E2eeFixtureFamily,
  pattern: RegExp,
  count: number,
): readonly E2eeFixtureCase[] {
  const found = family.cases.filter((entry) => pattern.test(entry.name));
  if (found.length !== count) {
    throw new Error(
      `${String(found.length)} cases of F${String(family.family.number)} match ${String(pattern)}, this run requires exactly ${String(count)} — update the number in the same commit as the case`,
    );
  }
  return found;
}

/**
 * The cases carrying `field` under `expected`, pinned the same way and for the
 * same reason: an assertion guarded by `if (entry.expected.x !== undefined)`
 * disappears with the field it reads.
 *
 * Presence is tested with `Object.hasOwn`, which does not READ the value, so a
 * field named here and asserted nowhere stays as inert in the browser run as it
 * is in the Node one.
 */
export function fixtureCasesCarrying(
  cases: readonly E2eeFixtureCase[],
  field: string,
  count: number,
): readonly E2eeFixtureCase[] {
  const found = cases.filter((entry) => Object.hasOwn(entry.expected, field));
  if (found.length !== count) {
    throw new Error(
      `${String(found.length)} of ${String(cases.length)} cases carry expected.${field}, this run requires exactly ${String(count)}`,
    );
  }
  return found;
}

/**
 * §4.5's ceiling for the channel the §16.3 record cases run under.
 *
 * The same two numbers the Node consuming suite uses, re-derived here through
 * the same shared function rather than carried as a literal: a ceiling that
 * differed between the runtimes would move which bodies are refused, and the
 * point of this run is that nothing moves.
 */
export const CORPUS_CHANNEL_PLAINTEXT_CEILING: number = e2eeChannelSizeBudget({
  maxQueuedBytes: 384,
  maxControlFrameBytes: 256,
}).plaintextCeiling;

/** The direction a peer of `direction` sends in (§3.4). */
export function oppositeDirection(direction: E2eeDirection): E2eeDirection {
  return direction === E2EE_DIRECTION_CLIENT_TO_NODE
    ? E2EE_DIRECTION_NODE_TO_CLIENT
    : E2EE_DIRECTION_CLIENT_TO_NODE;
}

/**
 * ONE ESTABLISHED §9 SESSION, from a family's own committed §6.5 outputs.
 *
 * §16.3 F8 is the family that cannot be checked from bytes alone: every case is
 * a record protected or authenticated by a session that already holds epoch
 * secrets, and there is no such session in a browser file until something
 * builds one. This is that something, and F1's two re-protect cases reuse it
 * unchanged — they differ only in which family's secrets they hand over.
 *
 * The secrets are OWNED by the session once passed (§6.5, §9.5), so every call
 * must hand over freshly decoded buffers; `fixtureBytes` allocates, so reading
 * the case again is the whole discipline. `serverConfirmationKey` is derived
 * from the exporter secret when a family does not commit one, which is exactly
 * what §6.5 does with it.
 */
export function corpusRecordSession(input: {
  readonly epochSecretC2N: Uint8Array;
  readonly epochSecretN2C: Uint8Array;
  readonly exporterSecret: Uint8Array;
  readonly serverConfirmationKey?: Uint8Array | undefined;
  readonly sessionBindingHash: Uint8Array;
  readonly sendDirection: E2eeDirection;
  readonly plaintextCeiling?: number | undefined;
  readonly testOnlyAeadFactory?: E2eeRecordAeadFactory | undefined;
}): E2eeRecordSession {
  return new E2eeRecordSession({
    secrets: {
      epochSecretC2N: input.epochSecretC2N,
      epochSecretN2C: input.epochSecretN2C,
      exporterSecret: input.exporterSecret,
      serverConfirmationKey:
        input.serverConfirmationKey ?? deriveE2eeServerConfirmationKey(input.exporterSecret),
    },
    suite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
    sessionBindingHash: input.sessionBindingHash,
    sendDirection: input.sendDirection,
    plaintextCeiling: input.plaintextCeiling ?? CORPUS_CHANNEL_PLAINTEXT_CEILING,
    ...(input.testOnlyAeadFactory === undefined
      ? {}
      : { testOnlyAeadFactory: input.testOnlyAeadFactory }),
  });
}

/**
 * One §9.3 protect, with the envelope the `transmit` callback was handed.
 *
 * `admit` always answers true: §9.3's admission branch is backpressure, which
 * belongs to the send path and not to the record layer these cases pin.
 */
export async function protectOneRecord(
  session: E2eeRecordSession,
  record: { readonly innerType: E2eeInnerRecordType; readonly body: Uint8Array },
): Promise<{ readonly result: E2eeProtectResult; readonly envelope: Uint8Array | undefined }> {
  let envelope: Uint8Array | undefined;
  const result = await session.protect({
    innerType: record.innerType,
    body: record.body,
    admit: () => true,
    transmit: (bytes) => {
      envelope = Uint8Array.from(bytes);
      return { kind: "sent" };
    },
  });
  return { result, envelope };
}

/** One direction's §9.2 state, in the shape the corpus writes it. */
export function directionStateJson(state: {
  readonly epoch: bigint | undefined;
  readonly counter: bigint | undefined;
  readonly epochRecords: number;
  readonly epochBytes: number;
  readonly exhausted: boolean;
}): Readonly<Record<string, unknown>> {
  const value = (sequence: bigint | undefined): number | string | null => {
    if (sequence === undefined) return null;
    const asNumber = Number(sequence);
    return Number.isSafeInteger(asNumber) ? asNumber : sequence.toString(10);
  };
  return {
    epoch: value(state.epoch),
    counter: value(state.counter),
    epochRecords: state.epochRecords,
    epochBytes: state.epochBytes,
    exhausted: state.exhausted,
  };
}

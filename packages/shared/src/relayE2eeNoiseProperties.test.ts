import { x25519 } from "@noble/curves/ed25519.js";
import * as fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_AEAD_NONCE_BYTES,
  E2EE_AGREEMENT_PUBLIC_KEY_BYTES,
  E2EE_SECRET_BYTES,
} from "./relayE2eeConstants.ts";
import {
  E2eeNoiseHandshake,
  E2eeNoiseHandshakeError,
  e2eeNoiseCipherNonce,
  e2eeNoiseExporterSecret,
  type E2eeNoiseHandshakeStatus,
  type E2eeNoiseSessionKeys,
} from "./relayE2eeNoise.ts";
import {
  E2EE_NOISE_PATTERN_IK,
  E2EE_NOISE_PATTERN_NX,
  type E2eeNoisePattern,
} from "./relayE2eeTranscripts.ts";

// THE PROPERTY-BASED STATE-MACHINE SUITE — docs/relay-e2ee-protocol.md §14.1.
//
// §14.1 makes property-based tests over the Noise state machine a normative
// obligation of the owner-accepted deviation, "including message-order,
// truncation, mutation, and nonce-progression properties". This file is that
// obligation; `relayE2eeNoise.test.ts` is the enumerated half and the §16.3 F15
// official vectors are the byte-level half.
//
// WHAT THIS BUYS OVER THE ENUMERATED SUITE. An enumerated case proves the
// machine refuses the ONE sequence somebody thought to write down. These
// properties quantify over sequences instead: every interleaving of
// `writeMessage`/`readMessage`/`split`/`destroy` across a real initiator and a
// real responder, with the bytes between them chosen by an adversary who may
// reflect, corrupt, truncate, or withhold them. The claims are about the state
// machine — §14.1 requires the module to perform no primitive arithmetic of its
// own, and auditing `@noble/*` is explicitly outside the audit scope
// (docs/relay-e2ee-noise-audit-scope.md §4), so nothing here tests a primitive.
//
// SEED POLICY. Every `fc.assert` runs under the fixed `PROPERTY_SEED` below, so
// a failure on CI reproduces byte for byte on a developer machine with no extra
// flags: same seed, same generated inputs, same counterexample. fast-check
// prints the shrunk counterexample together with the `seed`/`path` pair, and
// `path` replays a single case without rerunning the ones before it. A property
// suite whose failures cannot be replayed is a liability, so the seed is a
// literal here and MUST NOT be made time- or environment-dependent. The literal
// is the one the sibling property suites use (`relayE2eeWire.test.ts`,
// `relayCodec.test.ts`) — one seed across the package, so a change to the
// generators is visible as a change everywhere it matters.
//
// RUN COUNTS ARE DELIBERATE, AND SMALL, so they are stated exactly rather than
// rounded: 80 for the handshake properties, each of which drives at least one
// real X25519 exchange and most of which drive four; 400 for the pure
// derivations and encodings, which are cheap; 24 for the two properties that
// build a 64KiB buffer to probe the Noise message bound. Runs alone are not the
// coverage argument — a generator that never reaches the interesting state is
// worthless at any count — so the properties whose conclusion lives on a path
// the generator must FIND count their own executions of it and fail when the
// count is zero. Search for `expect(` after an `fc.assert` call to find them.
//
// COVERAGE GUARDS, and why they are assertions rather than statistics. Four
// properties here can be silently hollowed out by a change to a generator: the
// §8.1 ordering property, whose conclusion needs two ends that both reached
// `split()`; and the prologue, mutation, and truncation properties, each stated
// as a disjunction whose refusal branch is the one that actually runs. Each
// records what it reached and asserts it after `fc.assert` returns, so the next
// generator edit that kills the path fails the suite instead of leaving an
// auditor a property that cannot fail.

const PROPERTY_SEED = 0x5259_434f;

/** Runs for a property that drives at least one complete X25519 handshake. */
const HANDSHAKE_RUNS = 80;
/** Runs for a property over a pure derivation or an encoding. */
const DERIVATION_RUNS = 400;
/** Runs for a property that allocates a message beyond the Noise §3 bound. */
const BOUNDS_RUNS = 24;

const DH_LEN = E2EE_AGREEMENT_PUBLIC_KEY_BYTES;

// ─── generators ──────────────────────────────────────────────────────────────
//
// TEST-ONLY material, generated rather than pinned: the point of this file is
// that no fixed key is load-bearing. None of it may ever reach a real endpoint.
//
// Every secret key here is a `DHLEN`-byte string, which X25519 clamps to a
// multiple of the cofactor in `[2^254, 2^255)`. Public keys are therefore
// always base-point multiples in the prime-order subgroup, so no generated pair
// can produce the all-zero shared secret of §8.1 by accident — that abort has
// its own enumerated cases in `relayE2eeNoise.test.ts`, driven from genuine
// low-order points, and a property that hit it at random would be reporting a
// generator collision rather than a defect.

const secretKeyArb = fc
  .uint8Array({ minLength: DH_LEN, maxLength: DH_LEN })
  .filter((key) => key.some((byte) => byte !== 0));
const prologueArb = fc.uint8Array({ maxLength: 96 });
const payloadArb = fc.uint8Array({ maxLength: 128 });
const patternArb = fc.constantFrom<E2eeNoisePattern>(E2EE_NOISE_PATTERN_IK, E2EE_NOISE_PATTERN_NX);

/** Everything one handshake pair needs, with the two roles' material kept apart. */
interface HandshakeMaterial {
  readonly pattern: E2eeNoisePattern;
  readonly prologue: Uint8Array;
  readonly initiatorStatic: Uint8Array;
  readonly responderStatic: Uint8Array;
  readonly initiatorEphemeral: Uint8Array;
  readonly responderEphemeral: Uint8Array;
  readonly payload1: Uint8Array;
  readonly payload2: Uint8Array;
}

const materialArb: fc.Arbitrary<HandshakeMaterial> = fc.record({
  pattern: patternArb,
  prologue: prologueArb,
  initiatorStatic: secretKeyArb,
  responderStatic: secretKeyArb,
  initiatorEphemeral: secretKeyArb,
  responderEphemeral: secretKeyArb,
  payload1: payloadArb,
  payload2: payloadArb,
});

/**
 * The §8.1 role matrix as a constructor: the IK initiator is the only party
 * holding a remote static, and the NX initiator is the only party holding no
 * static at all. The injected ephemeral is a FRESH copy every time, because the
 * handshake takes ownership of that buffer and zeroes it — a shared one would
 * silently disarm every erasure assertion below.
 */
const initiatorOf = (material: HandshakeMaterial): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: material.pattern,
    role: "initiator",
    prologue: material.prologue,
    ...(material.pattern === E2EE_NOISE_PATTERN_IK
      ? {
          staticSecretKey: material.initiatorStatic,
          remoteStaticPublicKey: x25519.getPublicKey(material.responderStatic),
        }
      : {}),
    testOnlyEphemeralSecretKey: Uint8Array.from(material.initiatorEphemeral),
  });

const responderOf = (material: HandshakeMaterial): E2eeNoiseHandshake =>
  new E2eeNoiseHandshake({
    pattern: material.pattern,
    role: "responder",
    prologue: material.prologue,
    staticSecretKey: material.responderStatic,
    testOnlyEphemeralSecretKey: Uint8Array.from(material.responderEphemeral),
  });

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

const isZeroed = (value: Uint8Array): boolean => value.every((byte) => byte === 0);

const sessionKeysEqual = (left: E2eeNoiseSessionKeys, right: E2eeNoiseSessionKeys): boolean =>
  equalBytes(left.epochSecretC2N, right.epochSecretC2N) &&
  equalBytes(left.epochSecretN2C, right.epochSecretN2C) &&
  equalBytes(left.exporterSecret, right.exporterSecret);

/** One honest run of the pattern, or `undefined` if any step refused the bytes. */
const runPair = (
  material: HandshakeMaterial,
): { readonly initiator: E2eeNoiseSessionKeys; readonly responder: E2eeNoiseSessionKeys } => {
  const initiator = initiatorOf(material);
  const responder = responderOf(material);
  try {
    responder.readMessage(initiator.writeMessage(material.payload1));
    initiator.readMessage(responder.writeMessage(material.payload2));
    return { initiator: initiator.split(), responder: responder.split() };
  } finally {
    initiator.destroy();
    responder.destroy();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// Message ordering, single use, and what a refusal leaves behind (§8.1)
// ═════════════════════════════════════════════════════════════════════════════
//
// Both §3.4 patterns are two messages long, so each party performs EXACTLY one
// write and one read: the initiator writes message 1 and reads message 2, the
// responder reads message 1 and writes message 2, and both then `split()`. That
// is what makes a model feasible — the model below predicts the module's status
// after every operation, and the property drives arbitrary sequences of
// operations (including operations neither party owes, reflections of a party's
// own message, corrupted bytes, and repeated splits) against it.

type PartyName = "initiator" | "responder";

/** Where the attacker sources the bytes it feeds to a `readMessage` call. */
type ReadSource = "peer" | "self" | "empty" | "corrupt";

interface Operation {
  readonly party: PartyName;
  readonly kind: "write" | "read" | "split" | "destroy";
  /** Read only; carried unconditionally so the generator stays one record. */
  readonly source: ReadSource;
}

/**
 * The operation alphabet, with the draw weighted by repetition rather than by
 * a weighted combinator: `destroy` spends a party for the rest of the sequence,
 * so a uniform draw would end both handshakes before anything interesting ran,
 * and `read` is the operation the attacker actually controls the input of.
 */
const operationArb: fc.Arbitrary<Operation> = fc.record({
  party: fc.constantFrom<PartyName>("initiator", "responder"),
  kind: fc.constantFrom<Operation["kind"]>(
    "write",
    "write",
    "read",
    "read",
    "read",
    "split",
    "destroy",
  ),
  source: fc.constantFrom<ReadSource>("peer", "peer", "self", "empty", "corrupt"),
});

/**
 * The six operations the two patterns owe, in the only order that completes
 * them: the initiator writes message 1, the responder reads it and writes
 * message 2, the initiator reads that, and both `split()`.
 */
const HONEST_SCHEDULE: readonly Operation[] = [
  { party: "initiator", kind: "write", source: "peer" },
  { party: "responder", kind: "read", source: "peer" },
  { party: "responder", kind: "write", source: "peer" },
  { party: "initiator", kind: "read", source: "peer" },
  { party: "initiator", kind: "split", source: "peer" },
  { party: "responder", kind: "split", source: "peer" },
];

/**
 * A SCAFFOLDED sequence: the honest schedule above with adversarial operations
 * interleaved into each of its seven gaps.
 *
 * WHY IT IS NOT A FREE DRAW over `operationArb`, which is what this was. The
 * property's conclusion is about two ends that BOTH reached `split()`, and
 * reaching that from an independent draw needs the six operations above to come
 * up in order out of a 2 × 7 × 5 alphabet whose `destroy` spends a party at
 * 1/7 per element. Measured on the shipped seed, a free draw of up to 14
 * operations reached one `split()` 9 times in 2,000 runs and both of them zero
 * times — so the conclusion was never evaluated, at any run count this file
 * could afford. Scaffolding the schedule in makes the legal order the SPINE and
 * the adversary's operations the interference around it, which is the question
 * worth asking anyway: not "can 14 random calls stumble into a handshake" but
 * "can an adversary interleaving arbitrary operations into a legal exchange
 * make it complete into a disagreement". The refusal coverage is unchanged —
 * every interleaved operation is still driven against the model — and the
 * shrinker's floor is now the bare honest schedule, which is a readable
 * counterexample rather than a 14-element soup.
 */
const sequenceArb: fc.Arbitrary<readonly Operation[]> = fc
  .array(fc.array(operationArb, { maxLength: 2 }), {
    minLength: HONEST_SCHEDULE.length + 1,
    maxLength: HONEST_SCHEDULE.length + 1,
  })
  .map((gaps) =>
    gaps.flatMap((gap, index) => {
      const owed = HONEST_SCHEDULE[index];
      return owed === undefined ? gap : [...gap, owed];
    }),
  );

const flipFirstByte = (value: Uint8Array): Uint8Array => {
  const copy = Uint8Array.from(value);
  copy[0] = (copy[0] ?? 0) ^ 0x01;
  return copy;
};

interface PartyModel {
  status: E2eeNoiseHandshakeStatus;
  /** Noise §5.3's `message_index`, advanced by a write OR a read, exactly as the module does. */
  messageIndex: number;
  /** Genuine messages this party produced, in pattern order. */
  readonly produced: Uint8Array[];
  keys: E2eeNoiseSessionKeys | undefined;
}

/** The status the module reaches after a message is written or read (Noise §5.3). */
const advanced = (state: PartyModel): E2eeNoiseHandshakeStatus => {
  state.messageIndex += 1;
  if (state.messageIndex >= 2) return "awaiting_split";
  return state.status === "awaiting_write" ? "awaiting_read" : "awaiting_write";
};

describe("property: §8.1 message ordering is total", () => {
  it("never reaches split() except through the pattern's exact legal order", () => {
    // Counted, not assumed: the conclusion at the bottom of the property is
    // about two ends that BOTH split, and a generator that stops producing
    // those turns this property into a refusal-only test without failing.
    let bothEndsSplit = 0;
    fc.assert(
      fc.property(materialArb, sequenceArb, (material, sequence) => {
        const handshakes: Record<PartyName, E2eeNoiseHandshake> = {
          initiator: initiatorOf(material),
          responder: responderOf(material),
        };
        const model: Record<PartyName, PartyModel> = {
          initiator: { status: "awaiting_write", messageIndex: 0, produced: [], keys: undefined },
          responder: { status: "awaiting_read", messageIndex: 0, produced: [], keys: undefined },
        };
        // The NX responder's message 1 is `e` followed by a CLEARTEXT payload
        // (§8.5, §8.10: no keys exist yet), so it reads any buffer of at least
        // `DHLEN` bytes — including one the attacker wrote. That is conforming
        // Noise, and the divergence it causes is what kills the initiator's
        // read of message 2 rather than the responder's read of message 1.
        let responderConsumedAuthentic = false;

        const peerOf = (party: PartyName): PartyName =>
          party === "initiator" ? "responder" : "initiator";

        for (const operation of sequence) {
          const party = operation.party;
          const handshake = handshakes[party];
          const state = model[party];
          const spent = state.status === "complete" || state.status === "destroyed";

          if (operation.kind === "destroy") {
            handshake.destroy();
            if (!spent) state.status = "destroyed";
            expect(handshake.status).toBe(state.status);
            continue;
          }

          if (operation.kind === "split") {
            if (spent) {
              expect(() => handshake.split()).toThrow(E2eeNoiseHandshakeError);
              expect(handshake.status).toBe(state.status);
              continue;
            }
            if (state.status !== "awaiting_split") {
              // A PRECONDITION refusal: it touches no state, so the handshake
              // is still usable afterwards and the loop keeps driving it.
              expect(() => handshake.split()).toThrow(E2eeNoiseHandshakeError);
              expect(handshake.status).toBe(state.status);
              continue;
            }
            state.keys = handshake.split();
            state.status = "complete";
            expect(handshake.status).toBe("complete");
            continue;
          }

          if (operation.kind === "write") {
            if (spent || state.status !== "awaiting_write") {
              expect(() => handshake.writeMessage(new Uint8Array(0))).toThrow(
                E2eeNoiseHandshakeError,
              );
              expect(handshake.status).toBe(state.status);
              continue;
            }
            const payload = state.messageIndex === 0 ? material.payload1 : material.payload2;
            const message = handshake.writeMessage(payload);
            state.produced.push(message);
            state.status = advanced(state);
            expect(handshake.status).toBe(state.status);
            continue;
          }

          // A read. The attacker chooses the bytes; the model chooses what the
          // module owes for them.
          const peerMessages = model[peerOf(party)].produced;
          const genuine = peerMessages[peerMessages.length - 1];
          const own = state.produced[state.produced.length - 1];
          const bytes =
            operation.source === "peer"
              ? genuine
              : operation.source === "self"
                ? own
                : operation.source === "empty"
                  ? new Uint8Array(0)
                  : genuine === undefined
                    ? undefined
                    : flipFirstByte(genuine);
          // The source held nothing to feed; the attacker has no operation here.
          if (bytes === undefined) continue;

          if (spent || state.status !== "awaiting_read") {
            expect(() => handshake.readMessage(bytes)).toThrow(E2eeNoiseHandshakeError);
            expect(handshake.status).toBe(state.status);
            continue;
          }

          const authenticBytes = genuine !== undefined && equalBytes(bytes, genuine);
          const readerIsResponder = party === "responder";
          // The responder's read is message 1 and the initiator's is message 2.
          // Message 2 is AEAD-protected under a chain that includes every byte
          // of message 1, so it authenticates only if the responder consumed
          // the genuine message 1 — the property that makes a mutated or
          // reflected message 1 fatal one message LATER rather than never.
          const cleartextRead =
            readerIsResponder &&
            material.pattern === E2EE_NOISE_PATTERN_NX &&
            bytes.byteLength >= DH_LEN;
          const succeeds = readerIsResponder
            ? authenticBytes || cleartextRead
            : authenticBytes && responderConsumedAuthentic;

          if (!succeeds) {
            // A PROCESSING failure. It may be this module's guard or the
            // primitive's own AEAD refusal (§14.3 keeps the latter unchanged),
            // so the assertion is on the disposition rather than on the class.
            expect(() => handshake.readMessage(bytes)).toThrow();
            expect(handshake.status).toBe("destroyed");
            state.status = "destroyed";
            continue;
          }

          handshake.readMessage(bytes);
          if (readerIsResponder) responderConsumedAuthentic = authenticBytes;
          // The responder reads message 1 and still owes message 2; the
          // initiator reads message 2 and owes nothing but `split()`.
          state.status = advanced(state);
          expect(handshake.status).toBe(state.status);
        }

        // THE PROPERTY. Two ends that both produced session keys ran the exact
        // legal order over authentic bytes, so their keys agree — there is no
        // generated sequence that splits a handshake into a disagreeing one.
        const initiatorKeys = model.initiator.keys;
        const responderKeys = model.responder.keys;
        if (initiatorKeys !== undefined && responderKeys !== undefined) {
          bothEndsSplit += 1;
          expect(sessionKeysEqual(initiatorKeys, responderKeys)).toBe(true);
        }
        return true;
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
    // THE COVERAGE GUARD, and the reason `sequenceArb` scaffolds. Without this
    // the property above degrades silently: every assertion inside it is about
    // an operation being REFUSED, so a generator that never completes a
    // handshake leaves it green while the agreement conclusion — the half that
    // catches a `split()` deriving disagreeing keys, or a responder swapping its
    // two `Split()` outputs — never runs at all.
    expect(bothEndsSplit).toBeGreaterThan(0);
  });

  it("leaves a live handshake usable after any number of precondition refusals", () => {
    // §8.1's two failure classes, as a property: an operation a party does not
    // owe is refused WITHOUT touching state, so a handshake buried in refusals
    // still completes and still agrees with its peer. The defect this catches
    // is the tempting one — moving `#requireTurn` inside the abort scope of
    // `writeMessage`/`readMessage`, which would let an attacker kill a session
    // by sending nothing at all, just by prompting an out-of-turn call.
    fc.assert(
      fc.property(
        materialArb,
        fc.array(fc.constantFrom<"write" | "read" | "split">("write", "read", "split"), {
          maxLength: 8,
        }),
        (material, refusals) => {
          const initiator = initiatorOf(material);
          const responder = responderOf(material);
          try {
            // Every one of these is an operation the RESPONDER does not owe
            // before it has read message 1.
            for (const refusal of refusals) {
              const attempt =
                refusal === "write"
                  ? () => responder.writeMessage(new Uint8Array(0))
                  : refusal === "split"
                    ? () => responder.split()
                    : () => initiator.readMessage(new Uint8Array(DH_LEN));
              expect(attempt).toThrow(E2eeNoiseHandshakeError);
            }
            expect(responder.status).toBe("awaiting_read");
            expect(initiator.status).toBe("awaiting_write");

            responder.readMessage(initiator.writeMessage(material.payload1));
            initiator.readMessage(responder.writeMessage(material.payload2));
            return sessionKeysEqual(initiator.split(), responder.split());
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("refuses every operation once a handshake is spent, whatever spent it", () => {
    // Single use (§8.1: one handshake attempt per channel), quantified over the
    // three ways a handshake ends — `split()`, `destroy()`, and a processing
    // failure — and over the operation attempted afterwards.
    fc.assert(
      fc.property(
        materialArb,
        fc.constantFrom<"split" | "destroy" | "failure">("split", "destroy", "failure"),
        fc.constantFrom<"write" | "read" | "split" | "destroy">(
          "write",
          "read",
          "split",
          "destroy",
        ),
        (material, ending, attempted) => {
          const initiator = initiatorOf(material);
          const responder = responderOf(material);
          try {
            const message1 = initiator.writeMessage(material.payload1);
            if (ending === "failure") {
              // The responder is fed a corrupted message 1. For IK that is an
              // AEAD refusal; for NX the payload is cleartext, so the failure
              // is forced by feeding a message shorter than `e`.
              const corrupted =
                material.pattern === E2EE_NOISE_PATTERN_IK
                  ? flipFirstByte(message1)
                  : message1.subarray(0, DH_LEN - 1);
              expect(() => responder.readMessage(corrupted)).toThrow();
              expect(responder.status).toBe("destroyed");
            } else {
              responder.readMessage(message1);
              initiator.readMessage(responder.writeMessage(material.payload2));
              if (ending === "split") {
                responder.split();
                expect(responder.status).toBe("complete");
              } else {
                responder.destroy();
                expect(responder.status).toBe("destroyed");
              }
            }
            const spentStatus = responder.status;

            if (attempted === "destroy") {
              // Idempotent, and the only operation that does not throw.
              responder.destroy();
              return responder.status === spentStatus;
            }
            const attempt =
              attempted === "write"
                ? () => responder.writeMessage(new Uint8Array(0))
                : attempted === "read"
                  ? () => responder.readMessage(new Uint8Array(DH_LEN))
                  : () => responder.split();
            let reason: string | undefined;
            try {
              attempt();
            } catch (error) {
              expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
              reason = (error as E2eeNoiseHandshakeError).reason;
            }
            return reason === "handshake_consumed" && responder.status === spentStatus;
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Erasure is unconditional (§6.5, §9.5)
// ═════════════════════════════════════════════════════════════════════════════
//
// WHAT IS WITNESSED ON A BUFFER HERE, AND WHAT IS NOT — stated because §6.5
// names five things ("ephemeral private keys, chaining key, handshake hash,
// cipher states" plus the static copy §9.5 adds) and only two of them are
// observable from outside the module at all.
//
//   - The EPHEMERAL private key is observable: the test-only injected buffer is
//     the one piece of private key material the module adopts from a caller, so
//     the caller keeps a handle on the exact bytes the module must zero. Three
//     properties below watch it — over every prefix, over a fatal read taken
//     before it was generated, and over a fatal read taken with it live in
//     `#e.secretKey`.
//   - The HANDSHAKE HASH is observable through `testOnlyHandshakeHash`, which
//     reports `undefined` by reading `h` and finding it all-zero rather than by
//     consulting `#status` — so the `toBeUndefined()` below fails if the
//     symmetric-state erasure inside `splitAndExport()` is removed.
//   - The CHAINING KEY, the handshake cipher key, and the module's defensive
//     copy of the static agreement secret are unobservable by construction:
//     nothing returns them and no later operation reads them back. Two things
//     stand in for a direct assertion, and neither is one. `NoiseSymmetricState
//     .erase()` zeroes `ck` and `h` in a single `eraseBytes` call and then
//     erases the cipher state, and `#eraseSecrets` zeroes the ephemeral, the
//     static copy, and the pending slot in a single call — so every unobservable
//     buffer is erased by the same statement or the same method as an observable
//     one, and dropping it means editing a line whose other arguments are
//     asserted. And the accessor scan below proves the chaining key is not
//     handed out even if it did survive. What no test in this package can show
//     is that a defect zeroed `h` while leaving `ck` live; that is a read of the
//     module, and section 5 question 4 of
//     docs/relay-e2ee-noise-audit-scope.md asks the auditor for it by name.

describe("property: §6.5 erasure is unconditional", () => {
  it("zeroes the ephemeral secret buffer for any prefix of a handshake", () => {
    // The assertion is on the ACTUAL BUFFER, not on a status flag: the
    // test-only injected ephemeral is the one piece of private key material the
    // module takes ownership of from a caller's buffer, so the caller can watch
    // §6.5's "ephemeral private keys MUST be erased" happen. The property
    // quantifies over how far the handshake got — including a party destroyed
    // before it ever generated a message, whose ephemeral is still in the
    // pending slot and must be zeroed from there too.
    fc.assert(
      fc.property(
        materialArb,
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (material, steps, endWithSplit) => {
          const injected = Uint8Array.from(material.responderEphemeral);
          const responder = new E2eeNoiseHandshake({
            pattern: material.pattern,
            role: "responder",
            prologue: material.prologue,
            staticSecretKey: material.responderStatic,
            testOnlyEphemeralSecretKey: injected,
          });
          const initiator = initiatorOf(material);
          try {
            if (steps >= 1) {
              responder.readMessage(initiator.writeMessage(material.payload1));
              // Still live and still holding the ephemeral, which has not been
              // generated yet: the responder writes second.
              expect(isZeroed(injected)).toBe(false);
            }
            if (steps >= 2) {
              const message2 = responder.writeMessage(material.payload2);
              expect(message2.byteLength).toBeGreaterThan(0);
              // Generated and in use — the buffer is now `#e.secretKey` itself.
              expect(isZeroed(injected)).toBe(false);
            }
            if (steps >= 3 && endWithSplit) {
              responder.split();
            } else {
              responder.destroy();
            }
            // THE PROPERTY: whatever prefix ran, and whichever way it ended.
            return isZeroed(injected) && responder.status !== "awaiting_split";
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("zeroes a PENDING ephemeral when the read of message 1 is fatal", () => {
    // The path an attacker actually drives: a message the peer cannot process.
    // §8.6 step 4 makes it fatal, and fatal means erased — an implementation
    // that erased only on the two orderly endings would leave private key
    // material live in exactly the state an adversary can force at will.
    //
    // The responder generates its ephemeral in `writeMessage`, so the buffer
    // under watch here is still `#pendingEphemeralSecretKey`. The property below
    // is the mirror that watches the same erasure with the ephemeral LIVE.
    //
    // THE CUT IS DRAWN PER PATTERN, because the two patterns admit different
    // truncations and a bound that fits both is a bound that tests neither. IK
    // message 1 is `e ‖ EncryptAndHash(s) ‖ EncryptAndHash(payload)`, so any cut
    // inside it either starves a token or lands in an AEAD region and is
    // refused. NX message 1 is `e` followed by a CLEARTEXT payload (§8.5,
    // §8.10), so a cut in the payload is legitimately READ and only a cut below
    // `DHLEN` refuses.
    fc.assert(
      fc.property(materialArb, fc.nat(), (material, cutSelector) => {
        const injected = Uint8Array.from(material.responderEphemeral);
        const responder = new E2eeNoiseHandshake({
          pattern: material.pattern,
          role: "responder",
          prologue: material.prologue,
          staticSecretKey: material.responderStatic,
          testOnlyEphemeralSecretKey: injected,
        });
        const initiator = initiatorOf(material);
        try {
          const message1 = initiator.writeMessage(material.payload1);
          const refusable =
            material.pattern === E2EE_NOISE_PATTERN_IK ? message1.byteLength : DH_LEN;
          const truncated = message1.subarray(0, cutSelector % refusable);
          expect(() => responder.readMessage(truncated)).toThrow();
          return responder.status === "destroyed" && isZeroed(injected);
        } finally {
          initiator.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("zeroes a LIVE ephemeral when the read of message 2 is fatal", () => {
    // THE CONFIGURATION §6.5's ERASURE ACTUALLY HAS TO SURVIVE, and the one the
    // property above cannot reach: the initiator generated its ephemeral when it
    // wrote message 1, so the watched buffer is `#e.secretKey` — the pair the
    // handshake is USING — and the abort is a genuine AEAD refusal rather than a
    // length guard taken before any DH ran. An implementation that erased the
    // pending slot on a fatal read and forgot the live pair passes every other
    // property in this group and fails here.
    //
    // Any single-byte mutation of message 2 is fatal in both patterns: a flip in
    // `e` re-rolls `ee` and the payload no longer authenticates, and a flip
    // anywhere else is inside an AEAD region. The initiator is built inline
    // rather than through `initiatorOf`, which copies the ephemeral and leaves
    // the test nothing to watch.
    fc.assert(
      fc.property(
        materialArb,
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (material, byteIndex, mask) => {
          const injected = Uint8Array.from(material.initiatorEphemeral);
          const initiator = new E2eeNoiseHandshake({
            pattern: material.pattern,
            role: "initiator",
            prologue: material.prologue,
            ...(material.pattern === E2EE_NOISE_PATTERN_IK
              ? {
                  staticSecretKey: material.initiatorStatic,
                  remoteStaticPublicKey: x25519.getPublicKey(material.responderStatic),
                }
              : {}),
            testOnlyEphemeralSecretKey: injected,
          });
          const responder = responderOf(material);
          try {
            responder.readMessage(initiator.writeMessage(material.payload1));
            // Generated and in use: the buffer moved from the pending slot into
            // `#e.secretKey` and the handshake is mid-pattern.
            expect(isZeroed(injected)).toBe(false);

            const message2 = responder.writeMessage(material.payload2);
            const mutated = Uint8Array.from(message2);
            const index = byteIndex % mutated.byteLength;
            mutated[index] = (mutated[index] ?? 0) ^ mask;
            expect(() => initiator.readMessage(mutated)).toThrow();
            return initiator.status === "destroyed" && isZeroed(injected);
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("extracts the three §6.5 values and exposes nothing else that carries them", () => {
    // §6.5 fixes exactly three extractable values and forbids extracting
    // anything else from handshake state. The property reads EVERY accessor the
    // class publishes after `split()` and asserts that none of them hands back
    // a session value, the handshake hash, or the final chaining key — the three
    // §6.5 names by name — so an accessor added later fails here rather than
    // passing review on the strength of its doc comment.
    //
    // EACH OF THE THREE IS DETECTED DIFFERENTLY, because they are observable
    // differently. The `Split()` outputs and the exporter are compared directly.
    // `h` is captured off the LIVE handshake first and compared against every
    // accessor read afterwards. `ck_final` is never handed to this test at all,
    // so it is detected by its consequence: §6.5 defines the exporter as
    // `HKDF-Expand(ck_final, label, 32)`, so any 32-byte buffer that reproduces
    // `exporterSecret` under `e2eeNoiseExporterSecret` IS the chaining key,
    // whatever the accessor returning it is called. Comparing only against the
    // three returned secrets would miss both `h` and `ck`, since they are the
    // HKDF inputs rather than its outputs.
    fc.assert(
      fc.property(materialArb, (material) => {
        const initiator = initiatorOf(material);
        const responder = responderOf(material);
        try {
          responder.readMessage(initiator.writeMessage(material.payload1));
          initiator.readMessage(responder.writeMessage(material.payload2));
          // Read while the handshake is live, so the erased answer below is a
          // change in the buffer rather than an accessor that was always empty.
          const liveHandshakeHash = initiator.testOnlyHandshakeHash;
          expect(liveHandshakeHash).toBeDefined();
          const keys = initiator.split();

          const secrets = [keys.epochSecretC2N, keys.epochSecretN2C, keys.exporterSecret];
          for (const secret of secrets) {
            expect(secret.byteLength).toBe(E2EE_SECRET_BYTES);
            expect(isZeroed(secret)).toBe(false);
          }
          // The three are pairwise distinct: the exporter is derived from the
          // same `ck_final` as `Split()`, and a domain separation that failed
          // would show up as two equal buffers.
          expect(equalBytes(keys.epochSecretC2N, keys.epochSecretN2C)).toBe(false);
          expect(equalBytes(keys.epochSecretC2N, keys.exporterSecret)).toBe(false);
          expect(equalBytes(keys.epochSecretN2C, keys.exporterSecret)).toBe(false);

          // Every accessor the prototype publishes, read after erasure.
          const published = Object.getOwnPropertyNames(
            Object.getPrototypeOf(initiator) as object,
          ).filter((name) => name !== "constructor");
          const readable = published
            .map((name) => (initiator as unknown as Record<string, unknown>)[name])
            .filter((value): value is Uint8Array => value instanceof Uint8Array);
          for (const value of readable) {
            for (const forbidden of [...secrets, liveHandshakeHash!]) {
              expect(equalBytes(value, forbidden)).toBe(false);
            }
            if (value.byteLength === E2EE_SECRET_BYTES) {
              expect(equalBytes(e2eeNoiseExporterSecret(value), keys.exporterSecret)).toBe(false);
            }
          }
          // The handshake hash is gone from `h` ITSELF: the accessor reads the
          // buffer and reports `undefined` because `split()` zeroed it, so this
          // fails if the symmetric-state erasure in `splitAndExport()` is
          // dropped — which no other assertion in this package would notice.
          expect(initiator.testOnlyHandshakeHash).toBeUndefined();
          // What survives is public material only, and only where §13.5 needs
          // it: the initiator's own ephemeral public key and, on IK, the
          // responder static it already held.
          expect(initiator.localEphemeralPublicKey).toEqual(
            x25519.getPublicKey(material.initiatorEphemeral),
          );
          return true;
        } finally {
          initiator.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Role symmetry, prologue binding, and pre-message binding (§8.4, §8.10)
// ═════════════════════════════════════════════════════════════════════════════

describe("property: role symmetry and transcript binding", () => {
  it("drives the two roles to the same handshake hash and the same Split() outputs", () => {
    // The §8.10 grades rest on `#mixDh` resolving each DH token against the
    // LOCAL role — `es` is `DH(e, rs)` for the initiator and `DH(s, re)` for the
    // responder, `se` is the mirror. A resolution that swapped either one for
    // one role is invisible to a single-role test and fails immediately here,
    // for both patterns and for any generated key set.
    fc.assert(
      fc.property(materialArb, (material) => {
        const initiator = initiatorOf(material);
        const responder = responderOf(material);
        try {
          const carried1 = responder.readMessage(initiator.writeMessage(material.payload1));
          const carried2 = initiator.readMessage(responder.writeMessage(material.payload2));
          // The module carries payloads verbatim: it enforces no §8.5 schema.
          expect(equalBytes(carried1, material.payload1)).toBe(true);
          expect(equalBytes(carried2, material.payload2)).toBe(true);

          const initiatorHash = initiator.testOnlyHandshakeHash;
          const responderHash = responder.testOnlyHandshakeHash;
          expect(initiatorHash).toBeDefined();
          expect(responderHash).toBeDefined();
          expect(equalBytes(initiatorHash!, responderHash!)).toBe(true);

          // Each end learns the peer's public material the pattern transmits,
          // and nothing the pattern does not: NX transmits no client static.
          expect(initiator.remoteEphemeralPublicKey).toEqual(
            x25519.getPublicKey(material.responderEphemeral),
          );
          expect(responder.remoteEphemeralPublicKey).toEqual(
            x25519.getPublicKey(material.initiatorEphemeral),
          );
          expect(initiator.remoteStaticPublicKey).toEqual(
            x25519.getPublicKey(material.responderStatic),
          );
          expect(responder.remoteStaticPublicKey).toEqual(
            material.pattern === E2EE_NOISE_PATTERN_IK
              ? x25519.getPublicKey(material.initiatorStatic)
              : undefined,
          );

          return sessionKeysEqual(initiator.split(), responder.split());
        } finally {
          initiator.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("re-rolls every session value when one ephemeral changes", () => {
    // The §6.5 outputs derive from `ck_final`, and `ck_final` is a function of
    // the DH outputs alone — so this, and not the prologue below, is where the
    // per-channel freshness of the session keys actually comes from. The
    // property is injectivity over generated ephemerals: change one, and all
    // three values change.
    fc.assert(
      fc.property(materialArb, secretKeyArb, (material, otherEphemeral) => {
        fc.pre(!equalBytes(material.initiatorEphemeral, otherEphemeral));
        const first = runPair(material);
        const second = runPair({ ...material, initiatorEphemeral: otherEphemeral });
        return (
          !equalBytes(first.initiator.epochSecretC2N, second.initiator.epochSecretC2N) &&
          !equalBytes(first.initiator.epochSecretN2C, second.initiator.epochSecretN2C) &&
          !equalBytes(first.initiator.exporterSecret, second.initiator.exporterSecret)
        );
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("never lets two ends that disagree about the §8.4 prologue agree", () => {
    // WHERE THE PROLOGUE BINDING ACTUALLY LIVES, stated exactly, because the
    // obvious property is false: Noise mixes the prologue into `h` and never
    // into `ck`, so for a FIXED key set two runs under different prologues
    // produce the SAME `Split()` outputs. What the prologue changes is the AAD
    // of every `EncryptAndHash`, and that is what makes a channel-id
    // disagreement (§8.4) fatal instead of silent. So the property is stated as
    // non-agreement — the same shape as the mutation and truncation properties
    // below — and the handshake hash is asserted to move, which is the observable
    // a constructor that dropped the prologue mix would leave unchanged.
    let neitherEndRefused = 0;
    fc.assert(
      fc.property(materialArb, prologueArb, (material, otherPrologue) => {
        fc.pre(!equalBytes(material.prologue, otherPrologue));
        const initiator = initiatorOf(material);
        const responder = responderOf({ ...material, prologue: otherPrologue });
        try {
          const message1 = initiator.writeMessage(material.payload1);
          try {
            responder.readMessage(message1);
          } catch {
            // IK encrypts the client static under `h` in message 1, so the
            // disagreement is fatal one message earlier than on NX.
            return responder.status === "destroyed";
          }
          const message2 = responder.writeMessage(material.payload2);
          try {
            initiator.readMessage(message2);
          } catch {
            return initiator.status === "destroyed";
          }
          neitherEndRefused += 1;
          return !sessionKeysEqual(initiator.split(), responder.split());
        } finally {
          initiator.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
    // WHAT ACTUALLY RUNS — see the mutation property below for the full
    // argument. The NX cleartext read DEFERS the refusal to message 2, whose `s`
    // token is AEAD-protected under the diverged `h`; it does not admit a
    // completing run. So the non-agreement branch is the disjunct's insurance
    // and the refusal is the outcome, and this pins which of the two the
    // property is really demonstrating.
    expect(neitherEndRefused).toBe(0);
  });

  it("carries the prologue into the handshake hash, and into no other observable", () => {
    // The positive half of the property above: the prologue reaches `h` and
    // nothing else. On IK that also moves message 1, whose `s` token is
    // encrypted under `h`; on NX message 1 is `e` plus a CLEARTEXT payload, so
    // it is byte-identical across prologues — the web tier's first message
    // reveals nothing about the channel it belongs to.
    fc.assert(
      fc.property(materialArb, prologueArb, (material, otherPrologue) => {
        fc.pre(!equalBytes(material.prologue, otherPrologue));
        const first = initiatorOf(material);
        const second = initiatorOf({ ...material, prologue: otherPrologue });
        try {
          const firstMessage = first.writeMessage(material.payload1);
          const secondMessage = second.writeMessage(material.payload1);
          const firstHash = first.testOnlyHandshakeHash;
          const secondHash = second.testOnlyHandshakeHash;
          expect(firstHash).toBeDefined();
          expect(secondHash).toBeDefined();
          expect(equalBytes(firstHash!, secondHash!)).toBe(false);
          return material.pattern === E2EE_NOISE_PATTERN_IK
            ? !equalBytes(firstMessage, secondMessage)
            : equalBytes(firstMessage, secondMessage);
        } finally {
          first.destroy();
          second.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });

  it("binds the IK pre-message static: both roles hash it, and a substituted one refuses", () => {
    // IK's `<- s` pre-message is hashed by BOTH parties before the first message
    // (Noise §5.3). TWO OBLIGATIONS FOLLOW, and they are asserted separately
    // because the second does not imply the first — a constructor that dropped
    // the pre-message `MixHash` entirely still refuses a substituted prekey, on
    // the `es`/`ss` DH outputs disagreeing, so a property that only drove the
    // substitution would be blind to a genuine Noise §5.3 conformance defect
    // that changes every IK transcript.
    //
    //   1. THE PRE-MESSAGE REACHES `h`, IDENTICALLY AT BOTH ENDS. Before any
    //      message is written, `h` is the protocol name, the §8.4 prologue, and
    //      the pre-message static, and nothing else — so an honest initiator and
    //      its responder must already agree (a `MixHash` performed by one role
    //      only fails here), and an initiator advertised a DIFFERENT prekey must
    //      already differ (a `MixHash` performed by neither fails here).
    //   2. THE SUBSTITUTION IS REFUSED. An initiator advertised a different node
    //      agreement prekey (§5.1, §6.4) cannot complete against this responder.
    //
    // The substitution is drawn from generated key material rather than from one
    // pinned wrong key.
    fc.assert(
      fc.property(materialArb, secretKeyArb, (material, otherStatic) => {
        fc.pre(!equalBytes(material.responderStatic, otherStatic));
        const ikMaterial: HandshakeMaterial = { ...material, pattern: E2EE_NOISE_PATTERN_IK };
        const honest = initiatorOf(ikMaterial);
        const substituted = new E2eeNoiseHandshake({
          pattern: E2EE_NOISE_PATTERN_IK,
          role: "initiator",
          prologue: ikMaterial.prologue,
          staticSecretKey: ikMaterial.initiatorStatic,
          // The advertised prekey the attacker substituted.
          remoteStaticPublicKey: x25519.getPublicKey(otherStatic),
          testOnlyEphemeralSecretKey: Uint8Array.from(ikMaterial.initiatorEphemeral),
        });
        const responder = responderOf(ikMaterial);
        try {
          const honestHash = honest.testOnlyHandshakeHash;
          const responderHash = responder.testOnlyHandshakeHash;
          const substitutedHash = substituted.testOnlyHandshakeHash;
          expect(honestHash).toBeDefined();
          expect(responderHash).toBeDefined();
          expect(substitutedHash).toBeDefined();
          expect(equalBytes(honestHash!, responderHash!)).toBe(true);
          expect(equalBytes(honestHash!, substitutedHash!)).toBe(false);

          const message1 = substituted.writeMessage(ikMaterial.payload1);
          expect(() => responder.readMessage(message1)).toThrow();
          return responder.status === "destroyed";
        } finally {
          honest.destroy();
          substituted.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mutation and truncation never produce agreement (§14.1, §8.6 step 4)
// ═════════════════════════════════════════════════════════════════════════════

describe("property: mutation and truncation never produce an agreeing session", () => {
  it("refuses, or diverges, for any single-byte mutation of either message", () => {
    // The strongest honest form of §14.1's mutation obligation. A mutated
    // message need not be REFUSED — NX message 1 carries a cleartext payload
    // (§8.10 grade 0/0), so the responder reads a mutated one exactly as Noise
    // says it should. What must never happen is AGREEMENT: no mutation of any
    // byte of any handshake message may leave the two ends holding the same
    // session keys. That is the claim the whole §9 record layer rests on, and
    // it is what a `DecryptAndHash` that forgot to mix the ciphertext, or an
    // AAD that dropped `h`, would break.
    //
    // AND WHAT ACTUALLY RUNS IS THE REFUSAL, on every generated case, which the
    // counter below pins rather than leaves for a reader to guess. The NX
    // cleartext read does not admit a completing run: it merely DEFERS the
    // refusal by one message, because the divergence it causes lands on message
    // 2, whose `s` token is AEAD-protected under the diverged `h`. So the
    // disjunct is retained — it is the only form true for both patterns without
    // assuming AEAD unforgeability, and this suite tests a state machine rather
    // than a primitive — while the counter states plainly that the weaker branch
    // is insurance rather than the outcome. A change that made it reachable is a
    // change in what this module guarantees, and it fails here.
    let neitherEndRefused = 0;
    fc.assert(
      fc.property(
        materialArb,
        fc.constantFrom<0 | 1>(0, 1),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (material, target, byteIndex, mask) => {
          const initiator = initiatorOf(material);
          const responder = responderOf(material);
          const mutate = (message: Uint8Array): Uint8Array => {
            const copy = Uint8Array.from(message);
            const index = byteIndex % copy.byteLength;
            copy[index] = (copy[index] ?? 0) ^ mask;
            return copy;
          };
          try {
            const message1 = initiator.writeMessage(material.payload1);
            const delivered1 = target === 0 ? mutate(message1) : message1;
            try {
              responder.readMessage(delivered1);
            } catch {
              expect(responder.status).toBe("destroyed");
              return true;
            }
            const message2 = responder.writeMessage(material.payload2);
            const delivered2 = target === 1 ? mutate(message2) : message2;
            try {
              initiator.readMessage(delivered2);
            } catch {
              expect(initiator.status).toBe("destroyed");
              return true;
            }
            // Both ends processed the mutated transcript without refusing it,
            // which the NX cleartext payload makes possible. They MUST NOT
            // agree.
            neitherEndRefused += 1;
            return !sessionKeysEqual(initiator.split(), responder.split());
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
    expect(neitherEndRefused).toBe(0);
  });

  it("refuses, or diverges, for any truncation of either message", () => {
    // §14.1's truncation obligation, stated the same way: a truncated message
    // must never yield agreement. `take()` refuses a message the pattern runs
    // out of bytes for, and the AEAD refuses one whose ciphertext was cut — and
    // an NX message 1 truncated inside its cleartext payload is READ, which
    // defers the refusal to message 2 rather than admitting a completing run.
    // The counter after the assert is the same one the mutation property carries
    // and it says the same thing: the refusal is what runs.
    let neitherEndRefused = 0;
    fc.assert(
      fc.property(
        materialArb,
        fc.constantFrom<0 | 1>(0, 1),
        fc.nat(),
        (material, target, cutSelector) => {
          const initiator = initiatorOf(material);
          const responder = responderOf(material);
          const cutTo = (message: Uint8Array): Uint8Array =>
            message.subarray(0, cutSelector % message.byteLength);
          try {
            const message1 = initiator.writeMessage(material.payload1);
            const delivered1 = target === 0 ? cutTo(message1) : message1;
            try {
              responder.readMessage(delivered1);
            } catch {
              expect(responder.status).toBe("destroyed");
              return true;
            }
            const message2 = responder.writeMessage(material.payload2);
            const delivered2 = target === 1 ? cutTo(message2) : message2;
            try {
              initiator.readMessage(delivered2);
            } catch {
              expect(initiator.status).toBe("destroyed");
              return true;
            }
            neitherEndRefused += 1;
            return !sessionKeysEqual(initiator.split(), responder.split());
          } finally {
            initiator.destroy();
            responder.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: HANDSHAKE_RUNS },
    );
    expect(neitherEndRefused).toBe(0);
  });

  it("refuses a message beyond the Noise bound rather than reading a prefix of it", () => {
    // Noise §3 bounds a message at 65535 bytes. The refusal must be on the
    // WHOLE message: an implementation that read the first 65535 bytes and
    // dropped the rest would hand its peer a transcript the peer never wrote.
    fc.assert(
      fc.property(materialArb, fc.integer({ min: 1, max: 512 }), (material, excess) => {
        const initiator = initiatorOf(material);
        const responder = responderOf(material);
        try {
          const message1 = initiator.writeMessage(material.payload1);
          const oversized = new Uint8Array(65_535 + excess);
          oversized.set(message1);
          let reason: string | undefined;
          try {
            responder.readMessage(oversized);
          } catch (error) {
            expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
            reason = (error as E2eeNoiseHandshakeError).reason;
          }
          return reason === "message_too_large" && responder.status === "destroyed";
        } finally {
          initiator.destroy();
          responder.destroy();
        }
      }),
      { seed: PROPERTY_SEED, numRuns: BOUNDS_RUNS },
    );
  });

  it("refuses to write a message beyond the Noise bound rather than truncating it", () => {
    fc.assert(
      fc.property(
        patternArb,
        prologueArb,
        secretKeyArb,
        secretKeyArb,
        secretKeyArb,
        fc.integer({ min: 1, max: 512 }),
        (pattern, prologue, initiatorStatic, responderStatic, ephemeral, excess) => {
          const initiator = new E2eeNoiseHandshake({
            pattern,
            role: "initiator",
            prologue,
            ...(pattern === E2EE_NOISE_PATTERN_IK
              ? {
                  staticSecretKey: initiatorStatic,
                  remoteStaticPublicKey: x25519.getPublicKey(responderStatic),
                }
              : {}),
            testOnlyEphemeralSecretKey: Uint8Array.from(ephemeral),
          });
          try {
            let reason: string | undefined;
            try {
              initiator.writeMessage(new Uint8Array(65_535 + excess));
            } catch (error) {
              expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
              reason = (error as E2eeNoiseHandshakeError).reason;
            }
            return reason === "message_too_large" && initiator.status === "destroyed";
          } finally {
            initiator.destroy();
          }
        },
      ),
      { seed: PROPERTY_SEED, numRuns: BOUNDS_RUNS },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Key-material bounds refuse rather than truncate (§8.1, §3.2)
// ═════════════════════════════════════════════════════════════════════════════

describe("property: key-material bounds refuse rather than truncate", () => {
  it("refuses any key or injected ephemeral that is not exactly DHLEN", () => {
    fc.assert(
      fc.property(
        patternArb,
        prologueArb,
        secretKeyArb,
        fc.integer({ min: 0, max: 80 }).filter((length) => length !== DH_LEN),
        fc.constantFrom<"static" | "remoteStatic" | "ephemeral">(
          "static",
          "remoteStatic",
          "ephemeral",
        ),
        (pattern, prologue, goodKey, badLength, slot) => {
          // `remoteStatic` exists only on the IK initiator, which is also the
          // only role whose static is optional — so the slot under test fixes
          // the role rather than the other way round.
          const role = slot === "remoteStatic" ? "initiator" : "responder";
          const badKey = new Uint8Array(badLength).fill(0x5a);
          const options = {
            pattern: slot === "remoteStatic" ? E2EE_NOISE_PATTERN_IK : pattern,
            role,
            prologue,
            ...(slot === "remoteStatic"
              ? { staticSecretKey: goodKey, remoteStaticPublicKey: badKey }
              : slot === "static"
                ? { staticSecretKey: badKey }
                : { staticSecretKey: goodKey, testOnlyEphemeralSecretKey: badKey }),
          } as const;
          let reason: string | undefined;
          try {
            // A handshake that is BUILT here is the failure: it is spent
            // immediately so the run leaks no live key material either way.
            new E2eeNoiseHandshake(options).destroy();
          } catch (error) {
            expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
            reason = (error as E2eeNoiseHandshakeError).reason;
          }
          return reason === "invalid_key_material";
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });

  it("acquires nothing when the constructor refuses, whatever refused it", () => {
    // §9.5's ownership rule: a constructor that fails owns nothing, so the
    // caller's buffers are untouched and remain the caller's to erase. The
    // property watches the one buffer the constructor would otherwise ADOPT —
    // the test-only ephemeral — across every refusal the option shape can
    // produce.
    fc.assert(
      fc.property(
        patternArb,
        prologueArb,
        secretKeyArb,
        secretKeyArb,
        fc.constantFrom<"role" | "missing_static" | "surplus_static" | "surplus_remote">(
          "role",
          "missing_static",
          "surplus_static",
          "surplus_remote",
        ),
        (pattern, prologue, staticKey, ephemeral, defect) => {
          const injected = Uint8Array.from(ephemeral);
          const base = {
            pattern,
            prologue,
            testOnlyEphemeralSecretKey: injected,
          };
          const options =
            defect === "role"
              ? { ...base, role: "observer" as unknown as "initiator", staticSecretKey: staticKey }
              : defect === "missing_static"
                ? { ...base, role: "responder" as const }
                : defect === "surplus_static"
                  ? // The NX initiator has no static at all (§8.1).
                    {
                      ...base,
                      pattern: E2EE_NOISE_PATTERN_NX,
                      role: "initiator" as const,
                      staticSecretKey: staticKey,
                    }
                  : // Only the IK initiator may name a remote static.
                    {
                      ...base,
                      pattern: E2EE_NOISE_PATTERN_IK,
                      role: "responder" as const,
                      staticSecretKey: staticKey,
                      remoteStaticPublicKey: x25519.getPublicKey(staticKey),
                    };
          let reason: string | undefined;
          try {
            // A handshake that is BUILT here is already the failure — the
            // option set is one §8.1 forbids — and the `destroy()` only keeps
            // the run from leaving live key material behind on that path.
            new E2eeNoiseHandshake(options).destroy();
          } catch (error) {
            expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
            reason = (error as E2eeNoiseHandshakeError).reason;
          }
          // Refused, and the caller's ephemeral is exactly as it was handed in:
          // neither adopted nor zeroed by a half-built handshake.
          return reason === "invalid_options" && equalBytes(injected, ephemeral);
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The §6.5 exporter and the Noise §5.1 nonce (§14.1 nonce progression)
// ═════════════════════════════════════════════════════════════════════════════

describe("property: the §6.5 exporter is a deterministic, confined function of ck", () => {
  it("is a pure function of the chaining key, at exactly E2EE_SECRET_BYTES", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: E2EE_SECRET_BYTES, maxLength: E2EE_SECRET_BYTES }),
        (chainingKey) => {
          const first = e2eeNoiseExporterSecret(chainingKey);
          const second = e2eeNoiseExporterSecret(Uint8Array.from(chainingKey));
          return (
            first.byteLength === E2EE_SECRET_BYTES &&
            equalBytes(first, second) &&
            // It reads the chaining key and does not consume it.
            !isZeroed(chainingKey)
          );
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });

  it("separates distinct chaining keys", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: E2EE_SECRET_BYTES, maxLength: E2EE_SECRET_BYTES }),
        fc.uint8Array({ minLength: E2EE_SECRET_BYTES, maxLength: E2EE_SECRET_BYTES }),
        (left, right) => {
          fc.pre(!equalBytes(left, right));
          return !equalBytes(e2eeNoiseExporterSecret(left), e2eeNoiseExporterSecret(right));
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });

  it("refuses a chaining key of any other length", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 96 }).filter((length) => length !== E2EE_SECRET_BYTES),
        (length) => {
          let reason: string | undefined;
          try {
            e2eeNoiseExporterSecret(new Uint8Array(length));
          } catch (error) {
            expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
            reason = (error as E2eeNoiseHandshakeError).reason;
          }
          return reason === "invalid_key_material";
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });
});

// WHAT THIS GROUP DISCHARGES OF §14.1's "NONCE-PROGRESSION PROPERTIES", AND
// WHAT IT DOES NOT — stated here rather than left for an auditor to infer from
// three properties that all take a `bigint`.
//
// It covers the ENCODING and its injectivity, as a pure function. It does NOT
// observe a counter advancing on an AEAD operation or resetting on `MixKey()`,
// and no property over this module's public surface can: every AEAD invocation
// in both §3.4 patterns runs at counter 0, because each is preceded by a
// `MixKey()` that resets it, and both parties perform the same operations in the
// same order — so an implementation whose `InitializeKey` forgot Noise §5.1's
// reset stays in lockstep with its peer and completes every handshake. The
// counters that DO progress are pinned elsewhere, and an auditor looking for
// them should look there rather than here:
//
//   - Noise §5.1's reset, and the counter each handshake AEAD call actually
//     runs at, are pinned by the §16.3 F15 official vectors in
//     `relayE2eeNoise.test.ts` — byte-exact transcripts, which a missing reset
//     changes.
//   - The §9.3/§9.4 RECORD-layer counter and epoch progression is a different
//     nonce (`epoch ‖ counter`, big-endian) in a different module, outside the
//     §14.1 audit target, and is pinned by `relayE2eeSession.test.ts` and
//     `relayE2eeWire.test.ts`.

describe("property: the Noise §5.1 cipher nonce", () => {
  /**
   * The encoding stated independently of the module: 32 bits of zeros, then
   * `n` little-endian. Written on `DataView` so a defect in the module's own
   * byte loop cannot be reproduced by the expectation.
   */
  const referenceNonce = (counter: bigint): Uint8Array => {
    const nonce = new Uint8Array(E2EE_AEAD_NONCE_BYTES);
    new DataView(nonce.buffer).setBigUint64(E2EE_AEAD_NONCE_BYTES - 8, counter, true);
    return nonce;
  };

  it("encodes every counter as 32 zero bits followed by little-endian n", () => {
    // The encoding half of §14.1's nonce obligation, and the half that has
    // nowhere else to go: EVERY AEAD invocation in both patterns uses counter 0,
    // so no handshake transcript — official vectors included — can distinguish
    // this encoding from a wrong one. Nothing but a direct test pins it.
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_fffen }), (counter) => {
        const nonce = e2eeNoiseCipherNonce(counter);
        return (
          nonce.byteLength === E2EE_AEAD_NONCE_BYTES &&
          nonce.subarray(0, E2EE_AEAD_NONCE_BYTES - 8).every((byte) => byte === 0) &&
          equalBytes(nonce, referenceNonce(counter))
        );
      }),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });

  it("is injective, so no two counters share a nonce under one key", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_fffen }),
        fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_fffen }),
        (left, right) => {
          fc.pre(left !== right);
          return !equalBytes(e2eeNoiseCipherNonce(left), e2eeNoiseCipherNonce(right));
        },
      ),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });

  it("reserves 2^64 − 1 and refuses everything outside the field", () => {
    // Noise §5.1 reserves the maximum for `Rekey()`, so it is an error rather
    // than a usable nonce — and a negative counter is not a counter at all.
    fc.assert(
      fc.property(fc.bigInt({ min: 0xffff_ffff_ffff_ffffn, max: 1n << 80n }), (counter) => {
        let reason: string | undefined;
        try {
          e2eeNoiseCipherNonce(counter);
        } catch (error) {
          expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
          reason = (error as E2eeNoiseHandshakeError).reason;
        }
        return reason === "nonce_exhausted";
      }),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );

    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 64n), max: -1n }), (counter) => {
        let reason: string | undefined;
        try {
          e2eeNoiseCipherNonce(counter);
        } catch (error) {
          expect(error).toBeInstanceOf(E2eeNoiseHandshakeError);
          reason = (error as E2eeNoiseHandshakeError).reason;
        }
        return reason === "invalid_options";
      }),
      { seed: PROPERTY_SEED, numRuns: DERIVATION_RUNS },
    );
  });
});

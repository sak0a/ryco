import {
  E2EE_CAPABILITY_STATEMENT_MAX_BYTES,
  E2EE_CAPABILITY_STATEMENT_VALIDITY,
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PROTOCOL_VERSION,
} from "@ryco/shared/relayE2eeConstants";
import type { E2eeAdvertisedChannelMaterial } from "@ryco/shared/relayE2eeHandshake";
import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  e2eeSha256,
  validateE2eeNodeSignature,
  verifyE2eeSignature,
} from "@ryco/shared/relayE2eeKeys";
import {
  canonicalizeE2eeHubOrigin,
  encodeCanonicalE2eeCbor,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  type NodeE2eeCapabilitySelfCheckFailure,
  nodeE2eeCapabilitySelfCheck,
  RelayE2eeCapabilityBoundError,
  type NodeIdentityContinuityChainEntry,
} from "@ryco/shared/relayE2eeTranscripts";
import { encodeE2eeCapabilityCarrier } from "@ryco/shared/relayE2eeWire";

import type { NodeE2eePrekeyCertificate } from "./NodeE2eePrekeyClient.ts";
import type { EffectiveNodeE2eePolicy } from "./NodeE2eePolicyStore.ts";

// The §5.2 signed capability statement and its §5.3 carrier —
// docs/relay-e2ee-protocol.md §5.2, §5.3, §5.5, §5.7, §7.2.1, §7.6 and §7.6.1.
//
// WHAT THIS OWNS: assembling the statement from the node's own state, signing it
// through the §7.2.1 envelope, running the §7.6.1 self-check before the bytes may
// leave, and deciding whether the cached bytes are still the ones §5.7 permits.
// It does not touch a channel, a policy decision, or a fallback counter: what a
// node does with an unavailable advertisement is §5.5's disposition and belongs
// to the relay path.
//
// NOTHING HERE IS BUILT BY HAND. Every signed byte comes from the Phase 1
// encoders — `encodeNodeE2eeCapabilityTranscript`, then
// `encodeNodeE2eeCapabilitySigningEnvelope` — because §7.2's no-ad-hoc-transcript
// rule makes an assembled-here byte string a signing oracle, and because the
// transcript grows with the continuity chain and would otherwise exceed
// `E2EE_SIGNING_INPUT_MAX_BYTES` on a node that had done nothing worse than
// rotate its identity the permitted number of times (§5.5, §7.2.1).
//
// THE CACHE IS THE §5.7 FRESHNESS RULE, and it is deliberately not a key made of
// hand-picked fields. A change to policy, prekey, identity, or rotation state
// MUST produce a new statement, and the complete, exact statement of "any
// advertised element changed" is "the transcript encodes to different bytes".
// So every call re-reads the sources, re-encodes the transcript against the
// cached validity interval, and reuses the cached signature only when the two
// byte strings are equal. Adding an element to §7.6 therefore extends the
// freshness rule automatically; a field list would have to be remembered.

/**
 * §7.6 elements 2–6, together with a signer bound to the key those elements
 * name.
 *
 * One value rather than a read and a separate signing handle: a rotation landing
 * between the two would sign a statement under a key the statement does not
 * carry, and a verifier would reject it at §5.2 step 1 with nothing to act on.
 */
export interface NodeE2eeCapabilityIdentity {
  readonly nodeId: string;
  readonly identityKeyId: string;
  readonly identityPublicKey: Uint8Array;
  /** Signs the §7.2.1 envelope. Never the transcript, and never a bare digest. */
  readonly sign: (envelope: Uint8Array) => Promise<Uint8Array>;
}

/**
 * §7.6 elements 11 and 18, as a node that may advertise holds them.
 *
 * A structural type rather than the identity runtime's continuity status: this
 * module is one level below the runtime and must not depend upward on it. A node
 * whose §7.5 cross-check is unresolvable has no value to pass here at all, which
 * is §5.5 U2 and is reported by the source returning `undefined`.
 */
export interface NodeE2eeCapabilityContinuity {
  readonly continuityId: string;
  /** In carried order. Empty for a node that has never rotated. */
  readonly chain: readonly NodeIdentityContinuityChainEntry[];
}

/**
 * Why this node holds no conforming statement (§5.5 U2).
 *
 * The §7.6.1 bound names pass through unchanged, so an operator diagnostic can
 * say which check failed without this module restating the vocabulary. The four
 * added members are the conditions §5.5 U2 enumerates that are not size bounds:
 * no identity at this origin, no prekey certificate, an unresolvable continuity
 * id, and a signing interface that refused the envelope. `policy_unavailable` is
 * the §12.4 fail-closed state — the policy client publishes generation 0 until a
 * durable read succeeds, and 0 is the generation this node has never advertised.
 */
export type NodeE2eeStatementUnavailableReason =
  | NodeE2eeCapabilitySelfCheckFailure
  | "identity_unavailable"
  | "prekey_unavailable"
  | "policy_unavailable"
  | "signing_failed"
  /** The node's own state does not encode into a §7.6 element this protocol represents. */
  | "statement_invalid";

export interface NodeE2eeAdvertisement {
  /** The canonical Hub origin the statement was built for (§7.6 element 1). */
  readonly hubOrigin: string;
  /** §7.6, exactly the bytes the §7.2.1 envelope digests. */
  readonly transcript: Uint8Array;
  /** The identity signature over the §7.2.1 envelope. */
  readonly signature: Uint8Array;
  /** `[ bstr(transcript), bstr(signature) ]` (§7.6). */
  readonly statement: Uint8Array;
  /** SHA-256 of the exact statement bytes published to the Hub and carried to peers. */
  readonly statementDigest: Uint8Array;
  /** The §5.3 carrier JSON, UTF-8, ready for one unchunked data payload. */
  readonly carrier: Uint8Array;
  /** §7.6 element 15 (§5.7). */
  readonly policyGeneration: number;
  /** §7.6 elements 16 and 17. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  /**
   * §7.6 element 6, as advertised on this channel.
   *
   * Carried alongside its fingerprint rather than in place of it: §8.3 element 9
   * is the fingerprint and nothing here changes that, but §13.5 derives the
   * `WebSAS` over the node identity PUBLIC KEY, and a channel that held only the
   * fingerprint could not compute the value its own operator is asked to compare.
   */
  readonly nodeIdentityPublicKey: Uint8Array;
  /**
   * §7.6 elements 7–8, as advertised on this channel.
   *
   * Carried rather than re-read as a constant because §8.6 step 2 checks a
   * hello's `e2eeVersion` against **the range the node advertised on that
   * channel**, not against the range the running binary would advertise now.
   */
  readonly e2eeVersionMin: number;
  readonly e2eeVersionMax: number;
  /** Expiry of the exact agreement prekey carried by this statement. */
  readonly nodeAgreementPrekeyExpiresAt: number;
  /**
   * The §8.3 per-channel snapshot of what this statement advertised.
   *
   * Carried with the statement rather than re-read at handshake time: §8.3 binds
   * a channel to the statement advertised ON IT, so a rotation between the
   * advertisement and the hello must not retroactively change the context block.
   */
  readonly material: E2eeAdvertisedChannelMaterial;
}

export type NodeE2eeAdvertisementResult =
  | { readonly kind: "available"; readonly advertisement: NodeE2eeAdvertisement }
  | { readonly kind: "unavailable"; readonly reason: NodeE2eeStatementUnavailableReason };

export interface NodeE2eeCapabilityStatementSources {
  /** §7.6 elements 2–6 and the signer. Rejects when this node serves no such origin. */
  readonly identity: (hubOrigin: string) => Promise<NodeE2eeCapabilityIdentity>;
  /** §7.6 element 10 (§6.4, §7.3). */
  readonly prekey: (hubOrigin: string) => Promise<NodeE2eePrekeyCertificate>;
  /** §7.6 elements 11 and 18; `undefined` is the §7.5 unresolvable state. */
  readonly continuity: (hubOrigin: string) => Promise<NodeE2eeCapabilityContinuity | undefined>;
  /** §7.6 elements 9, 12 and 13, from the committed policy. Synchronous by §8.6. */
  readonly policy: () => EffectiveNodeE2eePolicy;
  /** §7.6 element 15 (§5.7). Zero means "never advertised", never "advertise zero". */
  readonly generation: () => number;
  readonly now?: () => number;
}

export interface NodeE2eeCapabilityStatementClient {
  /**
   * The statement to advertise on a new channel (§5.2).
   *
   * Never called from the acceptance announcement: it reads key custody and may
   * sign, and the announcement runs on the connection's serialized frame chain
   * where a slow step is a `pong` the peer is not receiving. The relay path calls
   * it as the connection becomes ready and again as each channel opens, both of
   * which are ahead of the hook (`RelayChannelRegistry`, §5.4).
   */
  readonly advertised: (hubOrigin: string) => Promise<NodeE2eeAdvertisementResult>;
}

const unavailable = (reason: NodeE2eeStatementUnavailableReason): NodeE2eeAdvertisementResult => ({
  kind: "unavailable",
  reason,
});

interface CacheEntry {
  readonly advertisement: NodeE2eeAdvertisement;
}

/**
 * Every input §7.6 draws an element from, read once per attempt.
 *
 * Assembled before anything is encoded so a failure names its own source: §5.5
 * U2's operator diagnostic distinguishes "no prekey" from "unresolvable
 * continuity id" from "the signing interface refused", and each has a different
 * remedy.
 */
interface StatementInputs {
  readonly identity: NodeE2eeCapabilityIdentity;
  readonly prekey: NodeE2eePrekeyCertificate;
  readonly continuity: NodeE2eeCapabilityContinuity;
  readonly policy: EffectiveNodeE2eePolicy;
  readonly generation: number;
}

export function makeNodeE2eeCapabilityStatementClient(
  sources: NodeE2eeCapabilityStatementSources,
): NodeE2eeCapabilityStatementClient {
  const now = sources.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  /**
   * Serialize per origin, so several channels opening at once sign once.
   *
   * The alternative is not merely wasteful: each concurrent build would produce
   * a statement with its own `issuedAt`, and the last one to finish would evict
   * the others from the cache while their channels advertise bytes the cache no
   * longer holds — leaving the §8.3 snapshot and the cached statement disagreeing
   * about which prekey a channel advertised.
   */
  const queues = new Map<string, Promise<void>>();
  const serialize = async <A>(hubOrigin: string, operation: () => Promise<A>): Promise<A> => {
    const previous = queues.get(hubOrigin) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queues.set(hubOrigin, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (queues.get(hubOrigin) === current) queues.delete(hubOrigin);
    }
  };

  const readInputs = async (
    hubOrigin: string,
  ): Promise<StatementInputs | NodeE2eeStatementUnavailableReason> => {
    let identity: NodeE2eeCapabilityIdentity;
    try {
      identity = await sources.identity(hubOrigin);
    } catch {
      return "identity_unavailable";
    }
    let prekey: NodeE2eePrekeyCertificate;
    try {
      prekey = await sources.prekey(hubOrigin);
    } catch {
      return "prekey_unavailable";
    }
    let continuity: NodeE2eeCapabilityContinuity | undefined;
    try {
      continuity = await sources.continuity(hubOrigin);
    } catch {
      // §7.5's own answer for key material this node no longer holds is a broken
      // chain, not an exception, so a throw here is the store failing to answer
      // at all — which is exactly the "anchor is unreadable" clause of §5.5 U2.
      return "continuity_id_unresolved";
    }
    if (continuity === undefined) return "continuity_id_unresolved";
    const policy = sources.policy();
    const generation = sources.generation();
    // §5.7 and §12.4: the policy client publishes the fail-closed policy at
    // generation 0 until a durable read succeeds. A node in that state does not
    // know what it promised, so it advertises nothing rather than advertising a
    // generation no client may ever see again.
    if (generation <= 0) return "policy_unavailable";
    return { identity, prekey, continuity, policy, generation };
  };

  /**
   * The §7.6 transcript for one validity interval.
   *
   * Also the freshness comparison: called once with the cached interval to ask
   * whether anything else moved, and once with a fresh interval to build. It
   * throws `RelayE2eeCapabilityBoundError` for an over-long transcript and
   * `RelayE2eeValidationError` for material this protocol will not represent;
   * both are §5.5 U2 and are mapped by the caller.
   */
  const encodeTranscript = (
    hubOrigin: string,
    inputs: StatementInputs,
    issuedAt: number,
    expiresAt: number,
  ): Uint8Array =>
    encodeNodeE2eeCapabilityTranscript({
      hubOrigin,
      nodeId: inputs.identity.nodeId,
      identityKeyId: inputs.identity.identityKeyId,
      identityPublicKey: inputs.identity.identityPublicKey,
      // Version 1 offers exactly the version it implements. §7.6 elements 7–8
      // require the range to contain every version §8.6 step 2 will accept, and
      // §7.6.1 re-checks that against `E2EE_PROTOCOL_VERSION` before emission.
      e2eeVersionMin: E2EE_PROTOCOL_VERSION,
      e2eeVersionMax: E2EE_PROTOCOL_VERSION,
      suiteRegistry: inputs.policy.advertised.suiteRegistry,
      prekeyCertificate: {
        prekeyId: inputs.prekey.prekeyId,
        agreementPublicKey: inputs.prekey.agreementPublicKey,
        crossSignature: inputs.prekey.crossSignature,
        createdAt: inputs.prekey.createdAt,
        expiresAt: inputs.prekey.expiresAt,
      },
      continuityChain: inputs.continuity.chain,
      // The RAW pair (§7.6 elements 12–13). `EffectiveNodeE2eePolicy.requireE2EE`
      // is §12.4's OR and is the admission rule, not an advertised element; the
      // encoder derives element 14 from the raw `requireApprovedClientE2EE`.
      requireE2EE: inputs.policy.advertised.requireE2EE,
      requireApprovedClientE2EE: inputs.policy.advertised.requireApprovedClientE2EE,
      policyGeneration: inputs.generation,
      issuedAt,
      expiresAt,
      continuityId: inputs.continuity.continuityId,
    });

  /**
   * §5.7 freshness of a cached statement against this node's own clock.
   *
   * Reuse stops a full `E2EE_MAX_CLOCK_SKEW` before expiry rather than at it:
   * that is the largest disagreement a conforming verifier's clock may have with
   * this one, so a statement with more than that left is live at every verifier
   * that receives it. A clock that moved backwards past `issuedAt` also ends
   * reuse — a statement issued in a verifier's future fails §5.7 outright.
   */
  const reusable = (advertisement: NodeE2eeAdvertisement, at: number): boolean =>
    at >= advertisement.issuedAt && at + E2EE_MAX_CLOCK_SKEW < advertisement.expiresAt;

  const build = async (rawHubOrigin: string): Promise<NodeE2eeAdvertisementResult> => {
    // Canonicalized once, here, and used for every later step including the
    // cache key: the transcript encoder canonicalizes its own input, so a raw
    // origin would leave the §7.6.1 measurement and the signed bytes measuring
    // two different strings. Refusal is `hub_origin_max_bytes` — §5.5 U2's
    // "canonical Hub origin exceeds `E2EE_HUB_ORIGIN_MAX_BYTES`" — because an
    // origin this node cannot represent is the same unadvertisable condition
    // whether it is too long or not an origin at all.
    let hubOrigin: string;
    try {
      hubOrigin = canonicalizeE2eeHubOrigin(rawHubOrigin);
    } catch {
      return unavailable("hub_origin_max_bytes");
    }
    const inputs = await readInputs(hubOrigin);
    if (typeof inputs === "string") return unavailable(inputs);
    const at = now();

    const cached = cache.get(hubOrigin);
    if (cached !== undefined && reusable(cached.advertisement, at)) {
      // The complete §5.7 test: everything except the validity interval is held
      // fixed, so equal bytes mean nothing advertised has changed and unequal
      // bytes mean something has — whatever it was, and including elements a
      // later revision adds.
      let candidate: Uint8Array | undefined;
      try {
        candidate = encodeTranscript(
          hubOrigin,
          inputs,
          cached.advertisement.issuedAt,
          cached.advertisement.expiresAt,
        );
      } catch {
        candidate = undefined;
      }
      if (candidate !== undefined && e2eeBytesEqual(candidate, cached.advertisement.transcript)) {
        return { kind: "available", advertisement: cached.advertisement };
      }
    }
    // A cached statement that is no longer the one to advertise is dropped here,
    // not left to be overwritten on success: a build that then fails must not
    // leave a superseded statement reachable.
    cache.delete(hubOrigin);

    const issuedAt = at;
    const expiresAt = at + E2EE_CAPABILITY_STATEMENT_VALIDITY;
    let transcript: Uint8Array;
    let envelope: Uint8Array;
    try {
      transcript = encodeTranscript(hubOrigin, inputs, issuedAt, expiresAt);
      envelope = encodeNodeE2eeCapabilitySigningEnvelope(transcript);
    } catch (error: unknown) {
      return unavailable(
        error instanceof RelayE2eeCapabilityBoundError ? error.bound : "statement_invalid",
      );
    }

    // The signing call, then the same verification a client performs at §5.2
    // step 1, over the envelope this node rebuilt itself. `NodeE2eePrekeyClient`
    // holds the same line for the §7.3 certificate, and for the same reason: a
    // custody backend that returns a signature nobody can verify would otherwise
    // put an unverifiable statement in front of every client this node serves,
    // and every one of them would take it as an identity event.
    let signature: Uint8Array;
    try {
      signature = validateE2eeNodeSignature(await inputs.identity.sign(envelope));
      const verifies = verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: inputs.identity.identityPublicKey,
        message: encodeNodeE2eeCapabilitySigningEnvelope(transcript),
        signature,
      });
      if (!verifies) return unavailable("signing_failed");
    } catch {
      return unavailable("signing_failed");
    }

    let statement: Uint8Array;
    try {
      statement = encodeCanonicalE2eeCbor([transcript, signature]);
    } catch {
      return unavailable("statement_invalid");
    }
    let carrier: Uint8Array;
    try {
      carrier = encodeE2eeCapabilityCarrier(statement);
    } catch {
      // The carrier encoder refuses exactly the two §5.3 bounds, and the
      // statement bound is the one that decides which. §3.2.1 S4 and S5 make
      // both unreachable for a conforming node; they are reported rather than
      // assumed because that is what §7.6.1 asks the node to prove.
      return unavailable(
        statement.byteLength > E2EE_CAPABILITY_STATEMENT_MAX_BYTES
          ? "capability_statement_max_bytes"
          : "capability_carrier_max_bytes",
      );
    }

    // §7.6.1, over the artifacts that were actually built. It runs after the
    // signing call because "the signing call itself succeeds" is one of its
    // conditions, and the bounds it re-checks are the ones an over-long Hub
    // origin or continuity chain would break.
    const check = nodeE2eeCapabilitySelfCheck({
      hubOrigin,
      transcript,
      envelope,
      statement,
      carrier,
      e2eeVersionMin: E2EE_PROTOCOL_VERSION,
      e2eeVersionMax: E2EE_PROTOCOL_VERSION,
      continuityIdResolved: true,
    });
    if (check.kind === "error") return unavailable(check.failure);

    const statementDigest = e2eeSha256(statement);
    const advertisement: NodeE2eeAdvertisement = {
      hubOrigin,
      transcript,
      signature,
      statement,
      statementDigest,
      carrier,
      policyGeneration: inputs.generation,
      issuedAt,
      expiresAt,
      nodeIdentityPublicKey: inputs.identity.identityPublicKey,
      e2eeVersionMin: E2EE_PROTOCOL_VERSION,
      e2eeVersionMax: E2EE_PROTOCOL_VERSION,
      nodeAgreementPrekeyExpiresAt: inputs.prekey.expiresAt,
      material: {
        nodeId: inputs.identity.nodeId,
        nodeIdentityFingerprint: e2eeKeyFingerprint(
          "node-identity",
          inputs.identity.identityPublicKey,
        ),
        prekeyId: inputs.prekey.prekeyId,
        agreementPublicKey: inputs.prekey.agreementPublicKey,
        continuityChainTranscripts: inputs.continuity.chain.map((entry) => entry.transcript),
        continuityId: inputs.continuity.continuityId,
        policyGeneration: inputs.generation,
        capabilityStatementDigest: statementDigest,
      },
    };
    cache.set(hubOrigin, { advertisement });
    return { kind: "available", advertisement };
  };

  return {
    advertised: (hubOrigin) => serialize(hubOrigin, () => build(hubOrigin)),
  };
}

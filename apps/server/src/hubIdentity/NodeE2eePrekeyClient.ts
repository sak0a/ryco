import { randomBytes } from "node:crypto";

import { canonicalizeHubOrigin } from "@ryco/shared/nodeIdentity";
import {
  E2EE_MAX_CLOCK_SKEW,
  E2EE_PREKEY_LIFETIME,
  E2EE_PREKEY_ROTATION_OVERLAP,
} from "@ryco/shared/relayE2eeConstants";
import { e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import {
  encodeNodeE2eePrekeyTranscript,
  type NodeE2eeCapabilityPrekeyCertificate,
  verifyNodeE2eeCapabilityCrossSignature,
} from "@ryco/shared/relayE2eeTranscripts";

import type { NodeAuthenticationKeySelector } from "./HubNodeProofClient.ts";
import type { LocalHubIdentityState, LocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import { type NodeAgreementIdentity, NodeAgreementIdentityError } from "./NodeAgreementIdentity.ts";
import type {
  NodeE2eePrekeyRecord,
  NodeE2eePrekeyState,
  NodeE2eePrekeyStore,
} from "./NodeE2eePrekeyStore.ts";
import type { NodeSigningIdentity } from "./NodeSigningIdentity.ts";

// The node agreement prekey and its §7.3 certificate —
// docs/relay-e2ee-protocol.md §6.2 (static agreement keys and cross-signatures),
// §6.4 (prekey lifetime, rotation, and expiry), and §7.3 (the certificate).
//
// WHAT THIS OWNS: issuing the certificate, keeping it durable so a channel can
// advertise it without re-signing, deciding when it must be replaced, and
// running the §6.4 staged rotation with its overlap window. It does not
// advertise, negotiate, or hand shake; the §5.2 statement builder and the §8
// responder consume `advertised` and `withPrekeySecret` respectively.
//
// THE CROSS-SIGNATURE IS NEVER BUILT BY HAND. §7.2's no-ad-hoc-transcript rule
// means the signed bytes come from `encodeNodeE2eePrekeyTranscript` and the
// self-check goes back through `verifyNodeE2eeCapabilityCrossSignature` — the
// same Phase 1 verifier a client runs against the advertised statement. A node
// that cannot verify its own certificate re-issues rather than advertising
// something no client would accept.

/**
 * The §6.4 remedy for an expired prekey, in the exact words the operator
 * surfaces should use.
 *
 * §6.4 gives expiry a named local diagnostic and a specific repair: the node
 * re-signs at startup, and the CLI can force a rotation at any time. Keeping the
 * sentence here, rather than in each caller, is what keeps the diagnostic and
 * its remedy from drifting apart.
 */
export const E2EE_PREKEY_EXPIRED_REMEDY =
  "The node re-signs its agreement prekey at startup; run the forced prekey rotation command to replace it immediately.";

export type NodeE2eePrekeyErrorCode =
  /**
   * §6.4: the certificate is outside its validity window, allowing
   * `E2EE_MAX_CLOCK_SKEW`. A local diagnostic and API code only — §6.4 forbids a
   * distinct wire signal, so the channel-level behavior stays the generic §11
   * surface.
   */
  | "e2ee_prekey_expired"
  /** No active node for this origin, or this node cannot represent itself in a §7.3 transcript. */
  | "e2ee_prekey_unavailable"
  /** The requested prekey id is neither the active prekey nor a retained outgoing one (§6.4). */
  | "e2ee_prekey_not_found"
  /** The protected store, the signing key, or the agreement key failed. */
  | "e2ee_prekey_custody_failed"
  /** The durable record could not be read or committed. */
  | "e2ee_prekey_state_failed";

export class NodeE2eePrekeyError extends Error {
  readonly code: NodeE2eePrekeyErrorCode;

  constructor(code: NodeE2eePrekeyErrorCode) {
    super("Node E2EE prekey operation failed.");
    this.name = "NodeE2eePrekeyError";
    this.code = code;
  }
}

/**
 * The §7.3 certificate as §7.6 carries it, plus the fields it is bound to.
 *
 * `identityPublicKey` is deliberately absent: §7.6 element 6 comes from the
 * signing identity, and a copy kept here could disagree with the key that
 * actually signed. The binding fields are present because a verifier checks them
 * against the statement (§7.3), so the statement builder must not invent them.
 */
export interface NodeE2eePrekeyCertificate extends NodeE2eeCapabilityPrekeyCertificate {
  readonly hubOrigin: string;
  readonly nodeId: string;
  readonly identityKeyId: string;
}

/**
 * Where a certificate sits in its §6.4 lifetime.
 *
 * `renewable` is the §6.4 re-sign trigger — "expired or would expire within
 * `E2EE_PREKEY_ROTATION_OVERLAP`" — and is deliberately distinct from `expired`,
 * which is a hard failure. A renewable certificate is still valid evidence and
 * an established channel is never disturbed by it (§6.4).
 */
export type NodeE2eePrekeyValidity = "usable" | "renewable" | "expired";

export interface NodeE2eePrekeyClient {
  /**
   * §6.4's node remedy: validate the certificate this node holds and re-sign
   * when it is missing, expired, renewable, no longer bound to the active
   * identity key, or no longer verifiable. Sweeps a due outgoing prekey first.
   *
   * Called at startup, at every change to the identity binding the certificate
   * is signed under, and from `advertised` when it finds the stored certificate
   * unusable. §6.4's "at startup" is a floor: a node that runs for months would
   * otherwise pass its own expiry, and an identity rotation would leave it with
   * a certificate bound to a key that no longer signs anything.
   */
  readonly ensure: (hubOrigin: string) => Promise<NodeE2eePrekeyCertificate>;
  /** §6.4's forced rotation: always a new keypair and a new certificate. */
  readonly rotate: (hubOrigin: string) => Promise<NodeE2eePrekeyCertificate>;
  /**
   * The certificate to advertise on a new channel (§5.2).
   *
   * A pure read whenever the stored certificate is bound to the current
   * identity and still usable, which is the steady state. When it is not — an
   * identity rotation activated, the certificate reached its §6.4 renewal
   * window, or none exists — this re-signs before returning, because the
   * alternative is a node that stops advertising until it is restarted.
   */
  readonly advertised: (hubOrigin: string) => Promise<NodeE2eePrekeyCertificate>;
  /**
   * Borrow the secret half of the prekey a channel advertised (§6.4, §8).
   *
   * Resolution is by prekey id, not by "the current prekey", because §6.4
   * requires the responder to complete a handshake against the prekey it
   * advertised on that channel — which, during the overlap window, may be the
   * outgoing one.
   */
  readonly withPrekeySecret: <A>(
    hubOrigin: string,
    prekeyId: string,
    use: (secretKey: Uint8Array) => Promise<A> | A,
  ) => Promise<A>;
  /** Destroy a retained outgoing agreement key whose overlap window has elapsed (§6.4). */
  readonly sweep: () => Promise<void>;
}

export interface NodeE2eePrekeyClientDependencies {
  readonly agreementIdentity: NodeAgreementIdentity;
  readonly signingIdentity: NodeSigningIdentity;
  readonly keySelector: NodeAuthenticationKeySelector;
  /** The identity this certificate is bound to. Read only; never written here. */
  readonly stateStore: LocalHubIdentityStateStore;
  /** The durable prekey slots (`NodeE2eePrekeyStore`). */
  readonly prekeyStore: NodeE2eePrekeyStore;
  readonly now?: () => number;
}

function prekeyError(code: NodeE2eePrekeyErrorCode): never {
  throw new NodeE2eePrekeyError(code);
}

function encodeBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

/**
 * §6.4: expiry is evaluated against the verifier's clock with at most
 * `E2EE_MAX_CLOCK_SKEW` allowance, and a certificate outside its window in
 * either direction is not valid evidence. The lower bound matters for a node
 * validating its own certificate after the clock jumps backwards: the material
 * is fine, but no verifier would accept it, so re-issuing is the repair.
 */
export function nodeE2eePrekeyValidity(
  certificate: { readonly createdAt: number; readonly expiresAt: number },
  now: number,
): NodeE2eePrekeyValidity {
  if (now > certificate.expiresAt + E2EE_MAX_CLOCK_SKEW) return "expired";
  if (now + E2EE_MAX_CLOCK_SKEW < certificate.createdAt) return "expired";
  if (now + E2EE_PREKEY_ROTATION_OVERLAP >= certificate.expiresAt) return "renewable";
  return "usable";
}

function certificateOf(record: NodeE2eePrekeyState): NodeE2eePrekeyCertificate {
  return {
    hubOrigin: record.hubOrigin,
    nodeId: record.nodeId,
    identityKeyId: record.identityKeyId,
    prekeyId: record.prekeyId,
    agreementPublicKey: decodeBytes(record.agreementPublicKey),
    crossSignature: decodeBytes(record.crossSignature),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function makeNodeE2eePrekeyClient(
  dependencies: NodeE2eePrekeyClientDependencies,
): NodeE2eePrekeyClient {
  const now = dependencies.now ?? Date.now;

  const bounded = async <A>(
    code: NodeE2eePrekeyErrorCode,
    operation: () => Promise<A>,
  ): Promise<A> => {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof NodeE2eePrekeyError) throw error;
      return prekeyError(code);
    }
  };

  const canonical = (rawHubOrigin: string): string => {
    try {
      return canonicalizeHubOrigin(rawHubOrigin);
    } catch {
      return prekeyError("e2ee_prekey_unavailable");
    }
  };

  const readState = (): Promise<LocalHubIdentityState> =>
    bounded("e2ee_prekey_state_failed", () => dependencies.stateStore.readOrCreate());

  const readPrekeys = (): Promise<NodeE2eePrekeyRecord> =>
    bounded("e2ee_prekey_state_failed", () => dependencies.prekeyStore.read());

  /**
   * Serialize every operation that issues a prekey, per origin.
   *
   * Two concurrent issues would both read the same slots, both generate a key,
   * and the loser's compare-and-update would fail after its key was already
   * created — and, before the ordering fix in `rotate`, after the displaced key
   * was already destroyed. Now that `advertised` can issue, concurrency is the
   * normal case rather than an operator race: several channels can open at once
   * and all of them want the same single new certificate.
   */
  const issueQueues = new Map<string, Promise<void>>();
  const serialize = async <A>(hubOrigin: string, operation: () => Promise<A>): Promise<A> => {
    const previous = issueQueues.get(hubOrigin) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    issueQueues.set(hubOrigin, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (issueQueues.get(hubOrigin) === current) issueQueues.delete(hubOrigin);
    }
  };

  /**
   * The identity this certificate must be bound to.
   *
   * The key comes from the same selector the relay authentication proof uses, so
   * a staged identity rotation that has already activated produces a prekey
   * certificate under the key that will actually authenticate — not under the
   * one the state file still calls active.
   */
  const readContext = async (
    hubOrigin: string,
  ): Promise<{
    readonly nodeId: string;
    readonly identityKeyId: string;
    readonly identitySecretName: string;
  }> => {
    const state = await readState();
    const active = state.activeNode;
    if (active === null || active.hubOrigin !== hubOrigin) {
      return prekeyError("e2ee_prekey_unavailable");
    }
    const selected = await bounded("e2ee_prekey_custody_failed", () =>
      dependencies.keySelector.authenticationKey(hubOrigin),
    );
    return {
      nodeId: active.nodeId,
      identityKeyId: selected.keyId,
      identitySecretName: selected.secretName,
    };
  };

  const boundToCurrentIdentity = (
    record: NodeE2eePrekeyState,
    context: { readonly nodeId: string; readonly identityKeyId: string },
    hubOrigin: string,
  ): boolean =>
    record.hubOrigin === hubOrigin &&
    record.nodeId === context.nodeId &&
    record.identityKeyId === context.identityKeyId;

  /**
   * Destroy every secret the record has queued for destruction, then forget it.
   *
   * The list is the durable half of §6.4's destroy requirement. A name reaches
   * it in the same atomic write that stops calling the key usable, so at no
   * point does a usable slot name a secret that is gone, and at no point is a
   * secret unreachable from durable state. A crash mid-drain simply leaves the
   * name listed, and the next drain finishes the job.
   */
  const drainRetiring = async (record: NodeE2eePrekeyRecord): Promise<void> => {
    const names = record.retiringSecretNames;
    if (names.length === 0) return;
    for (const name of names) {
      await bounded("e2ee_prekey_custody_failed", () =>
        dependencies.agreementIdentity.delete(name),
      );
    }
    await bounded("e2ee_prekey_state_failed", () =>
      dependencies.prekeyStore.update((current) => ({
        ...current,
        revision: current.revision + 1,
        // Only the names this pass actually destroyed. Another pass may have
        // queued one in between, and dropping that would strand its key.
        retiringSecretNames: current.retiringSecretNames.filter(
          (candidate) => !names.includes(candidate),
        ),
      })),
    );
  };

  const sweep: NodeE2eePrekeyClient["sweep"] = async () => {
    const record = await readPrekeys();
    await drainRetiring(record);
    const outgoing = record.outgoingE2eePrekey;
    if (outgoing === null || now() <= outgoing.retainUntil) return;
    await bounded("e2ee_prekey_state_failed", () =>
      dependencies.prekeyStore.update((current) => {
        // Idempotent and resumable: another pass may have cleared the slot
        // between the read above and this commit, and clearing a DIFFERENT slot
        // would strand that key. The store requires a revision bump from every
        // committed change, so the no-op case writes one rather than reporting a
        // failure for work someone else already did.
        if (current.outgoingE2eePrekey?.prekeyId !== outgoing.prekeyId) {
          return { ...current, revision: current.revision + 1 };
        }
        return {
          ...current,
          revision: current.revision + 1,
          outgoingE2eePrekey: null,
          retiringSecretNames: [...current.retiringSecretNames, outgoing.secretName],
        };
      }),
    );
    await drainRetiring(await readPrekeys());
  };

  /**
   * The §6.4 sweep, run when the overlap deadline has passed or a destroy is
   * owed, and never allowed to fail the operation that noticed.
   *
   * Housekeeping must not decide whether this node can advertise or issue: a
   * credential store that will not delete is a condition to retry, not a reason
   * to take the node off E2EE. Nothing is lost by deferring — the name stays on
   * the durable queue and every later pass tries again.
   *
   * `sweep` itself stays strict, and nothing in production observes that today:
   * `ensure` and this are its only callers and both swallow, and it is not on
   * the runtime shape. What the strictness buys is that the failure remains
   * expressible — the tests assert it directly, and the §6.4 sweep the CLI slice
   * owes an operator (see the operator-surface note in `HubIdentityRuntime`) can
   * report it without this module having to grow a second, reporting variant.
   */
  const sweepIfDue = async (record: NodeE2eePrekeyRecord): Promise<void> => {
    const outgoing = record.outgoingE2eePrekey;
    if (
      record.retiringSecretNames.length === 0 &&
      (outgoing === null || now() <= outgoing.retainUntil)
    ) {
      return;
    }
    await sweep().catch(() => undefined);
  };

  const issue = async (hubOrigin: string): Promise<NodeE2eePrekeyCertificate> => {
    const context = await readContext(hubOrigin);
    // Drain first, so the queue this promotion adds to holds at most the one
    // name this rotation displaces. Best effort for the reason `sweepIfDue`
    // gives: an undestroyed key is a retry, not a reason to refuse to issue.
    await drainRetiring(await readPrekeys()).catch(() => undefined);
    const prekeys = await readPrekeys();
    const identity = await bounded("e2ee_prekey_custody_failed", () =>
      dependencies.signingIdentity.getPublicDescriptor(context.identitySecretName),
    );

    // Stage one — create the replacement under a NEW name. The store is
    // create-only, so this can never overwrite the key in service; a crash here
    // leaves the old certificate wholly intact and the new key unreferenced.
    const secretName = `e2ee-prekey.${randomBytes(16).toString("hex")}`;
    const prekeyId = `epk_${randomBytes(16).toString("base64url")}`;
    const agreement = await bounded("e2ee_prekey_custody_failed", () =>
      dependencies.agreementIdentity.generate(secretName),
    );

    let committed = false;
    try {
      const createdAt = now();
      const expiresAt = createdAt + E2EE_PREKEY_LIFETIME;
      const transcript = await bounded("e2ee_prekey_unavailable", async () =>
        encodeNodeE2eePrekeyTranscript({
          hubOrigin,
          nodeId: context.nodeId,
          identityKeyId: context.identityKeyId,
          prekeyId,
          identityPublicKey: identity.publicKey,
          agreementPublicKey: agreement.publicKey,
          createdAt,
          expiresAt,
        }),
      );
      const crossSignature = await bounded("e2ee_prekey_custody_failed", () =>
        dependencies.signingIdentity.sign(context.identitySecretName, transcript),
      );
      const record: NodeE2eePrekeyState = {
        hubOrigin,
        nodeId: context.nodeId,
        identityKeyId: context.identityKeyId,
        prekeyId,
        secretName,
        agreementPublicKey: encodeBytes(agreement.publicKey),
        crossSignature: encodeBytes(crossSignature),
        createdAt,
        expiresAt,
      };

      // One outgoing slot exists, so a second rotation inside the overlap window
      // ends the older prekey's overlap early. Its key is destroyed AFTER the
      // commit below and never before — this key is still named by durable
      // state and still inside its advertised overlap, so destroying it first
      // would break a handshake the state says must work, and would destroy a
      // live key outright whenever the compare-and-update then failed. The
      // commit does not simply forget the name, it moves it to the destroy
      // queue, so the ordering costs no orphan either.
      const displaced = prekeys.outgoingE2eePrekey;
      const previous = prekeys.e2eePrekey;
      // Stage two — the promotion. One compare-and-update installs the new
      // certificate, moves the previous one into the overlap slot, and queues
      // the displaced key for destruction, so a crash lands on one side of it or
      // the other and never on a torn mixture.
      //
      // The identity this certificate is bound to is NOT part of this
      // compare-and-update, and cannot be: it lives in another record, and no
      // atomic write spans both. An identity rotation that activates between
      // `readContext` above and this commit therefore leaves a certificate
      // bound to the outgoing key id — which `boundToCurrentIdentity` detects
      // on the very next read, and `advertised` repairs by re-issuing. The
      // property this has is self-healing, not exclusion; nothing here can make
      // it exclusion, and nothing depends on it being exclusion.
      await bounded("e2ee_prekey_state_failed", () =>
        dependencies.prekeyStore.update((current) => {
          if ((current.e2eePrekey?.prekeyId ?? null) !== (previous?.prekeyId ?? null)) {
            return prekeyError("e2ee_prekey_state_failed");
          }
          return {
            ...current,
            revision: current.revision + 1,
            e2eePrekey: record,
            outgoingE2eePrekey:
              previous === null
                ? null
                : { ...previous, retainUntil: createdAt + E2EE_PREKEY_ROTATION_OVERLAP },
            retiringSecretNames:
              displaced === null || displaced.secretName === secretName
                ? current.retiringSecretNames
                : [...current.retiringSecretNames, displaced.secretName],
          };
        }),
      );
      committed = true;
      await drainRetiring(await readPrekeys()).catch(() => undefined);
      return certificateOf(record);
    } finally {
      // Stage three for the failure path: an uncommitted replacement is a key
      // nothing will ever name again.
      if (!committed) {
        await dependencies.agreementIdentity.delete(secretName).catch(() => undefined);
      }
    }
  };

  /**
   * §6.4's forced rotation.
   *
   * Serialized with every other issuing path so an operator command and a
   * concurrent advertisement cannot both stage a replacement.
   */
  const rotate: NodeE2eePrekeyClient["rotate"] = async (rawHubOrigin) => {
    const hubOrigin = canonical(rawHubOrigin);
    return serialize(hubOrigin, () => issue(hubOrigin));
  };

  const ensure: NodeE2eePrekeyClient["ensure"] = async (rawHubOrigin) => {
    const hubOrigin = canonical(rawHubOrigin);
    return serialize(hubOrigin, async () => {
      await sweep().catch(() => undefined);
      const context = await readContext(hubOrigin);
      const record = (await readPrekeys()).e2eePrekey;
      if (
        record !== null &&
        boundToCurrentIdentity(record, context, hubOrigin) &&
        nodeE2eePrekeyValidity(record, now()) === "usable"
      ) {
        const identity = await bounded("e2ee_prekey_custody_failed", () =>
          dependencies.signingIdentity.getPublicDescriptor(context.identitySecretName),
        );
        const certificate = certificateOf(record);
        // The §7.6 reconstruction, run against this node's own certificate. It is
        // the check a client will run, so passing it here is the only evidence
        // worth having that the stored certificate is advertisable at all.
        const verified = verifyNodeE2eeCapabilityCrossSignature({
          hubOrigin,
          nodeId: context.nodeId,
          identityKeyId: context.identityKeyId,
          identityPublicKey: identity.publicKey,
          identityFingerprint: identity.fingerprint,
          prekeyCertificate: {
            ...certificate,
            agreementFingerprint: e2eeKeyFingerprint("agreement", certificate.agreementPublicKey),
          },
        });
        if (verified) return certificate;
      }
      return issue(hubOrigin);
    });
  };

  const advertised: NodeE2eePrekeyClient["advertised"] = async (rawHubOrigin) => {
    const hubOrigin = canonical(rawHubOrigin);
    const context = await readContext(hubOrigin);
    const prekeys = await readPrekeys();
    // §6.4 destroys the displaced key once its overlap ends. Doing it here as
    // well as at startup is what keeps that true on a node that runs for
    // months: this path runs on every new channel, and it is the only one a
    // long-lived node exercises continuously.
    await sweepIfDue(prekeys);
    const record = prekeys.e2eePrekey;
    if (
      record === null ||
      !boundToCurrentIdentity(record, context, hubOrigin) ||
      nodeE2eePrekeyValidity(record, now()) !== "usable"
    ) {
      // Not advertisable as it stands. §6.4's remedy is to re-sign, and the
      // conditions that get here — no certificate, an identity rotation that
      // activated, the renewal window, a clock that moved — are exactly the
      // ones it names. Failing instead would take the node off E2EE until it
      // was restarted, which under effective `requireE2EE` is every channel.
      return ensure(hubOrigin);
    }
    return certificateOf(record);
  };

  const withPrekeySecret: NodeE2eePrekeyClient["withPrekeySecret"] = async (
    rawHubOrigin,
    prekeyId,
    use,
  ) => {
    const hubOrigin = canonical(rawHubOrigin);
    const prekeys = await readPrekeys();
    const active = prekeys.e2eePrekey;
    const outgoing = prekeys.outgoingE2eePrekey;
    const at = now();
    let record: NodeE2eePrekeyState | null = null;
    if (active !== null && active.hubOrigin === hubOrigin && active.prekeyId === prekeyId) {
      record = active;
    } else if (
      outgoing !== null &&
      outgoing.hubOrigin === hubOrigin &&
      outgoing.prekeyId === prekeyId &&
      at <= outgoing.retainUntil
    ) {
      // §6.4's overlap: both certificates verify during the window, each within
      // its own validity period, so the outgoing one is still checked below.
      record = outgoing;
    }
    if (record === null) return prekeyError("e2ee_prekey_not_found");
    if (nodeE2eePrekeyValidity(record, at) === "expired") return prekeyError("e2ee_prekey_expired");
    try {
      return await dependencies.agreementIdentity.withSecretKey(record.secretName, use);
    } catch (error: unknown) {
      // Only the resolution is translated. Anything the borrow itself raised
      // belongs to the caller and is reported unchanged.
      if (error instanceof NodeAgreementIdentityError && error.code === "agreement_key_not_found") {
        return prekeyError("e2ee_prekey_not_found");
      }
      throw error;
    }
  };

  return { ensure, rotate, advertised, withPrekeySecret, sweep };
}

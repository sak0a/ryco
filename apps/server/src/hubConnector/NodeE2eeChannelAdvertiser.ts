import { E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES } from "@ryco/shared/relayE2eeConstants";

import type {
  NodeE2eeAdvertisement,
  NodeE2eeAdvertisementResult,
  NodeE2eeStatementUnavailableReason,
} from "../hubIdentity/NodeE2eeCapabilityStatement.ts";
import type { EffectiveNodeE2eePolicy } from "../hubIdentity/NodeE2eePolicyStore.ts";
import type { RelayChannelSendHandle } from "./RelayChannelRegistry.ts";

// The §5.2 capability advertisement on the node's real relay path —
// docs/relay-e2ee-protocol.md §5.3 (the carrier), §5.4 (carrier sequencing),
// §5.5 (serviceability and the undersized connection), §4.4 rows N15–N17, and
// §12.5's advertisement-unavailable class.
//
// WHAT THIS OWNS: the per-connection §5.5 U1 test, the per-channel choice
// between advertising, suppressing, and FATAL-PRE, and the body of the
// acceptance announcement. It builds no statement and signs nothing — that is
// `NodeE2eeCapabilityStatement`, one level down — and it decides no policy: the
// effective `requireE2EE` it reads is §12.4's, computed once in the policy store.
//
// THE ANNOUNCEMENT BODY IS SYNCHRONOUS, and that is a requirement rather than a
// convenience. It runs on the connection's serialized frame chain, where a `ping`
// waiting behind it is a `pong` the peer's dead-connection timer is not
// receiving, and the registry enforces the bound by taking the channel away from
// an announcement that overruns it. So everything expensive — reading key
// custody, encoding the transcript, signing the §7.2.1 envelope — happens in
// `connectionReady` and `openChannel`, both of which are ahead of the hook, and
// the hook itself is one `send`.

/** §5.5's two unavailability conditions, which are also their §12.5 reason labels. */
export type E2eeAdvertisementUnavailableReason = "undersized-connection" | "statement-unavailable";

/**
 * What a node-local operator surface is told (§5.5, §11.4
 * `e2ee_advertisement_unavailable`).
 *
 * It never reaches the wire: §11.2 keeps the observable behavior of P2 and P23
 * identical to every other pre-key failure, and this is the node-local half of
 * that pair. `assertedMaxDataChunkBytes` and `minimumChunkBytes` are present for
 * U1 exactly because §5.5 requires both figures to be named; `statementFailure`
 * is present for U2 because "this node has no conforming statement" is not
 * actionable without knowing which check failed.
 */
export interface NodeE2eeAdvertisementDiagnostic {
  readonly reason: E2eeAdvertisementUnavailableReason;
  /** True when the channel is FATAL-PRE rather than suppressed (§5.5, §11.2 P2/P23). */
  readonly fatal: boolean;
  readonly assertedMaxDataChunkBytes?: number;
  readonly minimumChunkBytes?: number;
  readonly statementFailure?: NodeE2eeStatementUnavailableReason;
}

/** What this channel does about the advertisement, decided before its accept. */
export type NodeE2eeChannelPlan =
  /** Row N16's complement: emit the carrier at outbound sequence 0 (§5.4). */
  | { readonly kind: "advertise"; readonly advertisement: NodeE2eeAdvertisement }
  /** Row N16: no carrier, one §12.5 advertisement-unavailable occurrence. */
  | { readonly kind: "suppress"; readonly reason: E2eeAdvertisementUnavailableReason }
  /** Row N15: FATAL-PRE under effective `requireE2EE` (§11.2 P2 or P23). */
  | { readonly kind: "fatal"; readonly reason: E2eeAdvertisementUnavailableReason };

export class NodeE2eeAdvertisementFatalError extends Error {
  readonly reason: E2eeAdvertisementUnavailableReason;

  constructor(reason: E2eeAdvertisementUnavailableReason) {
    super("Relay E2EE advertisement is unavailable on this channel.");
    this.name = "NodeE2eeAdvertisementFatalError";
    this.reason = reason;
  }
}

export class NodeE2eeCarrierRefusedError extends Error {
  constructor() {
    super("Relay E2EE capability carrier could not be sent.");
    this.name = "NodeE2eeCarrierRefusedError";
  }
}

export interface NodeE2eeChannelAnnouncement {
  readonly plan: NodeE2eeChannelPlan;
  /**
   * The acceptance-announcement body (§5.4). Synchronous, one `send` at most.
   *
   * Throws for both fatal dispositions — the §5.5 FATAL-PRE and a carrier the
   * send path would not take — because the registry closes a channel whose
   * announcement fails with `channel_rejected`, which is exactly the outer close
   * §11.5 names for every pre-key E2EE-fatal condition. No `E2EEHandshakeReject`
   * accompanies it: §11.5 admits "at most one", the row fires before any peer
   * input has identified the peer as E2EE-capable at all, and a raw negotiation
   * record sent to a legacy client is bytes its JSON parser fails on.
   */
  readonly announce: (send: RelayChannelSendHandle) => void;
}

export interface NodeE2eeChannelAdvertiserSources {
  /** The origin this connector serves. Canonicalized by the statement builder. */
  readonly hubOrigin: string;
  readonly readAdvertisement: (hubOrigin: string) => Promise<NodeE2eeAdvertisementResult>;
  /** §12.4's effective policy, read per channel so a §12.6 commit governs the next one. */
  readonly policy: () => EffectiveNodeE2eePolicy;
  /** §12.5. Never rejects; the returned promise is ignored on this path. */
  readonly recordFallback: (occurrence: {
    readonly hubOrigin: string;
    readonly reason: E2eeAdvertisementUnavailableReason;
  }) => Promise<void>;
  readonly onDiagnostic?: (diagnostic: NodeE2eeAdvertisementDiagnostic) => void;
}

export interface NodeE2eeChannelAdvertiser {
  /**
   * The relay `ready` frame settled this connection's asserted limits.
   *
   * §5.5 U1 is evaluated HERE — once per relay connection, before any channel on
   * it is accepted, and never per carrier — because no conforming carrier can be
   * delivered on an undersized connection and there is nothing channel-specific
   * left to decide. It also starts the statement build, so the first channel's
   * announcement has bytes waiting rather than a signing call to make.
   */
  readonly connectionReady: (input: { readonly maxDataChunkBytes: number }) => void;
  /** Decide one channel's disposition. Called before its `channel.accept`. */
  readonly openChannel: () => Promise<NodeE2eeChannelAnnouncement>;
}

export function makeNodeE2eeChannelAdvertiser(
  sources: NodeE2eeChannelAdvertiserSources,
): NodeE2eeChannelAdvertiser {
  const diagnostic = sources.onDiagnostic ?? (() => undefined);
  /**
   * The current connection's §5.5 U1 verdict.
   *
   * `undefined` means no `ready` has been seen, which the registry makes
   * unreachable — it calls `connectionReady` as it is constructed, and a channel
   * can only be opened through a constructed registry. It is nonetheless treated
   * as undersized rather than assumed away: a node that does not know the
   * asserted limit cannot know its carrier fits.
   */
  let undersized: boolean | undefined;
  let assertedMaxDataChunkBytes: number | undefined;
  /**
   * Diagnostics already surfaced for this connection.
   *
   * §5.5's diagnostic is about a connection and a node configuration, not about
   * a channel, so repeating it once per channel would bury the condition under
   * the traffic it is describing. Cleared by every `connectionReady`, so a
   * reconnect reports the condition again.
   */
  const surfaced = new Set<string>();

  const surface = (value: NodeE2eeAdvertisementDiagnostic): void => {
    const key = `${value.reason}:${value.fatal}:${value.statementFailure ?? ""}`;
    if (surfaced.has(key)) return;
    surfaced.add(key);
    diagnostic(value);
  };

  const connectionReady: NodeE2eeChannelAdvertiser["connectionReady"] = ({ maxDataChunkBytes }) => {
    surfaced.clear();
    assertedMaxDataChunkBytes = maxDataChunkBytes;
    undersized = maxDataChunkBytes < E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES;
    if (undersized) return;
    // Prepared in advance, exactly as the announcement contract requires. Errors
    // are not swallowed into silence — `openChannel` re-reads the same builder
    // and reports whatever it finds — they are simply not this call's to raise:
    // nothing is awaiting it, and a `ready` frame is not the place a signing
    // failure becomes visible.
    void sources.readAdvertisement(sources.hubOrigin).catch(() => undefined);
  };

  const planFor = async (): Promise<NodeE2eeChannelPlan> => {
    // §12.4's effective value: `requireE2EE OR requireApprovedClientE2EE`,
    // computed in the policy store and never re-derived here.
    const requireE2EE = sources.policy().requireE2EE;
    if (undersized !== false) {
      surface({
        reason: "undersized-connection",
        fatal: requireE2EE,
        ...(assertedMaxDataChunkBytes === undefined ? {} : { assertedMaxDataChunkBytes }),
        minimumChunkBytes: E2EE_ADVERTISEMENT_MIN_CHUNK_BYTES,
      });
      return { kind: requireE2EE ? "fatal" : "suppress", reason: "undersized-connection" };
    }
    let result: NodeE2eeAdvertisementResult;
    try {
      result = await sources.readAdvertisement(sources.hubOrigin);
    } catch {
      // The builder reports its own failures as `unavailable`; a throw is a
      // condition it did not classify, and §5.5 U2 is the disposition for every
      // reason this node holds no conforming statement.
      result = { kind: "unavailable", reason: "statement_invalid" };
    }
    if (result.kind === "available") {
      return { kind: "advertise", advertisement: result.advertisement };
    }
    surface({
      reason: "statement-unavailable",
      fatal: requireE2EE,
      statementFailure: result.reason,
    });
    return { kind: requireE2EE ? "fatal" : "suppress", reason: "statement-unavailable" };
  };

  return {
    connectionReady,
    openChannel: async () => {
      const plan = await planFor();
      return {
        plan,
        announce: (send) => {
          switch (plan.kind) {
            case "advertise": {
              // §5.4: through the channel's own send handle, so the carrier takes
              // outbound sequence 0 from the SHARED counter and the chunk
              // prelude is prepended exactly as for any other fitting message.
              // `report` rather than the default `close`, so the refusal takes
              // the §11.5 close reason below instead of the send path's
              // `transfer_limit`/`slow_consumer` vocabulary.
              const result = send(plan.advertisement.carrier, { onRefused: "report" });
              if (!result.accepted) throw new NodeE2eeCarrierRefusedError();
              return;
            }
            case "suppress":
              // §12.5: recorded at `channel.accept`, in the
              // advertisement-unavailable class, whether or not the peer ever
              // speaks legacy — the fact being measured is that THIS NODE could
              // not advertise, and it is already true and complete here. Row N17
              // adds nothing on top and must not add a peer-legacy occurrence.
              //
              // Not awaited, and its failure is absorbed: §12.5 makes the
              // durable write coalesced and best effort, and instrumentation
              // that could reject here would let a full disk fail a channel the
              // node has already decided to serve.
              void sources
                .recordFallback({ hubOrigin: sources.hubOrigin, reason: plan.reason })
                .catch(() => undefined);
              return;
            case "fatal":
              throw new NodeE2eeAdvertisementFatalError(plan.reason);
          }
        },
      };
    },
  };
}

import type { RelayE2eeEnrollmentRevokedFrame } from "@ryco/contracts/relay";
import type { E2eeAccountGrantAuthoritySnapshot } from "@ryco/shared/relayE2eeHandshake";
import type { E2eeTier } from "@ryco/shared/relayE2eeTranscripts";
import type { E2eeSuiteId } from "@ryco/shared/relayE2eeWire";

// The node-local directory of ACTIVE E2EE sessions —
// docs/relay-e2ee-protocol.md §13.5 (the `WebSAS` the node CLI shows "for the
// active session") and §13.6's definition of an active E2EE channel.
//
// WHAT THIS OWNS: nothing durable. It is the one place an operator surface can
// ask "what is established right now, and what advisory code does the node
// compute for it", and it exists because §13.5's comparison is between two
// screens — the web UI's and the node CLI's — and the node half needs a reader.
//
// ─── WHY EVERYTHING HERE IS EPHEMERAL AND WHY THE ENTRIES ARE THIN ──────────
//
// §13.5 is explicit that the `WebSAS` "is ephemeral display state: never logged,
// never persisted, never sent to analytics". This module is in memory, is
// rebuilt from nothing on every start, and is read only by the owner-authenticated
// operator route. Nothing writes it to a file and nothing hands it to a logger.
//
// The entries deliberately carry no channel id, no account id, no fingerprint,
// no key, and no origin. An operator comparing a code needs to know which
// session it belongs to only well enough to tell two concurrent ones apart, and
// a node-local ordinal does that without turning a display surface into a
// correlation surface. `sessionIndex` is a per-process counter and means nothing
// outside the running node.

/** One established E2EE session, as an operator surface may see it. */
export interface NodeE2eeSessionSummary {
  /**
   * A per-process ordinal, assigned in establishment order.
   *
   * NOT a channel id and not derived from one: it exists so an operator can say
   * "the second one" while comparing codes, and carries nothing that identifies
   * the peer, the account, or the relay channel.
   */
  readonly sessionIndex: number;
  /** §8.6 step 4's tier: `native` runs IK and is signed, `web` runs NX. */
  readonly tier: E2eeTier;
  readonly suite: E2eeSuiteId;
  readonly establishedAt: number;
  /**
   * §13.5's advisory per-session code, for a `web` (NX) session only.
   *
   * Absent on `native`, where §13.4's long-term safety number is the
   * owner-facing value and lives on the Branch A record instead. §13.5's
   * derivation is defined over the WEB client's Noise ephemeral and has no IK
   * meaning, so displaying one there would invent a value the client cannot
   * reproduce.
   */
  readonly verificationCode: string | undefined;
}

export interface NodeE2eeSessionDirectory {
  /**
   * Publish one established session; the returned handle retires it.
   *
   * Called at row N3, in the same synchronous turn as the mode flip, and
   * released on every terminal path. Idempotent on release.
   */
  readonly register: (input: {
    readonly tier: E2eeTier;
    readonly suite: E2eeSuiteId;
    readonly establishedAt: number;
    readonly verificationCode?: string | undefined;
    readonly accountGrantAuthority?: E2eeAccountGrantAuthoritySnapshot | undefined;
    readonly terminate?: (() => void | Promise<void>) | undefined;
  }) => () => void;
  /** Established sessions in establishment order. A snapshot; never live state. */
  readonly list: () => readonly NodeE2eeSessionSummary[];
  /** Close every account-enrolled session made stale by an authenticated Hub revocation. */
  readonly revokeEnrollment: (frame: RelayE2eeEnrollmentRevokedFrame) => Promise<number>;
}

export function makeNodeE2eeSessionDirectory(): NodeE2eeSessionDirectory {
  const sessions = new Map<
    number,
    NodeE2eeSessionSummary & {
      readonly accountGrantAuthority?: E2eeAccountGrantAuthoritySnapshot | undefined;
      readonly terminate?: (() => void | Promise<void>) | undefined;
    }
  >();
  let nextIndex = 1;

  return {
    register: (input) => {
      const sessionIndex = nextIndex;
      nextIndex += 1;
      sessions.set(sessionIndex, {
        sessionIndex,
        tier: input.tier,
        suite: input.suite,
        establishedAt: input.establishedAt,
        verificationCode: input.verificationCode,
        accountGrantAuthority: input.accountGrantAuthority,
        terminate: input.terminate,
      });
      return () => {
        sessions.delete(sessionIndex);
      };
    },
    list: () =>
      [...sessions.values()].map(
        ({ accountGrantAuthority: _authority, terminate: _terminate, ...summary }) => summary,
      ),
    revokeEnrollment: async (frame) => {
      const revoked = [...sessions.entries()].filter(([, session]) => {
        const authority = session.accountGrantAuthority;
        return (
          authority !== undefined &&
          authority.enrollmentId === frame.enrollmentId &&
          (authority.accountAuthEpoch < frame.accountAuthEpoch ||
            authority.deviceAuthEpoch < frame.deviceAuthEpoch ||
            authority.enrollmentRevision <= frame.enrollmentRevision)
        );
      });
      await Promise.all(
        revoked.map(async ([sessionIndex, session]) => {
          sessions.delete(sessionIndex);
          await session.terminate?.();
        }),
      );
      return revoked.length;
    },
  };
}

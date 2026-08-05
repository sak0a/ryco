// Every decision and every owner-facing sentence behind revoking a node from
// the hosted directory.
//
// A `.logic.ts` sibling for the reason `HostedRelayTrustNotice.logic.ts` and
// `NodeSecuritySettings.logic.ts` are: a claim that could mislead an owner about
// what an irreversible action did belongs somewhere a node test can read it
// without a DOM, and under a prohibited-phrase scan. Nothing here imports React.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT REVOKING A NODE ACTUALLY DOES, READ OFF THE HUB
// ─────────────────────────────────────────────────────────────────────────────
// `POST /api/admin/nodes/{nodeId}/revoke` runs one Hub-side transaction:
//
//   * `nodes.revoke` is `UPDATE nodes SET revoked_at=… WHERE id=? AND
//     revoked_at IS NULL`, so it is monotonic. Nothing in the Hub's persistence
//     layer ever writes `revoked_at=NULL` back onto a node row.
//   * `authorizedDirectoryEntry` returns `null` for a node with `revokedAt` set,
//     and `/api/nodes` is that function filtered — so the node leaves EVERY
//     authorized account's directory, not only the acting owner's, and cannot
//     come back.
//   * the revocation signal is an in-process bus. Its relay subscriber closes
//     channels the Hub already holds open and drops the node's own socket if one
//     is connected. There is no leg that contacts the machine.
//
// The last point is the whole reason this control exists, and it is also the
// easiest thing to lie about: a node that is offline, unreachable, or gone for
// good is revoked by exactly this call, on exactly this path. Nothing is sent to
// it, nothing on it changes, and it is not asked to agree.

/**
 * One node, as the confirmation must be able to name it.
 *
 * The `id` is carried in full rather than as a prefix. Two nodes enrolled from
 * the same machine, or simply named the same way, are told apart by nothing else
 * the directory renders — and the dialog paints a scrim over the row behind it,
 * so the row cannot be re-read while the confirmation is up.
 */
export interface HostedNodeRevokeSubject {
  readonly id: string;
  readonly label: string;
}

/**
 * The reason code recorded against the revocation.
 *
 * The Hub requires one — its body schema is strict and the field is not optional
 * — and constrains it to `[a-z0-9._-]{1,64}`. It is a fixed value rather than a
 * free-text field the owner fills in: the string lands in the Hub audit trail and
 * in owner inventory, and a prompt for prose at the moment of an irreversible
 * action buys a worse confirmation, not a better record.
 */
export const HOSTED_NODE_REVOKE_REASON_CODE = "owner_revoked";

/** A single line of the consequence list, in the order an owner reads them. */
export interface HostedNodeRevokeConsequence {
  readonly id: "access" | "directory" | "return" | "reach";
  readonly text: string;
}

/**
 * What the owner is agreeing to, in the consequence's own terms.
 *
 * The four lines are the four things that are true, and nothing else is claimed.
 * In particular the last one is written as a positive statement about where the
 * revocation lives rather than as a denial of the things it does not do: the
 * prohibited-phrase scan below is a bare substring match and cannot tell a claim
 * from its negation, so a sentence like "the node is not wiped" would trip it
 * while also planting the idea. The words simply do not appear.
 *
 * "Everyone" in the second line is load-bearing and is not a flourish. This route
 * revokes the NODE; the separate grant route revokes one account's access. An
 * owner who reads this as "I lose my access to it" would be misinformed about a
 * change that reaches every account authorized on that machine.
 */
export const HOSTED_NODE_REVOKE_CONSEQUENCES: ReadonlyArray<HostedNodeRevokeConsequence> =
  Object.freeze([
    Object.freeze({
      id: "access" as const,
      text: "Every grant on this node stops working immediately, for everyone authorized on it — not only for you — and any relay channel it has open right now closes.",
    }),
    Object.freeze({
      id: "directory" as const,
      text: "It leaves this list and stays gone. There is no undo here and no state it can return to.",
    }),
    Object.freeze({
      id: "return" as const,
      text: "Putting that machine back means enrolling it again from scratch, with a new device code and your approval. It is a new enrollment, not a reconnection.",
    }),
    Object.freeze({
      id: "reach" as const,
      text: "All of that is recorded here, on the Hub. A node that is offline, unreachable, or long gone is revoked in exactly the same way — which is the point of doing it from here.",
    }),
  ]);

export interface HostedNodeRevokeConfirmation {
  readonly title: string;
  readonly consequences: ReadonlyArray<HostedNodeRevokeConsequence>;
  /**
   * The line that sends the reader to the identifier below it, because the label
   * alone cannot settle which machine this is about.
   */
  readonly subjectPrompt: string;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly cancelLabel: string;
  /**
   * What the escape says once retrying is no longer a thing that can happen.
   *
   * NOT the same word as `cancelLabel`. "Cancel" over a dialog whose action has
   * already been refused invites the reading that cancelling undoes something,
   * and after an outcome this surface cannot report there is nothing to undo and
   * nothing left to cancel.
   *
   * NOT "Close" either, and that is not a style preference: the dialog primitive
   * already ships an icon control whose accessible name is exactly `Close`, so a
   * second one puts two differently-shaped buttons under one name in one dialog
   * — the same ambiguity a list of identically named rows creates, in the place
   * where it is least affordable. It names the destination instead, which is
   * where both non-retryable messages already send the reader.
   */
  readonly dismissLabel: string;
}

export const HOSTED_NODE_REVOKE_SUBJECT_PROMPT =
  "Check the identifier below against the machine you meant. Two nodes can carry the same name, " +
  "and this is the only value that tells them apart.";

/**
 * The confirmation, with the node written into its title.
 *
 * The title names the label AND the identifier is rendered beside it, because a
 * confirmation over a list of near-identical rows that does not name its target
 * catches an accidental click and nothing else — it cannot catch a click on the
 * wrong row, which is the failure this list is actually shaped to produce.
 *
 * `confirmLabel` does not repeat the neutral verb: an owner scanning two buttons
 * reads the labels rather than the paragraph above them, so the destructive one
 * has to say what it does on its own.
 */
export function hostedNodeRevokeConfirmation(
  subject: HostedNodeRevokeSubject,
): HostedNodeRevokeConfirmation {
  return {
    title: `Revoke ${subject.label}?`,
    consequences: HOSTED_NODE_REVOKE_CONSEQUENCES,
    subjectPrompt: HOSTED_NODE_REVOKE_SUBJECT_PROMPT,
    confirmLabel: "Revoke this node",
    pendingLabel: "Revoking…",
    cancelLabel: "Cancel",
    dismissLabel: "Back to the list",
  };
}

/** The trigger's own copy, which lives on the detail sheet beside Connect. */
export const HOSTED_NODE_REVOKE_ACTION_LABEL = "Revoke";

/**
 * What a failure says about the node's state on the Hub afterwards.
 *
 * `unchanged` — the Hub refused before it changed anything, so the node is still
 * there and the row must keep standing.
 * `already-gone` — the Hub has no un-revoked node under this id. A second revoke
 * lands here, because the update is conditioned on `revoked_at IS NULL`.
 * `unknown` — the request was accepted and the answer could not be read. It is
 * NOT reported as a failure to revoke, because it may well have committed.
 */
export type HostedNodeRevokeOutcome = "unchanged" | "already-gone" | "unknown";

export interface HostedNodeRevokeFailure {
  readonly message: string;
  readonly outcome: HostedNodeRevokeOutcome;
}

/**
 * Whether pressing the same button again is a thing that can still work.
 *
 * Only `unchanged` is retryable, and that is not a styling detail. Re-offering
 * the action after `already-gone` invites an owner to keep pressing a control
 * whose every attempt is the same 404; re-offering it after `unknown` invites a
 * second irreversible write against a node that may have taken the first one.
 * Both are cases where the next useful step is to look at the list, and the
 * dialog is what is standing in front of it.
 */
export function hostedNodeRevokeRetryable(failure: HostedNodeRevokeFailure | null): boolean {
  return failure === null || failure.outcome === "unchanged";
}

/**
 * The Hub's answer, as one bounded sentence and one claim about what happened.
 *
 * KEYED ON THE STATUS FIRST. The `code` on a `HostedHubApiError` is narrowed
 * client-side on some routes and arrives verbatim on others, while the status is
 * whatever the Hub actually answered — and the distinction that matters most
 * here (was anything changed?) is a status distinction. The code is consulted
 * only where the status cannot separate two meanings.
 *
 * NO BRANCH CLAIMS MORE THAN IT KNOWS. The 502 branch is the sharpest case: the
 * client throws `invalid_response` only after a request the Hub accepted, so
 * "nothing was revoked" would be a guess presented as a fact about an
 * irreversible action. It says the outcome is unread and sends the owner to the
 * list, which is the one place the answer actually is.
 *
 * Nor does any branch promise something this surface does not do. A message
 * saying the directory has been re-read is a claim about behaviour, and it is
 * the kind that rots quietly: nothing here re-reads anything.
 */
export function hostedNodeRevokeFailure(cause: unknown): HostedNodeRevokeFailure {
  const status = errorStatus(cause);
  const code = errorCode(cause);

  if (code === "invalid_response") {
    return {
      message:
        "The Hub accepted the request and its answer could not be read, so whether this node was revoked is not known here. Refresh the list and check before trying again.",
      outcome: "unknown",
    };
  }
  if (status === 401 || code === "session_invalid" || code === "csrf_rejected") {
    return {
      message:
        "Your Hub session is no longer valid, so nothing was changed. Sign in and try again.",
      outcome: "unchanged",
    };
  }
  if (status === 403) {
    return {
      message: "Only an owner of this Hub can revoke a node. Nothing was changed.",
      outcome: "unchanged",
    };
  }
  if (status === 404) {
    return {
      message:
        "The Hub has no active node under this identifier: it was already revoked, or it is not this Hub's. Either way there is nothing here left to revoke.",
      outcome: "already-gone",
    };
  }
  if (status === 409) {
    return {
      message:
        "The Hub reported a conflicting change on this node, so nothing was changed. Refresh and look at it again before retrying.",
      outcome: "unchanged",
    };
  }
  if (status === 429) {
    return {
      message:
        "The Hub is refusing further owner changes for now, so nothing was changed. Wait a little and try again.",
      outcome: "unchanged",
    };
  }
  if (status === 0 || code === "timeout" || code === "unavailable") {
    return {
      message:
        "The Hub could not be reached, so nothing was changed. Check your connection and try again.",
      outcome: "unchanged",
    };
  }
  if (status === 400 || code === "invalid_request") {
    return {
      message: "The Hub refused this request, so nothing was changed.",
      outcome: "unchanged",
    };
  }
  return {
    message: "This node could not be revoked. Nothing was changed. Try again in a moment.",
    outcome: "unchanged",
  };
}

/**
 * The status off a `HostedHubApiError`, or `null` for anything else.
 *
 * Read structurally rather than with `instanceof`: the error crosses a package
 * boundary and the surface must not be one duplicated class identity away from
 * reporting every Hub refusal as the generic fallback.
 */
function errorStatus(cause: unknown): number | null {
  if (typeof cause !== "object" || cause === null) return null;
  const { status } = cause as { status?: unknown };
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function errorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  const { code } = cause as { code?: unknown };
  return typeof code === "string" ? code : null;
}

/**
 * Every owner-facing sentence this module produces, flattened for the scan.
 *
 * IT WALKS THE PRODUCERS. Enumerating constants by hand is how a banned phrase
 * ships inside a branch nobody listed — every failure branch above is reached
 * here through `hostedNodeRevokeFailure` with an input that selects it, so a
 * sentence added to one of them is covered without anyone remembering to add it.
 */
export function everyHostedNodeRevokeString(): ReadonlyArray<{
  readonly where: string;
  readonly text: string;
}> {
  const strings: { where: string; text: string }[] = [];
  const push = (where: string, text: string) => {
    strings.push({ where, text });
  };

  const confirmation = hostedNodeRevokeConfirmation({
    id: "node_aaaaaaaaaaaaaaaaaaaaaa",
    label: "Studio",
  });
  push("confirmation.title", confirmation.title);
  push("confirmation.subjectPrompt", confirmation.subjectPrompt);
  push("confirmation.confirmLabel", confirmation.confirmLabel);
  push("confirmation.pendingLabel", confirmation.pendingLabel);
  push("confirmation.cancelLabel", confirmation.cancelLabel);
  push("confirmation.dismissLabel", confirmation.dismissLabel);
  for (const consequence of confirmation.consequences) {
    push(`confirmation.consequence(${consequence.id})`, consequence.text);
  }
  push("actionLabel", HOSTED_NODE_REVOKE_ACTION_LABEL);

  for (const [where, cause] of [
    ["invalidResponse", { code: "invalid_response", status: 502 }],
    ["unauthorized", { code: "session_invalid", status: 401 }],
    ["csrf", { code: "csrf_rejected", status: 403 }],
    ["forbidden", { code: "forbidden", status: 403 }],
    ["notFound", { code: "not_found", status: 404 }],
    ["conflict", { code: "conflict", status: 409 }],
    ["rateLimited", { code: "node_rate_limited", status: 429 }],
    ["offline", { code: "unavailable", status: 0 }],
    ["timeout", { code: "timeout", status: 0 }],
    ["badRequest", { code: "invalid_request", status: 400 }],
    ["unknownShape", new Error("boom")],
  ] as const) {
    push(`failure(${where})`, hostedNodeRevokeFailure(cause).message);
  }
  return strings;
}

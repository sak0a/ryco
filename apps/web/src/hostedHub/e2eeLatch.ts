// docs/relay-e2ee-protocol.md §12.1's WEB latch — the whole of this tier's
// downgrade resistance, and the reason this module imports NOTHING.
//
// §12.1 gives the web latch five MUST NOTs: it "MUST NOT be treated as a
// verified pin, MUST NOT promote any pin state, MUST NOT activate the active-Hub
// guarantee (§2.2, §5.2), MUST NOT persist beyond the application session, and
// MUST NOT satisfy any §13 release gate." Four of those are properties of what
// this module does not hold; the fourth — persistence — is a property of what it
// cannot reach. §6.3 says the same thing from the storage side: web has no
// storage class this material may enter.
//
// THAT IS WHY THE FILE HAS NO IMPORT STATEMENT AT ALL. There is no serializer to
// forget to withhold, no `localStorage`/`sessionStorage`/`indexedDB` handle in
// the module graph, and no export that hands the container out — so "the latch
// is never written anywhere" is a fact about the module rather than a rule an
// implementer has to remember. `e2eeLatch.test.ts` reads this file back and
// asserts exactly that, and the browser suite spies on the three real storage
// APIs across a full session and asserts zero writes.
//
// THE LATCH IS A PRESENCE BIT AND NOT A TRUST RECORD. The separate §5.7 map
// below holds only the greatest policy-generation integer from a statement this
// application session already validated. It is neither a fingerprint nor a
// pin, satisfies no release gate, and has exactly the latch's in-memory lifetime.

/**
 * §12.1's `(hubOrigin, accountId, nodeId)` triple — the in-memory selection a
 * web channel is opened against (§12.1.1, "on web the selection is the in-memory
 * `(hubOrigin, accountId, nodeId)` triple of §12.1").
 *
 * `hubOrigin` is the one client-anchored component (§12.1.1 provenance); the
 * other two are Hub-minted and reissuable at will, which is exactly why the
 * triple can only ever make this tier's classification STRICTER — latched — and
 * never move it into a class that releases anything.
 */
export interface WebE2eeSelection {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
}

type NodesByAccount = Map<string, Set<string>>;
type GenerationsByNode = Map<string, number>;
type GenerationsByAccount = Map<string, GenerationsByNode>;

// The nesting is the representation: each field remains a distinct Map key, so
// no character in a Hub-issued value can be reinterpreted as a tuple boundary.
const latched = new Map<string, NodesByAccount>();
const acceptedPolicyGenerations = new Map<string, GenerationsByAccount>();

function latchedNodes(selection: WebE2eeSelection, create: boolean): Set<string> | undefined {
  let byAccount = latched.get(selection.hubOrigin);
  if (byAccount === undefined && create) {
    byAccount = new Map();
    latched.set(selection.hubOrigin, byAccount);
  }
  let nodes = byAccount?.get(selection.accountId);
  if (nodes === undefined && create && byAccount !== undefined) {
    nodes = new Set();
    byAccount.set(selection.accountId, nodes);
  }
  return nodes;
}

function generationNodes(
  selection: WebE2eeSelection,
  create: boolean,
): GenerationsByNode | undefined {
  let byAccount = acceptedPolicyGenerations.get(selection.hubOrigin);
  if (byAccount === undefined && create) {
    byAccount = new Map();
    acceptedPolicyGenerations.set(selection.hubOrigin, byAccount);
  }
  let nodes = byAccount?.get(selection.accountId);
  if (nodes === undefined && create && byAccount !== undefined) {
    nodes = new Map();
    byAccount.set(selection.accountId, nodes);
  }
  return nodes;
}

/**
 * §12.1's web set condition: the FIRST capability statement this session
 * validates for the triple, "including a self-signed first-contact statement".
 *
 * VALIDATION, NOT HANDSHAKE COMPLETION, and that direction is the whole point:
 * "it is set on statement validation, not on handshake completion, so a Hub that
 * lets the statement validate and then fails the handshake cannot leave the
 * retry channel unlatched." A statement that is valid but UNUSABLE under §5.2
 * step 8, §5.2 step 9, or §8.2 has validated and therefore latches, so such a
 * channel takes K2 (`P15`) rather than K3 and no buffered plaintext is flushed
 * at `T_ADV`. Callers apply that rule; this function is idempotent and has no
 * opinion about how often it is called.
 */
export function latchWebE2eeSelection(selection: WebE2eeSelection): void {
  latchedNodes(selection, true)?.add(selection.nodeId);
}

/**
 * §12.1.1's degenerate web mapping, read at `channel.accept`: "a web selection
 * is **latched** when the §12.1 in-memory latch is set for its
 * `(hubOrigin, accountId, nodeId)` triple in the current application session,
 * and **legacy-eligible** otherwise."
 */
export function isWebE2eeSelectionLatched(selection: WebE2eeSelection): boolean {
  return latchedNodes(selection, false)?.has(selection.nodeId) ?? false;
}

/**
 * §5.7's accepted web policy-generation high-water for this application
 * session. An absent entry means this session has not validated a statement for
 * the selection; it is not represented as generation zero.
 */
export function acceptedWebE2eePolicyGeneration(selection: WebE2eeSelection): number | undefined {
  return generationNodes(selection, false)?.get(selection.nodeId);
}

/**
 * Advance §5.7 after successful statement validation. Lower or repeated
 * generations cannot relax the guard, and unusable-but-valid statements call
 * this just like usable ones.
 */
export function recordWebE2eePolicyGeneration(
  selection: WebE2eeSelection,
  generation: number,
): void {
  const nodes = generationNodes(selection, true);
  const accepted = nodes?.get(selection.nodeId);
  if (accepted === undefined || generation > accepted) {
    nodes?.set(selection.nodeId, generation);
  }
}

/**
 * End the application session's latch and §5.7 high-water state (§12.1: "MUST
 * NOT persist beyond the application session").
 *
 * CALLED ONLY AFTER COMMITTED SIGN-OUT OR SESSION EXPIRY (`e2eeAttempt.ts`,
 * `watchWebHostedSessionForE2ee`). A reversible `signing-out` state does not
 * call it.
 * The node-scoped clearing catalog deliberately does NOT call it — see
 * `environment.ts` — because that catalog runs on every node teardown,
 * including the A→B switch `activateHostedNode` performs. Clearing there would
 * return already-latched selections to `legacy-eligible`, which RELAXES
 * §12.1.1's classification rather than tightening it: a Hub that then withholds
 * the §5.3 carrier past `T_ADV` takes row K13 instead of row K14 and flushes the
 * buffered application sends onto the relay as plaintext, on a selection that
 * had already validated a statement in this same session. `e2eeLatch.test.ts`
 * asserts the latch survives that catalog, so the rule is enforced and not only
 * written here — but this sentence is what a maintainer reads first, so it may
 * not name a caller that must never exist.
 *
 * It is the only mutator besides the setter, and it removes rather than exports.
 */
export function clearWebE2eeLatches(): void {
  latched.clear();
  acceptedPolicyGenerations.clear();
}

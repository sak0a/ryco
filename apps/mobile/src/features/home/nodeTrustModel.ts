/**
 * Wave 4: per-row E2EE trust provenance, derived from the trust store's
 * display-only readers.
 *
 * PURE MODULE. It imports no react and no platform adapter so it can be tested;
 * `useNodeTrust.ts` is the only binding that touches the store.
 *
 * DISPLAY ONLY, AND THE WORD IS LOAD-BEARING. `mobileE2eeTrustStore` documents
 * that "there is no synchronous classification path" — a snapshot accessor
 * feeding a classifier once skipped §13.1's marker reconciliation and answered
 * legacy-eligible where `classify` answers unexpected. Nothing derived here may
 * ever reach a connect, send, retarget or fallback decision; those all go
 * through `classify`, which reconciles first and is async for that reason. This
 * module exists to put a marker on a list row, and that is its whole remit.
 */

/**
 * The mandatory §13.1 label, reused verbatim from client-runtime's
 * `HOSTED_CONNECTION_STATUS_INDICATORS` (the `"Not verified"` key). §12.2
 * requires one vocabulary for the claim across every user-facing surface, so
 * this wave introduces no second phrasing for the same condition — the inbox row
 * says exactly what the hosted connection pill says. `nodeTrustModel.test.ts`
 * pins the string against drift in either direction.
 */
export const NODE_TRUST_UNVERIFIED_LABEL = "Not verified";

export type NodeTrust = "verified" | "unverified";

/**
 * The per-environment trust marker for a roster of Hub nodes.
 *
 * Returns `null` — no claims at all, not a list of "unverified" — when the
 * device marker is `unobtainable`. §4.4 forbids treating unobtainable evidence
 * as an unset marker, and the marker is exactly the guard that rule protects: a
 * direct-only build never hydrates the trust store, so every read is
 * unobtainable, and rendering that as "Not verified" on every row would be a
 * fabricated security claim about nodes this device has no evidence about.
 *
 * A node is `"verified"` only when EXACTLY ONE verified record hints at its
 * node id, mirroring `resolveE2eeTrustRecord`'s ambiguity rule: two records
 * carrying the same Hub-minted id is a state only the Hub can produce, and
 * picking either would let it choose which claim renders. Ambiguity refuses.
 *
 * The false negative is the safe direction and it is reachable: a Hub-inducible
 * re-enrolment mints a new node id, which unmatches a hint on a pin that is
 * still genuinely the owner's. That row then reads "Not verified" until the
 * next authenticated statement re-associates it — an under-claim, which is the
 * only error this surface is allowed to make.
 */
export function deriveNodeTrustByEnvironment(input: {
  readonly markerKind: "set" | "unset" | "unobtainable";
  readonly verifiedRecords: ReadonlyArray<{ readonly nodeIdHints: ReadonlyArray<string> }>;
  readonly rosterNodes: ReadonlyArray<{ readonly environmentId: string; readonly nodeId: string }>;
}): ReadonlyMap<string, NodeTrust> | null {
  if (input.markerKind === "unobtainable") return null;

  const trustByEnvironmentId = new Map<string, NodeTrust>();
  for (const node of input.rosterNodes) {
    const matches = input.verifiedRecords.filter((record) =>
      record.nodeIdHints.includes(node.nodeId),
    );
    trustByEnvironmentId.set(node.environmentId, matches.length === 1 ? "verified" : "unverified");
  }
  return trustByEnvironmentId;
}

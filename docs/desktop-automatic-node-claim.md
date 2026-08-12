# Desktop automatic node claim

## Status and scope

This document defines the local half of the signed native node-claim flow. It lets Ryco Desktop
register the exact backend child it spawned after the owner signs in to a Hub. It replaces the
manual device-code ceremony only for that same-machine child. Headless and remote nodes continue
to use enrollment codes.

The Hub-facing request and response schemas live in `@ryco/contracts/hosted-identity`. The three
local endpoints live in `@ryco/contracts/desktop-native-node-claim`. They are private Desktop-main
control operations, not browser or WebSocket RPC.

## Trust boundary

The trust anchor is the authenticated process-private relationship from
`relay-e2ee-local-introduction-protocol.md` §2: a fresh per-child control secret passed through the
inherited bootstrap pipe, a Desktop-mode backend, and a loopback-only listener and source. The
secret never reaches preload or renderer code.

Hub login authorizes the owner to create the Hub directory record. It does not prove which local
backend holds the node private key. The child therefore generates or resumes its own Ed25519 key,
and only the child signs the Hub claim transcript. Desktop never receives that private key.

## Flow

1. Desktop enables the connector for one canonical Hub origin and asks the exact child for its
   claim descriptor.
2. The child creates one provisional Ed25519 identity in its selected protected secret store, or
   resumes the existing provisional/active identity. It returns only environment metadata and the
   public key/fingerprint.
3. Desktop sends those exact values, its installation id, and the bounded machine metadata to the
   Hub's authenticated native claim-start endpoint.
4. Desktop passes the complete strict claim-start response to the child. The child requires its
   environment id and public-key fingerprint, checks the lifetime, constructs the canonical
   `ryco.native-node-claim.proof.v1` transcript itself, and signs it with the provisional key.
5. Desktop returns only that public signature and the Hub challenge to the authenticated claim
   finish endpoint.
6. The Hub verifies the signature and atomically returns the node id and active node-key id.
7. Desktop passes the strict start and finish envelopes back to the child. The child requires the
   exact environment, fingerprint, label, owner role, node id, and key id before atomically
   promoting the provisional key to its active identity.
8. The child issues its E2EE prekey and authenticates a fresh relay connection. Desktop may then
   perform Local Trusted Introduction; application RPC remains blocked until the subsequent fresh
   E2EE IK channel proves both introduced keys.

## Crash and replay behavior

The provisional private key is owned by the existing pending-identity state slot. A native-claim
kind distinguishes it from a device-code ceremony, while legacy readers still retain and can erase
the key rather than dropping an unknown ownership field. Repeating descriptor preparation returns
the same key. Repeating a completed claim is accepted only when Hub origin, node id, active key id,
environment id, and private-key slot are identical.

No claim response contains a reusable node credential: relay authentication remains a fresh Hub
challenge signed by the committed node identity. A mismatched, expired, widened, or relabeled
result fails closed and leaves the provisional state unpromoted.

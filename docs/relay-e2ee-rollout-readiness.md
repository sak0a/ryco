# Relay E2EE rollout readiness

Status date: 2026-09-04. This is a public gate ledger, not authorization to deploy. It intentionally
contains no account, node, device, fingerprint, credential, infrastructure, or private test data.

## Current decision

The login-only native account-enrollment implementation is complete in the repository: compatible
native clients automatically use it when an authenticated Hub and node advertise current account
grant support. The code is suitable for external review and controlled internal qualification, but
production Hub issuance and broad default deployment are not authorized by this ledger. The
strongest locally approved policy continues to exclude account grants, and suite `0x01`, manual
recovery, Web NX, and compatible cached read-only behavior remain the rollback path.

## Gate ledger

| Gate                               | Status                             | Evidence / remaining action                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frozen install and toolchain       | Passed                             | Bun 1.4.0; `bun install --frozen-lockfile`.                                                                                                                                                                                                                                                                  |
| Repository correctness backstop    | Passed                             | Format check, lint, typecheck, full Vitest suite, and full build.                                                                                                                                                                                                                                            |
| Automatic account E2EE integration | Passed in automation               | A real in-process Hub issuer, client trust resolver, node verifier, Noise channel, and encrypted RPC path prove login enrollment through suite `0x02`, authenticated revocation, reconnect, and verifier-key caching with zero pairing or local-trust registration.                                          |
| Protocol/adversarial/cross-version | Passed in automation               | F19, malicious-relay, relay 1.2/1.3 compatibility, policy migration, revocation, connector restart, statement/prekey rotation, and secret-canary coverage.                                                                                                                                                   |
| Chromium corpus                    | Passed                             | Full browser suite; F1/F2/F3/F7/F8/F10/F14/F16/F17/F19 are wired to committed corpus data.                                                                                                                                                                                                                   |
| Desktop packaging                  | Passed                             | Desktop build completed.                                                                                                                                                                                                                                                                                     |
| iOS simulator                      | Passed, not hardware qualification | Development build installed and launched; simulator key custody does not prove Secure Enclave behavior.                                                                                                                                                                                                      |
| Physical iOS Secure Enclave        | Blocked                            | No reachable disposable physical device in this workspace. Fresh-install/login, automatic enrollment, fail-closed custody, reconnect, and full corpus run remain required.                                                                                                                                   |
| Physical Android StrongBox and TEE | Blocked                            | No Android device/toolchain in this workspace. Both backings and the software-only/unverifiable fail-closed cases remain required.                                                                                                                                                                           |
| Direct Chrome                      | Passed                             | Fresh client pairing reached the application; Security made no owner-only E2EE requests, exposed no Hub-only controls, and showed no opaque Hub error.                                                                                                                                                       |
| Hosted Chrome with a test account  | Blocked                            | No disposable Hub test account/service was available. Account-device listing/revocation and the live Web grant-isolation path remain required.                                                                                                                                                               |
| Two-node zero-touch and lifecycle  | Blocked for live qualification     | The single-node account path, authenticated revocation, and reconnect pass in-process. No disposable live Hub and two test nodes were available for discovery, trust-label UX, independent upgrade, expiry, rotation, account switch, offline read-only, node restart, Hub reconnect, and old-node handling. |
| Latency/stability comparison       | Blocked                            | Requires the same live test topology and a recorded manual-approval baseline. Cold login, warm reconnect, and foreground multi-node burst measurements remain required.                                                                                                                                      |
| Independent security audit         | Blocked                            | The bounded package is prepared in `relay-e2ee-noise-audit-scope.md`; no external engagement or finding closure is represented by repository automation.                                                                                                                                                     |

## Required staged order

1. Enable Hub issuance dark, with no accepting production node path.
2. Enable node shadow validation and compare bounded local diagnostics.
3. Enable internal opt-in admission for disposable accounts and nodes.
4. Enable native-client opt-in after physical-device and live lifecycle gates pass.
5. Enable default account enrollment only after the independent audit closes high-severity findings,
   affected tests are rerun, and latency/stability criteria pass.

At every stage, rollback disables new issuance/admission first, closes account-enrolled leases, and
retains suite `0x01`, locally verified trust, manual recovery, Web NX, and read-only cached state that
was already safe to display. No rollout step may rewrite a local approval or verified pin from a Hub
grant.

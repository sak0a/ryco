# Mobile Simulator passkey preview design

**Status:** Approved

**Date:** 2026-07-27

## Summary

The iOS Simulator cannot create the hardware-backed P-256 key required for a native Ryco Hub
session. The mobile app therefore fails closed before starting the native authorization handoff,
which also prevents developers from exercising the Hub's browser sign-in and cross-device passkey
QR flow.

Development builds will add a clearly labeled browser-only preview action when a Hub profile is
compatible but the native hardware key is unavailable. The action opens the validated Hub profile
origin, which serves the Hub web app, in an ephemeral system-browser authentication session. A
developer can use the Hub's normal
"Sign in with passkey" action and scan the cross-device QR code with a physical iPhone.

The preview never configures the hosted runtime, creates a DPoP signer, redeems a native handoff,
adopts the browser session, persists credentials, opens a relay, or represents the Simulator as
connected. Full native Hub and relay testing still requires a physical device.

## Goals

- Make the existing Hub browser sign-in and passkey QR experience reachable from the mobile app on
  the iOS Simulator.
- Keep the preview easy to discover from the Hub settings state that currently explains hardware
  key unavailability.
- Preserve the production rule: hardware-backed key or no hosted session.
- Keep browser credentials isolated from the React Native HTTP and WebSocket transports.
- Avoid changes to Hub APIs, relay behavior, shared authorization state, or canonical contracts.

## Non-goals

- Creating a software DPoP key for the Simulator.
- Completing a native Hub authorization handoff or establishing a relay session in the Simulator.
- Treating the browser cookie as a native mobile session.
- Adding a general-purpose user-supplied browser URL.
- Changing production or preview-build authentication behavior.

## Considered approaches

### Development-only browser preview (selected)

Open the configured Hub web app in an ephemeral system browser from the unavailable Hub settings
state. This is the smallest change that makes the QR ceremony testable while preserving every native
session invariant.

Tradeoff: it tests browser authentication and QR UX, not native token redemption or relay.

### Physical-device development build

A free Apple Personal Team build can exercise the complete flow because a physical iPhone has a
Secure Enclave. This remains the required end-to-end acceptance path, but it does not solve the
request to test the browser flow in the Simulator.

### Host signing bridge

A development helper could delegate signing to a Mac Secure Enclave key. This would be substantially
more complex, would not model a key bound to the simulated phone, and would add a new privileged
protocol solely for local testing. It is rejected.

### Software-key fallback

A software key would make the Simulator appear capable of a native session, but it would violate the
repository's blocker-class security invariant and create a path that could accidentally ship. It is
rejected.

## User experience

When all of these conditions hold:

1. the app is a development build;
2. a validated Hub profile is configured and compatible;
3. the hosted runtime is unavailable because no hardware-backed key could be created; and
4. the compatible Hub profile has a valid HTTPS origin;

the Hub settings screen shows a secondary action labeled **Preview Hub sign-in** beneath the existing
hardware-key explanation. Supporting copy states that the browser flow can be tested, including a
passkey QR code, but that the Simulator will not connect to Hub nodes.

Tapping the action opens the Hub web app in the system browser. The user chooses the Hub's existing
passkey sign-in action. If the platform offers cross-device authentication, its QR code can be
scanned with a physical iPhone. Dismissing or completing the browser session returns to the app
without changing native account or connection state.

The action does not appear in production or preview builds. If no validated web app URL exists, the
app keeps the current unavailable explanation and offers no preview action.

## URL and browser boundary

The preview URL is derived only from the compatible Hub profile's normalized origin. It is never
accepted directly from a deep link, QR code, arbitrary browser field, Hub response, query
parameter, or fragment. The URL must:

- use HTTPS;
- be the configured Hub origin exactly;
- contain no username, password, path beyond `/`, query, or fragment.

The preview uses `expo-web-browser` with `preferEphemeralSession: true`. It does not provide a
native callback URL, parse a returned URL, or move cookies, CSRF material, authorization codes,
tokens, proofs, or other browser state into native storage.

## State and security behavior

The preview is independent of `hostedHubController.signIn()`. It must not call
`configureHostedRuntime`, `HostedHubApi`, `SessionCredentials`, the DPoP signer, or the relay
factory. Its result is reduced to a bounded completion status used only to clear local button
loading state.

Errors shown in the UI are stable and contain no raw browser result, URL, exception, identifier, or
credential material. Closing the browser is not an error.

The existing fail-closed unavailable state remains authoritative. The app must continue to report
that a native Hub session cannot be created on this device, even if browser authentication succeeds.

## Implementation boundary

- Add a small platform helper that validates and opens the preview session.
- Add a development-only controller hook or local screen action in the Hub settings surface.
- Reuse existing settings components and token-based styling.
- Add focused unit tests for availability, URL validation, browser options, cancellation, and the
  guarantee that no native callback or session-adoption seam exists.
- Keep `packages/client-runtime`, `apps/web`, Hub services, relay code, and native key code unchanged.

## Verification

Automated checks will prove:

- production and preview builds never expose or invoke the preview;
- incompatible, missing, cross-origin, HTTP, credential-bearing, query-bearing, and fragment-bearing
  URLs are rejected;
- the browser opens with an ephemeral session;
- dismissal is bounded and does not publish an error;
- the helper cannot return credential or cookie data to the caller;
- invoking the preview does not change hosted account or session state.

Simulator QA will verify:

1. Hub settings still reports native Hub sign-in as unavailable.
2. **Preview Hub sign-in** opens the configured Hub browser surface.
3. **Sign in with passkey** reaches the platform cross-device passkey UI and displays a QR code.
4. Scanning the QR with a physical iPhone completes browser authentication.
5. Returning to Ryco leaves the native Hub account unavailable and creates no relay connection.

Physical-device QA remains required for native handoff redemption, session restoration, directory
loading, node selection, and relay operation.

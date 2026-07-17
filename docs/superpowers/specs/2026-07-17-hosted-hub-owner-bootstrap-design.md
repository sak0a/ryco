# Hosted Hub first-owner bootstrap design

## Problem

The hosted Hub client exposes passkey sign-in and invitation redemption, but a
new Hub has neither an account that can sign in nor an owner who can issue an
invitation. The Hub already provides credential-gated WebAuthn bootstrap
endpoints, so the missing piece is a hosted-client flow that invokes the
existing contract without weakening its security policy.

## Chosen approach

Add an explicit **Set up first owner** action beside the existing authentication
actions. It opens a focused registration form for the operator-provided
bootstrap credential, display name, and passkey label. The action remains
visible after bootstrap; the server stays authoritative and returns its stable,
generic rejection when bootstrap is unavailable. This avoids adding an
information-revealing availability endpoint or duplicating bootstrap state in
the client.

Alternatives considered were automatic bootstrap discovery and overloading the
invitation form. Discovery would require a new public status contract and could
expose account state. Reusing the invitation action would obscure the distinct
operator credential and make the initial-owner path harder to understand.

## Architecture and data flow

The hosted API adapter adds `bootstrapOwner`, mirroring invitation registration:

1. POST the credential, display name, and passkey label to
   `/api/auth/bootstrap/registration/options`.
2. Use the returned WebAuthn creation options with the existing passkey
   registration adapter.
3. POST the authenticator response to
   `/api/auth/bootstrap/registration/verify`.
4. Parse the existing session response, including one-time recovery codes.

The hosted state controller owns the transition. On success it installs the
account and session, refreshes the directory, and exposes recovery codes through
the existing memory-only recovery-code surface. The form owns the credential
only while it is being entered and clears the input before starting the async
request. It is never placed in a URL, browser storage, diagnostics, or error
text.

## User interface

The unauthenticated surface retains passkey sign-in and invitation redemption
and adds **Set up first owner** as a third explicit action. Invitation and
bootstrap forms share the same interaction structure but use distinct labels
and submit handlers. Back navigation returns to the action chooser, and focus
moves to the first field when a registration form opens.

Bootstrap success uses the existing recovery-code screen. Failure remains on
the form and uses the hosted API's stable bounded error message. No client-side
availability claim is made.

## Security boundaries

This change introduces no endpoint and changes no Hub policy. Requests remain
same-origin and use the existing Origin, Host, WebAuthn RP-ID, cookie, CSRF,
rate-limit, and credential validation enforcement. The client does not add CORS,
persist secrets, inspect bootstrap availability, or log request material.

## Verification

Focused tests cover exact endpoint paths and request bodies, controller state and
recovery-code handling, credential non-retention, authentication-surface
navigation, submission, and focus. Existing hosted-client tests, build checks,
formatting, lint, and type checking must remain green.

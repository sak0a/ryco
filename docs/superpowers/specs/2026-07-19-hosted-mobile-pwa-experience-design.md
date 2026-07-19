# Hosted mobile PWA experience design

**Status:** Approved design

**Date:** 2026-07-19

## Summary

Ryco's hosted web client will become an installable mobile progressive web app without turning the
service worker into a second data plane. PWA behavior is enabled only for production
`hosted-hub` builds. A small custom service worker precaches an explicit set of immutable shell
assets and a static offline document; authenticated requests, relay traffic, application data, and
other dynamic content always remain network-only.

The existing responsive application remains one implementation across phone, tablet, and desktop.
On phones it uses the approved header-and-drawer direction, adapts dialogs and dense work surfaces,
and keeps the composer usable above the software keyboard. Resume and reconnect are fail-closed:
visible data may remain on screen as stale, but hosted mutations stay disabled until the client has
revalidated authorization and synchronized current node state.

The mobile layout direction is approved with deliberately bounded room for interaction polish
during implementation planning. Later refinement may change spacing, animation, and exact control
placement, but it must preserve the navigation hierarchy, accessibility targets, security gates,
cache boundary, and desktop compatibility defined here.

## Goals

- Make a production hosted Ryco build installable from current iOS Safari and Android Chrome.
- Provide understandable installation guidance without requiring installation for browser use.
- Make the installed experience usable at 320 CSS pixels and common phone, tablet, and desktop
  viewports.
- Preserve the existing hosted authorization, relay, readiness, and generation-isolation
  boundaries across backgrounding, offline periods, and resume.
- Provide a useful offline surface without caching user, node, relay, or authenticated content.
- Keep direct-browser, desktop, SSH-assisted, and non-hosted builds behaviorally unchanged.
- Produce bounded automated and physical-device evidence for the install, cache, responsive, and
  resume guarantees.

## Non-goals

- General offline editing, offline conversation history, or cached terminal and file access.
- Background synchronization, background mutation replay, push notifications, or periodic sync.
- A second mobile route, native wrapper, or mobile-specific application fork.
- A broad redesign of the desktop information architecture.
- Changes to relay framing, authentication policy, canonical schemas, or compatibility fixtures.
- Hard-coded deployment URLs, private infrastructure metadata, or operational revisions.
- Automatic tester admission, deployment, or other environment mutation.

## Considered approaches

### Custom allowlisted service worker and targeted responsive refactor (selected)

Generate a small service worker for production hosted builds from the web build's immutable asset
manifest. Adapt the existing shell and work surfaces at narrow widths, while preserving shared
components and state ownership.

This approach makes the cache boundary directly reviewable, avoids a large caching abstraction,
and keeps mobile behavior in the existing application. It requires careful service-worker tests and
focused responsive work, but provides the narrowest security surface.

### Workbox or a PWA plugin with an injected service worker

A plugin can generate manifests and precache lists, handle lifecycle events, and reduce custom
build code. It also adds configuration and generated behavior that must be audited to prove that
dynamic routes never enter a cache. The project does not need runtime caching or background-sync
features, so the added abstraction is not justified for the selected scope.

### Separate mobile shell or route

A dedicated mobile route could optimize phone interactions independently. It would duplicate
navigation, readiness, authorization, and work-surface behavior, create drift between desktop and
mobile, and increase the chance of inconsistent security gates. It is rejected.

## Build-mode boundary

PWA artifacts and registration are active only when the web application is built for production
`hosted-hub` mode. Development, test, direct-browser, desktop, and SSH-assisted modes do not
register the production service worker.

The hosted build emits:

- a standards-compliant web manifest whose `start_url` and `scope` follow the configured public
  base path;
- maskable and conventional icons at the required sizes;
- an explicit theme color, background color, application name, short name, and standalone display
  mode;
- a static offline document containing no deployment, account, project, or node data;
- a generated list of immutable shell assets; and
- a service worker whose source is reviewed in the public repository.

The service worker version and cache name include the immutable public web build revision. Runtime
deployment metadata may expose a compatible Hub, web, and node version tuple for operational
evidence, but the public build does not hard-code private revisions or infrastructure values.

## Installation experience

Installation remains optional. The normal hosted browser experience works without accepting an
installation prompt.

### Chromium installation

The hosted shell captures the `beforeinstallprompt` event in memory and exposes a dismissible
**Install Ryco** action only while the browser reports that installation is eligible. Activating the
action invokes the browser-owned prompt. Ryco records only in-memory UI state around the event; it
does not persist the prompt event or infer that installation succeeded from a click.

The `appinstalled` event and standalone display-mode media query update the UI after installation.
If the browser does not expose the install prompt, a compact help surface provides the browser's
manual Add to Home screen path.

### iOS and iPadOS installation

Because iOS Safari does not expose the Chromium install prompt, an eligible non-standalone Apple
mobile browser receives a short instructional sheet: open the browser menu or share sheet, choose
**Add to Home Screen**, enable **Open as Web App** when offered, and confirm **Add**. The guidance
uses feature and display-mode checks where available and confines platform classification to
instruction selection; it never changes authorization or application behavior.

### Shared behavior

The install action appears in a stable hosted-shell location and may be repeated in settings. It is
not shown as an aggressive automatic modal. Once `display-mode: standalone` is active, with the
legacy iOS standalone flag used only as a compatibility fallback, installation guidance is hidden.

The installation surface includes the concise hosted-relay trust disclosure so installing the app
cannot be mistaken for creating a direct or end-to-end encrypted connection. The same disclosure
is visible in the hosted admission or connection path. Its wording is static, bounded, and contains
no deployment-specific details.

## Service-worker cache contract

The service worker is a shell availability mechanism, not an application-data cache.

### Allowed cache entries

Only these build-produced resources may be written to the Ryco shell cache:

- fingerprinted JavaScript and CSS bundles from the current build manifest;
- fingerprinted fonts and static images referenced by those bundles;
- versioned PWA icons; and
- the dedicated static offline document and its immutable presentation assets.

Every cached URL is present in a generated allowlist. The install handler fails the new worker
installation if its required offline shell cannot be populated, leaving the current worker active.

### Network-only classes

The service worker never writes or serves cached responses for:

- authentication, session, invitation, grant, identity, or credential endpoints;
- API and RPC requests or responses;
- relay, channel, ticket, WebSocket, or event-stream traffic;
- project, file, diff, terminal, conversation, thread, task, or attachment data;
- request methods other than `GET`;
- range requests;
- cross-origin resources; or
- any same-origin URL not present in the generated immutable allowlist.

These exclusions are enforced before any cache lookup. They do not depend solely on response
headers or server behavior.

### Fetch behavior

For an allowlisted immutable asset, the worker serves the exact revision from the current shell
cache. For a document navigation, it attempts the network first and returns the static offline
document only when the network attempt fails. A successful live document response is not copied
into the shell cache.

All other requests pass directly to `fetch` without a cache read or write. A failed dynamic request
remains a failed network request so the application can show its authoritative connection state.

### Cache lifecycle

Cache names use a Ryco-owned prefix plus the immutable web build revision. Activation removes only
older caches with that exact Ryco-owned prefix; it never deletes unrelated origin caches.

A newly installed update waits while an existing client is active. The application displays a
bounded **Update ready** action. User confirmation asks the waiting worker to activate and reloads
only after the controller changes. First installation may activate normally when no older worker
controls a client. An active work session is never reloaded merely because an update was found.

## Responsive application shell

The existing application remains the single route and component tree. Narrow viewports use a
compact top header and navigation drawer, preserving the desktop navigation hierarchy rather than
inventing a parallel mobile taxonomy. The current node or environment selector remains directly
below the header so connection context stays visible.

At narrow widths:

- persistent sidebars become dismissible drawers;
- dialogs and approval surfaces become bottom sheets or full-screen panels according to content
  density;
- master-detail layouts show one primary pane at a time with an explicit back affordance;
- diffs and terminal surfaces remain inside the viewport and use deliberate horizontal scrolling
  where the content itself cannot reflow;
- the composer remains attached to the visible application viewport above the software keyboard;
  and
- transient notices avoid covering primary actions or the composer.

Desktop and tablet behavior remains unchanged unless a shared correction is necessary to remove
overflow or improve accessibility.

### Viewport, safe-area, and keyboard behavior

The shell uses dynamic viewport units and `env(safe-area-inset-*)` values for its primary geometry.
A single viewport adapter may publish bounded CSS custom properties from `VisualViewport` for
software-keyboard compensation where CSS alone is insufficient. Individual components do not add
independent resize listeners.

The layout supports portrait and landscape orientation without requiring a reload. Primary touch
targets are at least 44 by 44 CSS pixels. Browser text scaling must not hide controls or create
unrecoverable horizontal page overflow. Animations honor `prefers-reduced-motion`, and correctness
must not depend on animation completion.

## Hosted resume and mutation gate

The hosted client owns one explicit mutation-readiness gate in addition to its visible connection
state. The gate is false during initial startup, background suspension, offline periods, reconnect,
authorization refresh, node reselection, and shell replay.

When the document becomes hidden or the browser reports loss of network connectivity, the client
marks the current projection stale and disables hosted mutations. Already-rendered content may
remain visible for orientation, but it is labeled stale and read-only.

When the application becomes visible or connectivity returns, the current generation performs this
ordered sequence:

1. restore and validate the current authenticated session;
2. refresh the authorized node directory and selected grant context;
3. establish a relay connection using the normal fresh-ticket path;
4. obtain and accept an authoritative orchestration snapshot or replay point for the selected
   node; and
5. enable mutations only when all preceding state belongs to the current selection generation.

An older callback, timer, service-worker message, or relay generation cannot enable the current
mutation gate. A revocation, expired session, missing grant, or unauthorized node fails closed and
returns the user to the appropriate bounded hosted surface.

## User-visible state model

The UI distinguishes these conditions instead of collapsing them into a generic spinner:

- **Connected:** current authorization and node state are synchronized; allowed mutations are
  enabled.
- **Reconnecting:** the transport or channel is being re-established; content is stale and
  mutations are disabled.
- **Checking access:** session or grant authorization is being revalidated; mutations are
  disabled.
- **Synchronizing:** a current node snapshot or replay is pending; mutations are disabled.
- **Offline:** the browser has no usable network path; only the static offline surface or stale
  read-only application state is available.
- **Queued:** an idempotent, explicitly queueable operation is held by an existing authoritative
  subsystem. PWA support does not create a new browser queue.
- **Delivery unknown:** a non-idempotent action may have crossed the transport boundary before a
  disconnect. It is never replayed automatically.
- **Update ready:** a new immutable shell is installed and waiting for explicit activation.

State copy remains stable and bounded. Raw errors, identifiers, tickets, payloads, request bodies,
or deployment labels are not rendered or persisted for diagnostics.

## Component and ownership outline

Implementation planning may refine file placement, but ownership follows these boundaries:

- build configuration emits the hosted-only manifest, offline document, immutable asset list, and
  service worker;
- one PWA lifecycle module owns registration, update messages, install-prompt custody, standalone
  detection, and teardown;
- the hosted root owns install/update UI and the mutation-readiness projection;
- the application shell owns responsive navigation, safe-area variables, and viewport adaptation;
- existing relay, session, environment, and orchestration runtimes remain authoritative for their
  connection and synchronization states; and
- feature components consume a read-only mutation capability rather than independently guessing
  connectivity from browser events.

The service worker does not import application stores, authentication clients, relay clients, or
node schemas. Communication between it and the page is limited to versioned lifecycle messages
such as update availability and explicit activation.

## Failure handling

- A manifest or icon failure leaves the hosted site browser-usable but fails the corresponding PWA
  build or qualification check.
- A service-worker registration failure is shown as bounded installation unavailability and does
  not prevent normal online hosted use.
- A new worker whose shell precache fails does not replace the current active worker.
- A live navigation failure produces only the static offline document; it never falls back to a
  cached authenticated page.
- A resume validation failure preserves the fail-closed mutation gate and shows the existing stable
  hosted authentication, authorization, or synchronization surface.
- A layout-specific failure must not bypass approvals, hide connection state, or turn an uncertain
  mutation into an apparent success.

## Verification

### Build and unit coverage

Automated tests prove:

- PWA artifacts and registration are emitted only for production `hosted-hub` builds;
- the manifest has valid scope, start URL, standalone display, theme, icons, and maskable icon
  entries;
- the generated precache list contains only immutable approved shell resources;
- each forbidden route class bypasses cache reads and writes;
- navigation is network-first and falls back only to the static offline document;
- activation deletes only obsolete Ryco-owned shell caches;
- updates wait for explicit activation while a controlled client is active;
- install prompting, manual guidance, standalone detection, dismissal, and installed-state changes
  produce the expected UI; and
- background, offline, resume, generation replacement, revocation, and delivery-unknown paths keep
  mutations disabled until current state is authoritative.

At least one browser integration test inspects `CacheStorage` after authenticated hosted activity
and proves that no dynamic or sensitive URL or response was stored.

### Responsive browser coverage

Browser tests exercise at minimum:

- a 320 CSS-pixel phone viewport;
- a representative modern phone viewport;
- portrait and landscape orientation;
- a tablet viewport; and
- the existing desktop viewport.

Coverage includes navigation drawers, node selection, split views, dialogs, approvals, composer
placement, diff and terminal containment, simulated `VisualViewport` keyboard changes, safe-area
variables, text scaling, reduced motion, install guidance, and standalone mode. Tests assert against
document-level overflow and inaccessible primary controls, not only screenshots.

### Physical-device qualification

After the public change is reviewed and consumed by an authorized hosted environment, qualification
uses both a physical iOS device with Safari and a physical Android device with Chrome. Each device
must demonstrate:

1. browser sign-in and hosted connection;
2. visible relay-trust disclosure;
3. installation using the platform's supported path;
4. standalone launch from the home screen;
5. real-node use through the hosted connection;
6. background, foreground, offline, and reconnect behavior;
7. keyboard-safe composer and representative dense work surfaces;
8. fail-closed resume after an authorization change; and
9. a clean update-ready and user-approved activation cycle.

Evidence is bounded to redacted screenshots, test results, device and browser versions, and
compatible immutable revisions. It excludes account names, deployment URLs, node identifiers,
project content, credentials, tickets, proofs, request bodies, and relay payloads.

### Repository gates

The public quality gates are `bun fmt`, `bun lint`, `bun typecheck`, any required Effect typecheck,
`bun run test`, and the production web build. Focused browser tests run in the supported automated
browser environment, while the physical iOS and Android checks remain explicit qualification
requirements.

## Security and compatibility

This design does not relax cookie, Origin, WebAuthn, CSRF, role, grant, relay-ticket, or node
authorization policy. It does not add content persistence to the Hub or browser. Node-owned
projects, files, terminals, conversations, orchestration data, and relay payloads remain
node-owned. Bootstrap material, private keys, session cookies, tickets, proofs, and raw security
identifiers remain outside CacheStorage, local storage, logs, screenshots, and diagnostics.

Service-worker scope is limited to the hosted web application's configured public base. The worker
does not intercept direct-node or desktop modes, and no canonical protocol or schema changes are
required. Desktop and tablet behavior is preserved through shared responsive components and
regression coverage.

## Completion boundary

The public implementation is complete when the hosted production build is installable, the cache
contract and resume gate are proven by automated tests, the responsive acceptance suite passes, all
public repository gates and review are green, and both physical platform qualifications have
bounded redacted evidence. Deployment, operational access changes, and longer-running rollout
qualification remain separately authorized activities.

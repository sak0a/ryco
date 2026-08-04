import {
  deriveHostedConnectionStatusText,
  HOSTED_BROWSER_STATUSES,
  HOSTED_RELAY_TRANSPORT_STATUSES,
  HOSTED_RYCO_SESSION_STATUSES,
  HOSTED_SELECTION_STATUSES,
  type HostedConnectionStatusText,
  type WebHostedConnectionStatusInput,
} from "../src/hostedHub/connectionStatus";

/**
 * Test-side helpers for sweeping the bounded hosted connection vocabulary.
 *
 * Shared rather than copied per suite so a suite cannot quietly cover a subset:
 * every consumer walks the same cross-product, built from the compile-time
 * exhaustive enumerations `connectionStatus.ts` exports.
 *
 * FOUR INPUTS, NOT FIVE, AND DELIBERATELY SO. The derivation's fifth input is
 * the §4.4 channel state, and `apps/web` supplies none: it runs no §4 channel
 * yet, so `deriveHostedConnectionStatusText` takes its documented `unavailable`
 * default and the five statuses that input alone can reach — `Encrypted`,
 * `Browser encrypted`, `Legacy`, `Not verified`, and `Securing` — are outside
 * this sweep rather than skipped by it. These helpers feed BROWSER suites, and
 * a browser suite that rendered a status the shipped app cannot produce would
 * be asserting nothing; they gain the dimension in the same change that gives
 * the web app an `e2eeStatus` to report.
 *
 * That deferral is not the fence, and it was never load-bearing. The fence is
 * `src/hostedHub/connectionStatus.ts`, which narrows the dimension to the states
 * this tier can be in, and `src/hostedHub/connectionStatus.test.ts`, which sweeps
 * all five of them purely and asserts the native rows stay unreachable from here.
 */

/** Every combination of the four bounded inputs. Pure — nothing is rendered. */
export function everyHostedConnectionStatusInput(): ReadonlyArray<WebHostedConnectionStatusInput> {
  const combinations: WebHostedConnectionStatusInput[] = [];
  for (const browserStatus of HOSTED_BROWSER_STATUSES) {
    for (const sessionStatus of HOSTED_RYCO_SESSION_STATUSES) {
      for (const selectionStatus of HOSTED_SELECTION_STATUSES) {
        for (const transportStatus of HOSTED_RELAY_TRANSPORT_STATUSES) {
          combinations.push({ browserStatus, sessionStatus, selectionStatus, transportStatus });
        }
      }
    }
  }
  return combinations;
}

/**
 * One representative input per bounded status, chosen to be adversarial.
 *
 * The cross-product is walked purely — no component is mounted per
 * combination — so a browser suite only has to render the handful of distinct
 * results.
 *
 * Representatives PREFER `transportStatus: "online"` wherever a status is
 * reachable with the transport up. Keeping the first hit instead made the
 * sweep structurally blind to the icon defect: the transport enumeration
 * begins at `idle`, so only `Online`/`online` would ever have been rendered
 * with the transport online, and a green connected glyph beside
 * `Delivery unknown` or `Authorization removed` could never have been observed.
 */
export function hostedConnectionStatusRepresentatives(): ReadonlyMap<
  HostedConnectionStatusText,
  WebHostedConnectionStatusInput
> {
  const representatives = new Map<HostedConnectionStatusText, WebHostedConnectionStatusInput>();
  for (const input of everyHostedConnectionStatusInput()) {
    const text = deriveHostedConnectionStatusText(input);
    const held = representatives.get(text);
    if (held && (held.transportStatus === "online" || input.transportStatus !== "online")) continue;
    representatives.set(text, input);
  }
  return representatives;
}

/**
 * "Connected" restated from the raw inputs in the derivation's gate order —
 * browser lifecycle, then session, then selection, and only then transport.
 *
 * Deliberately independent of `HOSTED_CONNECTION_STATUS_INDICATORS`: it is the
 * second opinion the indicator's glyph is checked against, and it is what
 * fails when the glyph is chosen from `transportStatus` alone.
 */
export function hostedConnectionConnectedByGateOrder(
  value: WebHostedConnectionStatusInput,
): boolean {
  if (value.browserStatus !== "current") return false;
  if (value.sessionStatus === "delivery-unknown") return false;
  if (value.selectionStatus === "authorization-removed") return false;
  if (value.selectionStatus === "revoked") return false;
  if (value.selectionStatus === "incompatible") return false;
  return value.transportStatus === "online" && value.sessionStatus === "ready";
}

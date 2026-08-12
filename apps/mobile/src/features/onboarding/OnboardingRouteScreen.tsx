import { HostedSignIn } from "../hostedHub/HostedSignIn";

/**
 * The "Connect" form sheet. Hosted-plane authentication is the whole surface:
 * direct-node pairing has its own route (`ConnectionsNew`), which the sign-in
 * screen offers as the escape hatch whenever hosted mode is unavailable.
 */
export function OnboardingRouteScreen() {
  return <HostedSignIn />;
}

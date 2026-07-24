import { useEffect, useMemo } from "react";
import * as SplashScreen from "expo-splash-screen";

import { PairingScreen } from "./features/pairing/PairingScreen";
import { AppProviders } from "./providers/AppProviders";
import { initializeMobileRuntime } from "./runtime/bootstrap";

// Keep the native splash up until the app has mounted, then dismiss it — the
// current expo-splash-screen does not auto-hide, so without this the (T3-branded
// placeholder) splash covers the app forever.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// B1 app root: the provider stack, one-time runtime init, and the direct-node
// pairing surface (the B1 deliverable). The full navigation shell and MVP
// screens are B2.
export default function App() {
  const registry = useMemo(() => initializeMobileRuntime(), []);

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <AppProviders>
      <PairingScreen registry={registry} />
    </AppProviders>
  );
}

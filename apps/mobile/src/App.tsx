import { useMemo } from "react";

import { PairingScreen } from "./features/pairing/PairingScreen";
import { AppProviders } from "./providers/AppProviders";
import { initializeMobileRuntime } from "./runtime/bootstrap";

// B1 app root: the provider stack, one-time runtime init, and the direct-node
// pairing surface (the B1 deliverable). The full navigation shell and MVP
// screens are B2.
export default function App() {
  const registry = useMemo(() => initializeMobileRuntime(), []);

  return (
    <AppProviders>
      <PairingScreen registry={registry} />
    </AppProviders>
  );
}

import { PairingScreen } from "../pairing/PairingScreen";
import { useConnectionRegistry } from "../../providers/ConnectionRegistryProvider";

// B2 placeholder for the pair-a-device route. Until Task 6 ships the full
// ConnectionsNew flow (QR + host/code inputs), this keeps B1's working direct-node
// PairingScreen reachable, now sourcing the registry from the app-wide context
// rather than a prop.
export function ConnectionsNewRouteScreen() {
  const registry = useConnectionRegistry();
  return <PairingScreen registry={registry} />;
}

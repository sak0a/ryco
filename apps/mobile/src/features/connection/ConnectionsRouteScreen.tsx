import { NodesScreen } from "../nodes/NodesScreen";

/**
 * Compatibility route for existing deep links and native pushes.
 *
 * Nodes is now a first-class Home mode, so this route renders the same surface
 * instead of maintaining a second environment browser.
 */
export function ConnectionsRouteScreen() {
  return <NodesScreen />;
}

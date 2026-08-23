import { getMobileHostedConnectionCoordinator } from "../connection/hostedConnectionCoordinator";

/**
 * The one mobile actuator for turning a Hub node selection into a bounded
 * connection. Wave 3b moved connection ownership into the coordinator; callers
 * that invoke the package controller directly move only its selection cursor
 * and can leave the node selected but permanently idle.
 */
export function acquireMobileHostedNode(nodeId: string): Promise<void> {
  return getMobileHostedConnectionCoordinator().acquireNode(nodeId);
}

/**
 * A node's verification surface describes its live E2EE channel. Selecting an
 * unverified directory row without first acquiring that exact node opens a
 * dead-end "No connection" screen, because the previously selected node owns
 * the only channel projection the UI can describe.
 *
 * Keep the ordering outside React so every entry point uses the connection
 * coordinator before it navigates to node-scoped security.
 */
export async function acquireBeforeNodeSecurity(input: {
  readonly nodeId: string;
  readonly acquireNode: (nodeId: string) => Promise<void>;
  readonly openSecurity: () => void;
}): Promise<void> {
  await input.acquireNode(input.nodeId);
  input.openSecurity();
}

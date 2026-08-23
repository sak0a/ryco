import type { E2eeTrustClassification } from "../../platform/e2eeTrustModel";

export interface AuthoritativeNodeTrustSource {
  readonly hubOrigin: () => string | null;
  readonly classify: (selection: {
    readonly kind: "node-id-hint";
    readonly hubOrigin: string;
    readonly accountId: string;
    readonly nodeId: string;
  }) => Promise<E2eeTrustClassification>;
  readonly subscribe: (listener: () => void) => () => void;
}

let source: AuthoritativeNodeTrustSource | null = null;
let sourceUnsubscribe: (() => void) | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function publish(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

/** Runtime-owned injection keeps native secure-store modules out of React imports. */
export function configureAuthoritativeNodeTrustSource(
  next: AuthoritativeNodeTrustSource | null,
): void {
  sourceUnsubscribe?.();
  source = next;
  sourceUnsubscribe = next?.subscribe(publish) ?? null;
  publish();
}

export function readAuthoritativeNodeTrustSource(): AuthoritativeNodeTrustSource | null {
  return source;
}

export function subscribeAuthoritativeNodeTrustSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function authoritativeNodeTrustSourceRevision(): number {
  return revision;
}

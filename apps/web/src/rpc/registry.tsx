/**
 * Canonical app-level `@effect/atom-react` registry provider for the RPC layer.
 *
 * The single {@link appAtomRegistry} instance backs both the server-state atoms
 * and the {@link AtomRpcClient} atoms, so they share reactivity and cached
 * results. This module re-exports the registry wiring under the `rpc/registry`
 * name the migration plan refers to while keeping one registry instance.
 */
export {
  AppAtomRegistryProvider,
  appAtomRegistry,
  resetAppAtomRegistryForTests,
} from "./atomRegistry";

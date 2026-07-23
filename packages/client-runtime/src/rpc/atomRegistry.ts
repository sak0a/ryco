import { AtomRegistry } from "effect/unstable/reactivity";

export let appAtomRegistry = AtomRegistry.make();

export function resetAppAtomRegistryForTests() {
  appAtomRegistry.dispose();
  appAtomRegistry = AtomRegistry.make();
}

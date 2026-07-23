import { RegistryContext } from "@effect/atom-react";
import { appAtomRegistry } from "@ryco/client-runtime/rpc";
import type { ReactNode } from "react";

export { appAtomRegistry, resetAppAtomRegistryForTests } from "@ryco/client-runtime/rpc";

export function AppAtomRegistryProvider({ children }: { readonly children: ReactNode }) {
  return <RegistryContext.Provider value={appAtomRegistry}>{children}</RegistryContext.Provider>;
}

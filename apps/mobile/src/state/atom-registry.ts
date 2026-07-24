// B1 homes the single app-level @effect/atom-react registry in
// @ryco/client-runtime/rpc (re-exported by src/rpc/registry.tsx). Upstream's
// screens import `appAtomRegistry` from `../../state/atom-registry`; this shim
// keeps those call sites resolving against B1's single registry rather than
// minting a second one.
export { appAtomRegistry } from "@ryco/client-runtime/rpc";

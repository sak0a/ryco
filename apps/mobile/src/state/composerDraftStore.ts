import {
  createComposerDraftStore,
  type ComposerDraftImage,
  type ComposerDraftStoreState as RuntimeComposerDraftStoreState,
  type ComposerThreadDraftState as RuntimeComposerThreadDraftState,
} from "@ryco/client-runtime/state/composer";

import { mobileKV } from "../platform";

// The composer draft store's logic and Schema migrations live in the runtime;
// this is the mobile binding. The neutral ComposerDraftImage is already
// File-free (previewUrl is a local file:// / data: uri on RN), so it is used
// directly. Storage is the SQLite-backed KV; there is no blob-preview lifecycle
// on RN so revokePreviewUrl is a no-op.
export * from "@ryco/client-runtime/state/composer";

/** On RN the in-memory composer image needs no DOM File — previewUrl is a uri. */
export type MobileComposerImageAttachment = ComposerDraftImage;

export type ComposerThreadDraftState =
  RuntimeComposerThreadDraftState<MobileComposerImageAttachment>;
export type ComposerDraftStoreState = RuntimeComposerDraftStoreState<MobileComposerImageAttachment>;

const mobileComposerStorage = {
  getItem: (name: string) => mobileKV.getItem(name),
  setItem: (name: string, value: string) => mobileKV.setItem(name, value),
  removeItem: (name: string) => mobileKV.removeItem(name),
};

const composerDraftStore = createComposerDraftStore<MobileComposerImageAttachment>({
  storage: mobileComposerStorage,
  flushStorage: () => {},
  revokePreviewUrl: () => {},
  // B1 wires text drafts; persisted image hydration is a B2 concern (no composer
  // image flow ships in B1), so persisted attachments hydrate to no images.
  hydrateImages: () => [],
  readPersistedAttachmentIds: () => [],
});

export const useComposerDraftStore = composerDraftStore.useComposerDraftStore;
export const markPromotedDraftThread = composerDraftStore.markPromotedDraftThread;
export const markPromotedDraftThreadByRef = composerDraftStore.markPromotedDraftThreadByRef;
export const markPromotedDraftThreads = composerDraftStore.markPromotedDraftThreads;
export const markPromotedDraftThreadsByRef = composerDraftStore.markPromotedDraftThreadsByRef;
export const finalizePromotedDraftThreadByRef = composerDraftStore.finalizePromotedDraftThreadByRef;
export const finalizePromotedDraftThreadsByRef =
  composerDraftStore.finalizePromotedDraftThreadsByRef;

import {
  createComposerDraftStore,
  type ComposerDraftStoreState as RuntimeComposerDraftStoreState,
  type ComposerThreadDraftState as RuntimeComposerThreadDraftState,
} from "@ryco/client-runtime/state/composer";

import type { ChatImageAttachment } from "./types";
import {
  composerDebouncedStorage,
  hydrateImagesFromPersisted,
  readPersistedAttachmentIdsFromStorage,
} from "./composerDraftPersistence";

// The composer draft store's logic and Schema migrations live in
// `@ryco/client-runtime/state/composer`. This module is the web binding: it
// fixes the in-memory image type to the DOM-`File`-backed
// `ComposerImageAttachment`, wires the injected storage/lifecycle seams, and
// re-exports the package surface so existing importers keep their specifiers.
export * from "@ryco/client-runtime/state/composer";

/**
 * In-memory composer image on the web: the neutral draft image plus the live
 * DOM `File` and blob-preview URL the UI renders and sends. `File`/`Blob` never
 * cross into the package; the persisted shape stays `{ …, dataUrl }`.
 */
export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}

/** Concrete store state/draft types bound to the web image attachment. */
export type ComposerThreadDraftState = RuntimeComposerThreadDraftState<ComposerImageAttachment>;
export type ComposerDraftStoreState = RuntimeComposerDraftStoreState<ComposerImageAttachment>;

/** Blob-preview lifecycle stays app-side (Decision e). */
function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === "undefined") {
    return;
  }
  if (!previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

const composerDraftStore = createComposerDraftStore<ComposerImageAttachment>({
  storage: composerDebouncedStorage,
  flushStorage: () => composerDebouncedStorage.flush(),
  revokePreviewUrl: revokeObjectPreviewUrl,
  hydrateImages: hydrateImagesFromPersisted,
  readPersistedAttachmentIds: readPersistedAttachmentIdsFromStorage,
});

export const useComposerDraftStore = composerDraftStore.useComposerDraftStore;
export const markPromotedDraftThread = composerDraftStore.markPromotedDraftThread;
export const markPromotedDraftThreadByRef = composerDraftStore.markPromotedDraftThreadByRef;
export const markPromotedDraftThreads = composerDraftStore.markPromotedDraftThreads;
export const markPromotedDraftThreadsByRef = composerDraftStore.markPromotedDraftThreadsByRef;
export const finalizePromotedDraftThreadByRef = composerDraftStore.finalizePromotedDraftThreadByRef;
export const finalizePromotedDraftThreadsByRef =
  composerDraftStore.finalizePromotedDraftThreadsByRef;

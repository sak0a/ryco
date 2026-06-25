import { Context, Effect, Layer, Ref } from "effect";

import {
  BrowserArtifactId,
  type BrowserArtifactKind,
  type BrowserArtifactRef,
  type BrowserProfileId,
  type BrowserSessionId,
  type BrowserTabId,
} from "@ryco/contracts";

interface BrowserArtifactRecord extends BrowserArtifactRef {
  readonly profileId: BrowserProfileId;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
}

export interface BrowserArtifactStoreShape {
  readonly put: (input: {
    readonly kind: BrowserArtifactKind;
    readonly mimeType: string;
    readonly byteSize: number;
    readonly profileId: BrowserProfileId;
    readonly sessionId: BrowserSessionId;
    readonly tabId: BrowserTabId;
    readonly url?: string;
    readonly origin?: string | null;
    readonly retentionMs?: number;
  }) => Effect.Effect<BrowserArtifactRef>;
  readonly get: (artifactId: BrowserArtifactId) => Effect.Effect<BrowserArtifactRecord | null>;
}

export class BrowserArtifactStore extends Context.Service<
  BrowserArtifactStore,
  BrowserArtifactStoreShape
>()("ryco/browser/BrowserArtifactStore") {}

export const BrowserArtifactStoreLive = Layer.effect(
  BrowserArtifactStore,
  Effect.gen(function* () {
    const records = yield* Ref.make(new Map<string, BrowserArtifactRecord>());

    return {
      put: (input) =>
        Effect.gen(function* () {
          const now = new Date();
          const expiresAt = new Date(now.getTime() + (input.retentionMs ?? 24 * 60 * 60 * 1000));
          const ref = {
            artifactId: BrowserArtifactId.make(`browser-artifact:${crypto.randomUUID()}`),
            kind: input.kind,
            mimeType: input.mimeType,
            byteSize: input.byteSize,
            ...(input.url ? { url: input.url } : {}),
            ...(input.origin ? { origin: input.origin } : {}),
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          } satisfies BrowserArtifactRef;
          const record = {
            ...ref,
            profileId: input.profileId,
            sessionId: input.sessionId,
            tabId: input.tabId,
          } satisfies BrowserArtifactRecord;
          yield* Ref.update(records, (current) => {
            const next = new Map(current);
            next.set(ref.artifactId, record);
            return next;
          });
          return ref;
        }),
      get: (artifactId) =>
        Ref.get(records).pipe(Effect.map((current) => current.get(artifactId) ?? null)),
    } satisfies BrowserArtifactStoreShape;
  }),
);

import fs from "node:fs/promises";
import path from "node:path";
import { Context, Effect, Layer, Ref } from "effect";

import {
  BrowserArtifactId,
  type BrowserArtifactKind,
  type BrowserArtifactRef,
  type BrowserProfileId,
  type BrowserSessionId,
  type BrowserTabId,
} from "@ryco/contracts";

import { ServerConfig } from "../config.ts";

interface BrowserArtifactRecord extends BrowserArtifactRef {
  readonly profileId: BrowserProfileId;
  readonly sessionId: BrowserSessionId;
  readonly tabId: BrowserTabId;
  readonly filePath: string;
}

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function artifactExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "application/json":
      return ".json";
    default:
      return ".bin";
  }
}

export interface BrowserArtifactStoreShape {
  readonly put: (input: {
    readonly kind: BrowserArtifactKind;
    readonly mimeType: string;
    readonly data: Uint8Array;
    readonly profileId: BrowserProfileId;
    readonly sessionId: BrowserSessionId;
    readonly tabId: BrowserTabId;
    readonly url?: string;
    readonly origin?: string | null;
    readonly retentionMs?: number;
  }) => Effect.Effect<BrowserArtifactRef, Error>;
  readonly get: (artifactId: BrowserArtifactId) => Effect.Effect<BrowserArtifactRecord | null>;
  readonly readData: (artifactId: BrowserArtifactId) => Effect.Effect<Uint8Array | null, Error>;
}

export class BrowserArtifactStore extends Context.Service<
  BrowserArtifactStore,
  BrowserArtifactStoreShape
>()("ryco/browser/BrowserArtifactStore") {}

export const BrowserArtifactStoreLive = Layer.effect(
  BrowserArtifactStore,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const artifactsDir = path.join(config.stateDir, "browser-artifacts");
    yield* Effect.tryPromise({
      try: () => fs.mkdir(artifactsDir, { recursive: true }),
      catch: (cause) => new Error(String(cause)),
    }).pipe(Effect.orDie);
    const records = yield* Ref.make(new Map<string, BrowserArtifactRecord>());

    return {
      put: (input) =>
        Effect.gen(function* () {
          const now = new Date();
          const expiresAt = new Date(now.getTime() + (input.retentionMs ?? DEFAULT_RETENTION_MS));
          const artifactId = BrowserArtifactId.make(`browser-artifact:${crypto.randomUUID()}`);
          const extension = artifactExtension(input.mimeType);
          const fileName = `${artifactId.replace(/:/g, "-")}${extension}`;
          const filePath = path.join(artifactsDir, fileName);
          yield* Effect.tryPromise({
            try: () => fs.writeFile(filePath, input.data),
            catch: (cause) => new Error(String(cause)),
          });
          const ref = {
            artifactId,
            kind: input.kind,
            mimeType: input.mimeType,
            byteSize: input.data.byteLength,
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
            filePath,
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
      readData: (artifactId) =>
        Effect.gen(function* () {
          const record = yield* Ref.get(records).pipe(
            Effect.map((current) => current.get(artifactId) ?? null),
          );
          if (!record) return null;
          const data = yield* Effect.tryPromise({
            try: () => fs.readFile(record.filePath),
            catch: (cause) => new Error(String(cause)),
          });
          return new Uint8Array(data);
        }),
    } satisfies BrowserArtifactStoreShape;
  }),
);

export const BrowserArtifactStoreLayerLive = BrowserArtifactStoreLive;

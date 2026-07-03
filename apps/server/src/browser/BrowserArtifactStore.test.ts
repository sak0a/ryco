import {
  BrowserArtifactId,
  BrowserProfileId,
  BrowserSessionId,
  BrowserTabId,
} from "@ryco/contracts";
import { Effect, Layer } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { makeTestServerConfig } from "../test/serverConfigFixtures.ts";
import { BrowserArtifactStore, BrowserArtifactStoreLayerLive } from "./BrowserArtifactStore.ts";

function makeStoreLayer(stateDir: string) {
  return BrowserArtifactStoreLayerLive.pipe(
    Layer.provide(
      Layer.succeed(
        ServerConfig,
        makeTestServerConfig({
          stateDir,
          baseDir: stateDir,
        }),
      ),
    ),
  );
}

describe("BrowserArtifactStore", () => {
  it("writes screenshot blobs under app state and tracks metadata", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-browser-artifacts-"));
    try {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* BrowserArtifactStore;
          const ref = yield* store.put({
            kind: "screenshot",
            mimeType: "image/png",
            data: pngBytes,
            profileId: BrowserProfileId.make("browser-profile:test"),
            sessionId: BrowserSessionId.make("browser-session:test"),
            tabId: BrowserTabId.make("browser-tab:test"),
            url: "https://example.test/",
            origin: "https://example.test",
          });
          const record = yield* store.get(ref.artifactId);
          const data = yield* store.readData(ref.artifactId);
          return { ref, record, data };
        }).pipe(Effect.provide(makeStoreLayer(stateDir))),
      );

      expect(result.ref.byteSize).toBe(pngBytes.byteLength);
      expect(result.record?.filePath).toContain("browser-artifacts");
      expect(fs.existsSync(result.record!.filePath)).toBe(true);
      expect(Buffer.from(result.data ?? [])).toEqual(Buffer.from(pngBytes));
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("returns null for unknown artifact ids", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-browser-artifacts-"));
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* BrowserArtifactStore;
          return yield* store.get(BrowserArtifactId.make("browser-artifact:missing"));
        }).pipe(Effect.provide(makeStoreLayer(stateDir))),
      );
      expect(result).toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

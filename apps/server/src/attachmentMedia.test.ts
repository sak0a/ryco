import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { it } from "@effect/vitest";
import { Effect } from "effect";
import sharp from "sharp";
import { describe, expect } from "vite-plus/test";

import {
  probeAttachmentMediaDimensions,
  probeAttachmentMediaDimensionsFromBytes,
  probeAttachmentMediaForServing,
} from "./attachmentMedia.ts";

const buildMp4Box = (type: string, payload: Buffer): Buffer => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
};

const buildTkhdV0 = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(84);
  body.writeUInt32BE(width * 65536, 76);
  body.writeUInt32BE(height * 65536, 80);
  return buildMp4Box("tkhd", body);
};

const buildTkhdV1 = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(96);
  body.writeUInt8(1, 0);
  body.writeUInt32BE(width * 65536, 88);
  body.writeUInt32BE(height * 65536, 92);
  return buildMp4Box("tkhd", body);
};

const buildHdlr = (handlerType: string): Buffer => {
  const body = Buffer.alloc(12);
  body.write(handlerType, 8, "ascii");
  return buildMp4Box("hdlr", body);
};

const buildMp4 = (tracks: ReadonlyArray<Buffer>): Buffer =>
  Buffer.concat([
    buildMp4Box("ftyp", Buffer.from("isom")),
    buildMp4Box("moov", Buffer.concat(tracks.map((track) => buildMp4Box("trak", track)))),
  ]);

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "ryco-attachment-media-"));

describe("attachment media probing", () => {
  it.effect("probes image dimensions from bytes", () =>
    Effect.gen(function* () {
      const pngBytes = yield* Effect.promise(() =>
        sharp({
          create: { width: 2, height: 3, channels: 3, background: "#ff0000" },
        })
          .png()
          .toBuffer(),
      );

      const dimensions = yield* probeAttachmentMediaDimensionsFromBytes(pngBytes, "image/png");
      expect(dimensions).toEqual({ width: 2, height: 3 });
    }),
  );

  it.effect("returns null for corrupt image bytes", () =>
    Effect.gen(function* () {
      const corrupt = yield* probeAttachmentMediaDimensionsFromBytes(
        Buffer.from("not-a-png-at-all"),
        "image/png",
      );
      expect(corrupt).toBeNull();
    }),
  );

  it.effect("probes mp4 dimensions from the video track tkhd", () =>
    Effect.gen(function* () {
      const videoOnly = buildMp4([
        Buffer.concat([buildTkhdV0(320, 240), buildMp4Box("mdia", buildHdlr("vide"))]),
      ]);
      expect(yield* probeAttachmentMediaDimensionsFromBytes(videoOnly, "video/mp4")).toEqual({
        width: 320,
        height: 240,
      });

      const audioFirst = buildMp4([
        Buffer.concat([buildTkhdV0(0, 0), buildMp4Box("mdia", buildHdlr("soun"))]),
        Buffer.concat([buildTkhdV1(1920, 1080), buildMp4Box("mdia", buildHdlr("vide"))]),
      ]);
      expect(yield* probeAttachmentMediaDimensionsFromBytes(audioFirst, "video/mp4")).toEqual({
        width: 1920,
        height: 1080,
      });
    }),
  );

  it.effect("skips audio-only mp4 tracks and non-mp4 video containers", () =>
    Effect.gen(function* () {
      const audioOnly = buildMp4([
        Buffer.concat([buildTkhdV0(0, 0), buildMp4Box("mdia", buildHdlr("soun"))]),
      ]);
      expect(yield* probeAttachmentMediaDimensionsFromBytes(audioOnly, "video/mp4")).toBeNull();

      const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 0x42)]);
      expect(yield* probeAttachmentMediaDimensionsFromBytes(webm, "video/webm")).toBeNull();

      const plainBytes = Buffer.from("plain text");
      expect(yield* probeAttachmentMediaDimensionsFromBytes(plainBytes, "text/plain")).toBeNull();
    }),
  );

  it.effect("returns null for truncated mp4 bytes", () =>
    Effect.gen(function* () {
      const truncated = buildMp4([
        Buffer.concat([buildTkhdV0(320, 240), buildMp4Box("mdia", buildHdlr("vide"))]),
      ]).subarray(0, 24);
      expect(yield* probeAttachmentMediaDimensionsFromBytes(truncated, "video/mp4")).toBeNull();
    }),
  );

  it.effect("probes persisted files and memoizes serving probes per extension", () =>
    Effect.gen(function* () {
      const tempDir = makeTempDir();
      const pngBytes = yield* Effect.promise(() =>
        sharp({
          create: { width: 4, height: 5, channels: 3, background: "#00ff00" },
        })
          .png()
          .toBuffer(),
      );
      const pngPath = path.join(tempDir, "clip.png");
      fs.writeFileSync(pngPath, pngBytes);
      const mp4Path = path.join(tempDir, "clip.mp4");
      fs.writeFileSync(
        mp4Path,
        buildMp4([Buffer.concat([buildTkhdV0(640, 360), buildMp4Box("mdia", buildHdlr("vide"))])]),
      );
      const textPath = path.join(tempDir, "notes.txt");
      fs.writeFileSync(textPath, "abc");
      const missingPath = path.join(tempDir, "missing.png");

      expect(yield* probeAttachmentMediaDimensions(pngPath, "image/png")).toEqual({
        width: 4,
        height: 5,
      });
      expect(yield* probeAttachmentMediaDimensions(mp4Path, "video/mp4")).toEqual({
        width: 640,
        height: 360,
      });
      expect(yield* probeAttachmentMediaDimensions(textPath, "text/plain")).toBeNull();
      expect(yield* probeAttachmentMediaDimensions(missingPath, "image/png")).toBeNull();

      expect(yield* probeAttachmentMediaForServing(pngPath, ".png")).toEqual({
        width: 4,
        height: 5,
      });
      expect(yield* probeAttachmentMediaForServing(pngPath, ".PNG")).toEqual({
        width: 4,
        height: 5,
      });
      expect(yield* probeAttachmentMediaForServing(mp4Path, ".mp4")).toEqual({
        width: 640,
        height: 360,
      });
      expect(yield* probeAttachmentMediaForServing(textPath, ".txt")).toBeNull();
      expect(yield* probeAttachmentMediaForServing(missingPath, ".png")).toBeNull();

      fs.rmSync(tempDir, { recursive: true, force: true });
    }),
  );
});

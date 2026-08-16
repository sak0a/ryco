import { assert, describe, it } from "@effect/vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { measureWebBundle } from "./bundleMeasurement.ts";

describe("external bundle measurement", () => {
  it("counts nested assets with bounded web-delivery compression", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ryco-bundle-measurement-"));
    try {
      const nested = path.join(root, "assets");
      mkdirSync(nested);
      const first = Buffer.from("const answer = 42;\n".repeat(100));
      const second = Buffer.from("body { color: tomato; }\n".repeat(100));
      writeFileSync(path.join(root, "app.js"), first);
      writeFileSync(path.join(nested, "app.css"), second);

      const measured = measureWebBundle(root);
      const brotli = (bytes: Buffer) =>
        zlib.brotliCompressSync(bytes, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        }).byteLength;

      assert.deepStrictEqual(measured, {
        files: 2,
        rawBytes: first.byteLength + second.byteLength,
        gzipBytes: zlib.gzipSync(first).byteLength + zlib.gzipSync(second).byteLength,
        brotliBytes: brotli(first) + brotli(second),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

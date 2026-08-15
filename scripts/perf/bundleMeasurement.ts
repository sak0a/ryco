import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import type { BundleMeasurement } from "./model.ts";

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

export function measureWebBundle(distDir: string): BundleMeasurement {
  if (!statSync(distDir).isDirectory()) throw new Error(`Web dist is not a directory: ${distDir}`);
  const files = filesBelow(distDir);
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  for (const file of files) {
    const bytes = readFileSync(file);
    rawBytes += bytes.byteLength;
    gzipBytes += zlib.gzipSync(bytes).byteLength;
    brotliBytes += zlib.brotliCompressSync(bytes).byteLength;
  }
  return { files: files.length, rawBytes, gzipBytes, brotliBytes };
}

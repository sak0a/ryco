// Source files stay TEXT, so the tools that audit them can read them.
//
// A single raw 0x00 byte anywhere in a file makes ripgrep classify it as binary
// and skip it: `rg -n "Refuse plaintext" apps/web/src` returns nothing for a
// string that is on screen, and `rg -l` prints only "binary file matches". This
// repository's own guidance makes `rg` the first search tool, so a file with one
// of those bytes is invisible to every grep-based review, prohibited-phrase
// sweep, and secret scan that walks source text — silently, with a clean result
// rather than an error.
//
// It shipped that way on the node security panel, which is the file where it
// cost the most: 1,065 lines rendering every owner-facing security sentence,
// none of them reachable by the tooling meant to police them. The separator it
// needed is still U+0000 at runtime; written as the escape `\u0000` the built string is
// byte-identical and the source stays text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const ROOTS = ["apps", "packages", "scripts"] as const;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".turbo",
  ".git",
  "coverage",
  "__screenshots__",
]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    // Fixtures and snapshots can legitimately hold arbitrary bytes; source does
    // not, and these are the trees a reviewer greps.
    yield full;
  }
}

describe("no source file is a binary file to grep", () => {
  it("contains no raw NUL byte in any tracked source tree", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      const absolute = path.join(REPOSITORY_ROOT, root);
      try {
        if (!statSync(absolute).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of sourceFiles(absolute)) {
        if (readFileSync(file).includes(0)) {
          offenders.push(path.relative(REPOSITORY_ROOT, file));
        }
      }
    }
    expect(
      offenders,
      "These files carry a raw 0x00 byte, so ripgrep treats them as binary and skips them. " +
        "Write the separator as the escape `\\u0000` — the runtime string is unchanged and the " +
        "file stays searchable.",
    ).toEqual([]);
  });

  it("can find the security panel's own copy by plain text search", () => {
    // The concrete regression, stated as the thing that was actually lost: a
    // reviewer grepping this tree for a claim could not reach the panel at all.
    const panel = readFileSync(
      path.join(REPOSITORY_ROOT, "apps/web/src/components/settings/NodeSecuritySettings.tsx"),
      "utf8",
    );
    expect(panel).toContain("Reduce to viewer");
    expect(Buffer.from(panel, "utf8").includes(0)).toBe(false);
  });
});

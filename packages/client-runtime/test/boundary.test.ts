import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const runtimeSourceDirectory = new URL("../src/", import.meta.url);
const packageTsconfig = new URL("../tsconfig.json", import.meta.url);

async function runtimeSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(entry.name, directory);
      if (entry.isDirectory()) return runtimeSourceFiles(new URL(`${entry.name}/`, directory));
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [entryUrl] : [];
    }),
  );
  return files.flat();
}

const forbiddenImport =
  /(?:from|import)\s*\(?\s*["'](?:react(?:\/[^"']*)?|react-dom(?:\/[^"']*)?|@effect\/atom-react(?:\/[^"']*)?|@tanstack(?:\/[^"']*)?|node:[^"']+|~(?:\/[^"']*)?)["']/;

describe("@ryco/client-runtime boundary", () => {
  it("keeps platform and app imports out of runtime source", async () => {
    const sources = await Promise.all(
      (await runtimeSourceFiles(runtimeSourceDirectory)).map(async (sourceUrl) => ({
        path: fileURLToPath(sourceUrl),
        source: await readFile(sourceUrl, "utf8"),
      })),
    );

    for (const source of sources) {
      expect(source.source, source.path).not.toMatch(forbiddenImport);
    }
  });

  it("keeps DOM and ambient type packages excluded from the runtime program", async () => {
    const tsconfig = JSON.parse(await readFile(packageTsconfig, "utf8")) as {
      compilerOptions: { lib: string[]; types: string[] };
    };

    expect(tsconfig.compilerOptions.lib).toEqual(["ES2023"]);
    expect(tsconfig.compilerOptions.types).toEqual([]);
  });
});

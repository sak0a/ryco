import { describe, it, expect } from "vitest";
import { hintFromArgv } from "./Layers/ArgvHinter.ts";

describe("ArgvHinter.hintFromArgv", () => {
  const cases: ReadonlyArray<{
    name: string;
    argv: string[];
    expected: { framework: string; isLikelyServer: boolean };
  }> = [
    { name: "vite", argv: ["vite"], expected: { framework: "vite", isLikelyServer: true } },
    {
      name: "next dev",
      argv: ["next", "dev"],
      expected: { framework: "next", isLikelyServer: true },
    },
    {
      name: "nuxt dev",
      argv: ["nuxt", "dev"],
      expected: { framework: "nuxt", isLikelyServer: true },
    },
    {
      name: "astro dev",
      argv: ["astro", "dev"],
      expected: { framework: "astro", isLikelyServer: true },
    },
    {
      name: "remix dev",
      argv: ["remix", "dev"],
      expected: { framework: "remix", isLikelyServer: true },
    },
    {
      name: "wrangler dev",
      argv: ["wrangler", "dev"],
      expected: { framework: "wrangler", isLikelyServer: true },
    },
    {
      name: "vitest --ui",
      argv: ["vitest", "--ui"],
      expected: { framework: "vitest-ui", isLikelyServer: true },
    },
    {
      name: "storybook dev",
      argv: ["storybook", "dev"],
      expected: { framework: "storybook", isLikelyServer: true },
    },
    {
      name: "vite build",
      argv: ["vite", "build"],
      expected: { framework: "vite", isLikelyServer: false },
    },
    {
      name: "vitest run",
      argv: ["vitest", "run"],
      expected: { framework: "unknown", isLikelyServer: false },
    },
    { name: "tsc", argv: ["tsc"], expected: { framework: "unknown", isLikelyServer: false } },
    { name: "eslint", argv: ["eslint"], expected: { framework: "unknown", isLikelyServer: false } },
    {
      name: "unknown serve",
      argv: ["foo", "serve"],
      expected: { framework: "unknown", isLikelyServer: true },
    },
  ];

  for (const c of cases) {
    it(`hints ${c.name}`, () => {
      const got = hintFromArgv(c.argv, undefined);
      expect(got).toEqual(c.expected);
    });
  }

  it("re-scans package.json scripts.dev for indirect invocations", () => {
    const got = hintFromArgv(["npm", "run", "dev"], { scripts: { dev: "vite" } });
    expect(got).toEqual({ framework: "vite", isLikelyServer: true });
  });

  it("treats npm run build as build, not server", () => {
    const got = hintFromArgv(["npm", "run", "build"], { scripts: { build: "vite build" } });
    expect(got).toEqual({ framework: "vite", isLikelyServer: false });
  });

  // Regression tests: prefix-match false positives
  it("does NOT match next for a binary named snextflix", () => {
    const got = hintFromArgv(["snextflix"], undefined);
    expect(got).toEqual({ framework: "unknown", isLikelyServer: false });
  });

  it("does NOT match remix for a binary named myremix", () => {
    const got = hintFromArgv(["myremix"], undefined);
    expect(got).toEqual({ framework: "unknown", isLikelyServer: false });
  });

  it("matches vite when invoked via a full node_modules path", () => {
    const got = hintFromArgv(["./node_modules/.bin/vite"], undefined);
    expect(got).toEqual({ framework: "vite", isLikelyServer: true });
  });
});

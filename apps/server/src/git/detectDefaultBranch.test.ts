import { describe, expect, it, vi } from "vitest";

import { detectDefaultBranch } from "./detectDefaultBranch.ts";

describe("detectDefaultBranch", () => {
  it("returns the trimmed origin/HEAD branch when present", async () => {
    const exec = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") {
        return { stdout: "origin/main\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    });

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("main");
  });

  it("falls back to local main", async () => {
    const exec = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args.includes("--verify") && args.at(-1) === "refs/heads/main") {
        return { stdout: "deadbeef\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    });

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("main");
  });

  it("falls back to master if main is missing", async () => {
    const exec = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args.includes("--verify") && args.at(-1) === "refs/heads/master") {
        return { stdout: "deadbeef\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    });

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("master");
  });

  it("falls back to first listed local branch", async () => {
    const exec = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === "branch" && args.includes("--list")) {
        return { stdout: "feature/x\nfeature/y\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    });

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("feature/x");
  });

  it("continues the fallback chain when a git probe throws", async () => {
    const exec = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === "symbolic-ref") {
        throw new Error("git unavailable for this probe");
      }
      if (args.includes("--verify") && args.at(-1) === "refs/heads/main") {
        return { stdout: "deadbeef\n", exitCode: 0 };
      }
      return { stdout: "", exitCode: 1 };
    });

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("main");
  });

  it("returns 'main' as last resort", async () => {
    const exec = vi.fn(async () => ({ stdout: "", exitCode: 1 }));

    expect(await detectDefaultBranch("/tmp/repo", exec)).toBe("main");
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  ACTIVE_SOURCE_CONTROL_PROJECT_TITLE,
  ACTIVE_SOURCE_CONTROL_REMOTE_URL,
  prepareActiveSourceControlFixture,
} from "./sourceControlFixture.ts";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("active source-control performance fixture", () => {
  it("creates a local-only remote and one deterministic pending push", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ryco-source-control-perf-test-"));
    try {
      let registeredTitle: string | null = null;
      const fixture = prepareActiveSourceControlFixture({
        repoRoot: root,
        home: path.join(root, "home"),
        fixtureRoot: path.join(root, "fixture"),
        registerProject: (value) => {
          registeredTitle = value.projectTitle;
        },
      });

      assert.equal(registeredTitle, ACTIVE_SOURCE_CONTROL_PROJECT_TITLE);
      assert.equal(
        git(fixture.workspaceRoot, ["remote", "get-url", "origin"]),
        ACTIVE_SOURCE_CONTROL_REMOTE_URL,
      );
      assert.match(
        git(fixture.workspaceRoot, ["remote", "get-url", "--push", "origin"]),
        /^file:\/\//,
      );
      git(fixture.workspaceRoot, ["fetch", "origin"]);
      assert.equal(git(fixture.workspaceRoot, ["rev-list", "--count", "origin/main..HEAD"]), "1");
      assert.equal(git(fixture.workspaceRoot, ["status", "--porcelain=v1"]), "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

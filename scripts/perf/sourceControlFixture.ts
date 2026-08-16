import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ACTIVE_SOURCE_CONTROL_PROJECT_TITLE = "External Performance Fixture";
export const ACTIVE_SOURCE_CONTROL_REMOTE_URL =
  "git@github.com:ryco-perf/external-performance-fixture.git";

export interface ActiveSourceControlFixture {
  readonly projectTitle: typeof ACTIVE_SOURCE_CONTROL_PROJECT_TITLE;
  readonly workspaceRoot: string;
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function registerFixtureProject(input: {
  readonly repoRoot: string;
  readonly home: string;
  readonly workspaceRoot: string;
}): void {
  const serverBin = path.join(input.repoRoot, "apps/server/dist/bin.mjs");
  execFileSync(
    process.env.RYCO_PERF_NODE_BINARY || "node",
    [
      serverBin,
      "project",
      "add",
      input.workspaceRoot,
      "--title",
      ACTIVE_SOURCE_CONTROL_PROJECT_TITLE,
      "--base-dir",
      input.home,
    ],
    {
      cwd: input.repoRoot,
      env: { ...process.env, RYCO_HOME: input.home },
      stdio: "ignore",
    },
  );
}

/**
 * Creates a credential-free repository with a public-looking fetch URL and a
 * local bare push URL. The pending commit gives the production UI a real push
 * to perform without network access while preserving GitHub provider detection.
 */
export function prepareActiveSourceControlFixture(input: {
  readonly repoRoot: string;
  readonly home: string;
  readonly fixtureRoot: string;
  readonly registerProject?: (fixture: ActiveSourceControlFixture) => void;
}): ActiveSourceControlFixture {
  const workspaceRoot = path.join(input.fixtureRoot, "workspace");
  const bareRemote = path.join(input.fixtureRoot, "remote.git");
  const localSshTransport = path.join(input.fixtureRoot, "local-ssh-transport.sh");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(bareRemote, { recursive: true });

  writeFileSync(localSshTransport, `#!/bin/sh\nexec git-upload-pack ${shellQuote(bareRemote)}\n`);
  chmodSync(localSshTransport, 0o755);

  git(bareRemote, ["init", "--bare", "--initial-branch=main"]);
  git(workspaceRoot, ["init", "--initial-branch=main"]);
  git(workspaceRoot, ["config", "user.name", "Ryco Performance Fixture"]);
  git(workspaceRoot, ["config", "user.email", "perf-fixture@example.invalid"]);
  git(workspaceRoot, ["config", "commit.gpgsign", "false"]);
  git(workspaceRoot, ["config", "protocol.file.allow", "always"]);
  git(workspaceRoot, ["config", "core.sshCommand", shellQuote(localSshTransport)]);
  git(workspaceRoot, ["remote", "add", "origin", ACTIVE_SOURCE_CONTROL_REMOTE_URL]);
  git(workspaceRoot, ["config", "remote.origin.pushurl", pathToFileURL(bareRemote).href]);

  writeFileSync(path.join(workspaceRoot, "README.md"), "# External performance fixture\n");
  git(workspaceRoot, ["add", "README.md"]);
  git(workspaceRoot, ["commit", "-m", "Initialize performance fixture"]);
  git(workspaceRoot, ["push", "--set-upstream", "origin", "main"]);

  writeFileSync(
    path.join(workspaceRoot, "active-source-control.txt"),
    "Deterministic pending push for the external performance harness.\n",
  );
  git(workspaceRoot, ["add", "active-source-control.txt"]);
  git(workspaceRoot, ["commit", "-m", "Add active source-control workload"]);

  const fixture: ActiveSourceControlFixture = {
    projectTitle: ACTIVE_SOURCE_CONTROL_PROJECT_TITLE,
    workspaceRoot,
  };
  if (input.registerProject) {
    input.registerProject(fixture);
  } else {
    registerFixtureProject({
      repoRoot: input.repoRoot,
      home: input.home,
      workspaceRoot,
    });
  }
  return fixture;
}

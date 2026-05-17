export interface GitHubIssueCreateArgs {
  readonly title: string;
  readonly bodyFile: string;
  readonly labels?: ReadonlyArray<string>;
  readonly assignees?: ReadonlyArray<string>;
}

export function buildGitHubIssueCreateArgv(args: GitHubIssueCreateArgs): ReadonlyArray<string> {
  const argv: string[] = ["issue", "create", "--title", args.title, "--body-file", args.bodyFile];
  for (const label of args.labels ?? []) {
    argv.push("--label", label);
  }
  for (const assignee of args.assignees ?? []) {
    argv.push("--assignee", assignee);
  }
  return argv;
}

const ISSUE_URL_RE = /\/issues\/(\d+)(?:[#?].*)?$/;

export interface ParsedIssueCreateOutput {
  readonly url: string;
  readonly number: number;
}

export function parseGitHubIssueCreateOutput(stdout: string): ParsedIssueCreateOutput | null {
  const url = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!url) return null;
  const match = ISSUE_URL_RE.exec(url);
  const number = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  if (!Number.isFinite(number)) return null;
  return { url, number };
}

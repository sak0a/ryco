import { buildGitHubIssueCreateArgv, parseGitHubIssueCreateOutput } from "./gitHubIssueCreate.ts";
import { describe, expect, it } from "vite-plus/test";

describe("buildGitHubIssueCreateArgv", () => {
  it("emits --title and --body-file", () => {
    expect(
      buildGitHubIssueCreateArgv({
        title: "Bug",
        bodyFile: "/tmp/body.md",
      }),
    ).toEqual(["issue", "create", "--title", "Bug", "--body-file", "/tmp/body.md"]);
  });

  it("emits one --label flag per label", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      labels: ["bug", "frontend"],
    });
    const labelValues = argv
      .map((arg, i) => (argv[i - 1] === "--label" ? arg : null))
      .filter((v): v is string => v !== null);
    expect(labelValues).toEqual(["bug", "frontend"]);
  });

  it("omits --label entirely when labels is empty", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      labels: [],
    });
    expect(argv).not.toContain("--label");
  });

  it("emits one --assignee flag per assignee", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      assignees: ["alice", "bob"],
    });
    const assigneeValues = argv
      .map((arg, i) => (argv[i - 1] === "--assignee" ? arg : null))
      .filter((v): v is string => v !== null);
    expect(assigneeValues).toEqual(["alice", "bob"]);
  });

  it("omits --assignee entirely when assignees is empty", () => {
    const argv = buildGitHubIssueCreateArgv({
      title: "Bug",
      bodyFile: "/tmp/b",
      assignees: [],
    });
    expect(argv).not.toContain("--assignee");
  });
});

describe("parseGitHubIssueCreateOutput", () => {
  it("extracts url and number from the last non-empty line", () => {
    const stdout = "Creating issue in owner/repo\nhttps://github.com/owner/repo/issues/42\n";
    expect(parseGitHubIssueCreateOutput(stdout)).toEqual({
      url: "https://github.com/owner/repo/issues/42",
      number: 42,
    });
  });

  it("returns null on unrecognized output", () => {
    expect(parseGitHubIssueCreateOutput("nope\n")).toBeNull();
  });
});

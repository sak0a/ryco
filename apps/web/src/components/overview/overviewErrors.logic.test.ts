import { assert, describe, it } from "vite-plus/test";

import { classifyOverviewError } from "./overviewErrors.logic";

describe("classifyOverviewError", () => {
  it("returns null when there is no error", () => {
    assert.equal(classifyOverviewError(null), null);
    assert.equal(classifyOverviewError(undefined), null);
    assert.equal(classifyOverviewError(""), null);
    assert.equal(classifyOverviewError("   "), null);
  });

  it("classifies the gh timeout as transient without leaking the command", () => {
    const raw =
      "Source control provider github failed in getChangeRequestDetail: VcsProcessTimeoutError VCS process timed out in GitHubCli.execute: gh pr view 159 --json number,title,url after 30000ms";
    const info = classifyOverviewError(raw);
    assert.equal(info?.kind, "transient");
    assert.equal(info?.message, "Loading pull request details timed out. Try refreshing.");
    // The raw text is preserved for logging but is not the user-facing message.
    assert.equal(info?.raw, raw);
    assert.equal(info?.message.includes("gh pr view"), false);
  });

  it("classifies network failures as transient", () => {
    assert.equal(classifyOverviewError("connect ECONNRESET 140.82.121.4:443")?.kind, "transient");
    assert.equal(classifyOverviewError("getaddrinfo ENOTFOUND api.github.com")?.kind, "transient");
    assert.equal(classifyOverviewError("fetch failed")?.kind, "transient");
  });

  it("classifies rate limiting as transient", () => {
    const info = classifyOverviewError("API rate limit exceeded for user");
    assert.equal(info?.kind, "transient");
    assert.match(info?.message ?? "", /rate limiting/i);
  });

  it("classifies auth and not-found failures as terminal", () => {
    assert.equal(classifyOverviewError("gh auth login required")?.kind, "terminal");
    assert.equal(classifyOverviewError("HTTP 401: Bad credentials")?.kind, "terminal");
    assert.equal(
      classifyOverviewError("Could not resolve to a PullRequest with the number 159.")?.kind,
      "terminal",
    );
  });

  it("treats unrecognized errors as transient with generic copy", () => {
    const info = classifyOverviewError("something totally unexpected happened");
    assert.equal(info?.kind, "transient");
    assert.equal(info?.message, "Couldn't load pull request details. Try refreshing.");
  });

  it("reads the message from Error instances and message-bearing objects", () => {
    assert.equal(classifyOverviewError(new Error("request timed out"))?.kind, "transient");
    assert.equal(classifyOverviewError({ message: "HTTP 401" })?.kind, "terminal");
  });
});

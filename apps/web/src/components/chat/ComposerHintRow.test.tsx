import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerHintRow } from "./ComposerHintRow";

describe("ComposerHintRow", () => {
  it("renders nothing when visible is false", () => {
    const markup = renderToStaticMarkup(
      <ComposerHintRow
        visible={false}
        hasSourceControlRemote
        hasJiraProvider
        onInsertTrigger={() => undefined}
      />,
    );
    expect(markup).toBe("");
  });

  it("renders four pills when both providers are configured", () => {
    const markup = renderToStaticMarkup(
      <ComposerHintRow
        visible
        hasSourceControlRemote
        hasJiraProvider
        onInsertTrigger={() => undefined}
      />,
    );
    expect(markup).toContain("Reference issue");
    expect(markup).toContain("Reference PR");
    expect(markup).toContain("Reference Jira");
    expect(markup).toContain("Browse commands");
  });

  it("hides issue and PR pills when no source-control remote", () => {
    const markup = renderToStaticMarkup(
      <ComposerHintRow
        visible
        hasSourceControlRemote={false}
        hasJiraProvider
        onInsertTrigger={() => undefined}
      />,
    );
    expect(markup).not.toContain("Reference issue");
    expect(markup).not.toContain("Reference PR");
    expect(markup).toContain("Reference Jira");
    expect(markup).toContain("Browse commands");
  });

  it("hides Jira pill when no Jira provider", () => {
    const markup = renderToStaticMarkup(
      <ComposerHintRow
        visible
        hasSourceControlRemote
        hasJiraProvider={false}
        onInsertTrigger={() => undefined}
      />,
    );
    expect(markup).toContain("Reference issue");
    expect(markup).toContain("Reference PR");
    expect(markup).not.toContain("Reference Jira");
    expect(markup).toContain("Browse commands");
  });

  it("attaches the correct aria-label per pill", () => {
    const markup = renderToStaticMarkup(
      <ComposerHintRow
        visible
        hasSourceControlRemote
        hasJiraProvider
        onInsertTrigger={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Reference an issue (inserts #i)"');
    expect(markup).toContain('aria-label="Reference a pull request (inserts #pr)"');
    expect(markup).toContain('aria-label="Reference a Jira ticket (inserts #jira)"');
    expect(markup).toContain('aria-label="Browse slash commands (inserts /)"');
  });
});

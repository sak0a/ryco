import { ProviderDriverKind, ProviderInstanceId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PendingContextHandoffChip } from "./PendingContextHandoffChip";

describe("PendingContextHandoffChip", () => {
  it("renders a non-interactive, accessible, truncation-safe transition", () => {
    const markup = renderToStaticMarkup(
      <PendingContextHandoffChip
        source={{
          providerInstanceId: ProviderInstanceId.make("codex_work"),
          driverKind: ProviderDriverKind.make("codex"),
          providerDisplayName: "Codex Work",
          modelSlug: "gpt-5.6-sol",
          modelDisplayName: "GPT-5.6 Sol",
        }}
        target={{
          providerInstanceId: ProviderInstanceId.make("claude_work"),
          driverKind: ProviderDriverKind.make("claudeAgent"),
          providerDisplayName: "Claude Work",
          modelSlug: "claude-fable-5",
          modelDisplayName: "Fable 5",
        }}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-pending-context-handoff="true"');
    expect(markup).toContain("Next message hands off context");
    expect(markup).toContain(
      "Next message will hand off context from Codex Work GPT-5.6 Sol to Claude Work Fable 5",
    );
    expect(markup).toContain("GPT-5.6 Sol");
    expect(markup).toContain("Fable 5");
    expect(markup).toContain("truncate");
    expect(markup).not.toContain("claude-fable-5</span>");
    expect(markup).not.toContain("<button");
  });
});

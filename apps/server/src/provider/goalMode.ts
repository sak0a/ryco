import type { ThreadGoal } from "@ryco/contracts";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function withProviderGoalPrompt(input: {
  readonly message: string | undefined;
  readonly goal: ThreadGoal | null | undefined;
}): string | undefined {
  if (input.goal?.status !== "active") {
    return input.message;
  }

  const goalContext = `<ryco_goal>
The user has set a persistent goal for this thread. Make concrete progress toward it while handling the current request. Keep the full objective in view across turns and clearly state when it is complete or genuinely blocked.

Objective: ${escapeXml(input.goal.objective)}
</ryco_goal>`;
  return input.message ? `${goalContext}\n\n${input.message}` : goalContext;
}

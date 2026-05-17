export interface HintRowFlags {
  readonly hasSourceControlRemote: boolean;
  readonly hasJiraProvider: boolean;
}

export type HintRowPillId =
  | "reference-issue"
  | "reference-pr"
  | "reference-jira"
  | "browse-commands";

export type HintRowTrigger = "#i " | "#pr " | "#jira " | "/";

export interface HintRowPill {
  readonly id: HintRowPillId;
  readonly label: string;
  readonly trigger: HintRowTrigger;
  readonly ariaLabel: string;
}

const ISSUE_PILL: HintRowPill = {
  id: "reference-issue",
  label: "Reference issue",
  trigger: "#i ",
  ariaLabel: "Reference an issue (inserts #i)",
};
const PR_PILL: HintRowPill = {
  id: "reference-pr",
  label: "Reference PR",
  trigger: "#pr ",
  ariaLabel: "Reference a pull request (inserts #pr)",
};
const JIRA_PILL: HintRowPill = {
  id: "reference-jira",
  label: "Reference Jira",
  trigger: "#jira ",
  ariaLabel: "Reference a Jira ticket (inserts #jira)",
};
const COMMANDS_PILL: HintRowPill = {
  id: "browse-commands",
  label: "Browse commands",
  trigger: "/",
  ariaLabel: "Browse slash commands (inserts /)",
};

export function resolveHintRowPills(flags: HintRowFlags): ReadonlyArray<HintRowPill> {
  const pills: HintRowPill[] = [];
  if (flags.hasSourceControlRemote) {
    pills.push(ISSUE_PILL, PR_PILL);
  }
  if (flags.hasJiraProvider) {
    pills.push(JIRA_PILL);
  }
  pills.push(COMMANDS_PILL);
  return pills;
}

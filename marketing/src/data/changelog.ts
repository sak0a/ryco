export interface ChangelogHighlight {
  title: string;
  summary: string;
}

export interface ChangelogRelease {
  version: string;
  date: string;
  dateTime: string;
  summary: string;
  highlights: ChangelogHighlight[];
  releaseUrl: string;
}

const RELEASE_BASE = "https://github.com/saka-gg/ryco/releases/tag";

/**
 * Editorial summaries of every public Ryco release on GitHub.
 * Keep these focused on user-facing outcomes; the linked release remains the
 * source of truth for the complete pull-request list and install notes.
 */
export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  {
    version: "0.1.9",
    date: "August 29, 2026",
    dateTime: "2026-08-29",
    summary:
      "Ryco grows from a desktop workspace into a secure, cross-device control plane for coding agents.",
    releaseUrl: `${RELEASE_BASE}/v0.1.9`,
    highlights: [
      {
        title: "Ryco goes mobile",
        summary:
          "A native iOS app brings threads, reviews, connections, settings, model controls, and Hub authentication to the phone experience.",
      },
      {
        title: "Secure hosted access",
        summary:
          "Hosted Hub onboarding, relay recovery, node management, passkeys, account security, and end-to-end encrypted channels make remote work safer and more resilient.",
      },
      {
        title: "One runtime across every client",
        summary:
          "The shared client runtime now owns transport, connection supervision, authorization, relay behavior, and core state for web, desktop, and mobile.",
      },
      {
        title: "A calmer way to track work",
        summary:
          "AI Focus ranks the unified inbox while timeline folds, a chat minimap, richer statistics, and subagent observability keep busy workspaces legible.",
      },
      {
        title: "More agents, stronger handoffs",
        summary:
          "Grok joins the provider roster, durable cross-provider handoffs preserve context, and automatic runtime mode keeps sessions aligned with each client.",
      },
    ],
  },
  {
    version: "0.1.8",
    date: "July 11, 2026",
    dateTime: "2026-07-11",
    summary:
      "Search, planning, and pull request preparation move closer to the conversation where the work happens.",
    releaseUrl: `${RELEASE_BASE}/v0.1.8`,
    highlights: [
      {
        title: "Ask before you build",
        summary:
          "Ask mode is available across providers and the composer, giving research and planning turns a clear home before implementation begins.",
      },
      {
        title: "Find any message faster",
        summary:
          "Message search is now part of the command palette, so long-running threads stay easy to navigate.",
      },
      {
        title: "Pull request drafts from real changes",
        summary:
          "A dedicated PR content generator turns the actual change set into a useful GitHub pull request title and description.",
      },
      {
        title: "A public home for Ryco",
        summary:
          "The standalone marketing site launched with real product views, provider details, downloads, and a clearer introduction to the project.",
      },
    ],
  },
  {
    version: "0.1.7",
    date: "July 2, 2026",
    dateTime: "2026-07-02",
    summary:
      "Managed subagents become easier to follow, measure, and control across active projects.",
    releaseUrl: `${RELEASE_BASE}/v0.1.7`,
    highlights: [
      {
        title: "Subagents become first-class work",
        summary:
          "Managed thread orchestration, reliable replay and interrupts, stable codenames, and recognizable avatars make delegated work easier to follow.",
      },
      {
        title: "Workspace statistics arrive",
        summary:
          "New server queries and UI panels expose activity and usage patterns without sending operational data away from Ryco.",
      },
      {
        title: "A more useful overview",
        summary:
          "The overview panel gains a flexible layout system and an interactive design lab for refining the workspace around current work.",
      },
      {
        title: "Provider controls get sharper",
        summary:
          "Claude Fable 5 and ultracode effort are supported, provider update checks can be disabled, and thread rows can be renamed in place.",
      },
    ],
  },
  {
    version: "0.1.6",
    date: "June 17, 2026",
    dateTime: "2026-06-17",
    summary:
      "Subagent activity gets its own workspace while diagnostics make runtime behavior easier to inspect.",
    releaseUrl: `${RELEASE_BASE}/v0.1.6`,
    highlights: [
      {
        title: "Dedicated subagent panels",
        summary:
          "Live subagent streams can open beside the primary conversation, keeping parallel work visible without mixing every update into one timeline.",
      },
      {
        title: "Runtime diagnostics",
        summary:
          "Queue and projection metrics join a dedicated diagnostics settings page for a clearer view of performance under load.",
      },
      {
        title: "Less composer clutter",
        summary:
          "Wide composer labels collapse automatically, while send flow and project settings logic move into clearer shared modules.",
      },
    ],
  },
  {
    version: "0.1.5",
    date: "June 12, 2026",
    dateTime: "2026-06-12",
    summary: "Jira work can now move directly into an isolated coding workspace.",
    releaseUrl: `${RELEASE_BASE}/v0.1.5`,
    highlights: [
      {
        title: "Jira-linked worktrees",
        summary:
          "Create and track a worktree from a Jira work item, keeping the issue, branch, and coding session connected from the start.",
      },
    ],
  },
  {
    version: "0.1.4",
    date: "June 11, 2026",
    dateTime: "2026-06-11",
    summary:
      "The workspace becomes faster, more coherent, and easier to shape around projects and provider instances.",
    releaseUrl: `${RELEASE_BASE}/v0.1.4`,
    highlights: [
      {
        title: "A redesigned workspace overview",
        summary:
          "Chat overview and side panels were recomposed, explorer headers were simplified, and sidebar status language now stays consistent.",
      },
      {
        title: "Projects stay close at hand",
        summary:
          "Local folders join the project sidebar and workflow runs group naturally by pull request or branch.",
      },
      {
        title: "Faster startup under load",
        summary:
          "Runtime load control, refreshed bundling, TypeScript 6 configuration, and updated tests reduce startup work and improve maintainability.",
      },
      {
        title: "More precise appearance and state",
        summary:
          "Surface transparency controls arrive, composer traits are keyed by provider instance, and pull request status refreshes more reliably after push.",
      },
    ],
  },
  {
    version: "0.1.3",
    date: "June 1, 2026",
    dateTime: "2026-06-01",
    summary:
      "Source control moves deeper into the workspace, backed by substantial streaming and rendering performance work.",
    releaseUrl: `${RELEASE_BASE}/v0.1.3`,
    highlights: [
      {
        title: "Issues become ready-to-code worktrees",
        summary:
          "Branch names can be generated from issue metadata, worktrees can start from a chosen base branch, and changed files open directly from the timeline.",
      },
      {
        title: "Smoother live sessions",
        summary:
          "Provider streams, chat updates, and terminal output are coalesced and batched, reducing churn during fast assistant output.",
      },
      {
        title: "GitHub checks inside Ryco",
        summary:
          "Browse Actions status, see pull request checks in source control, and rerun workflows without leaving the project view.",
      },
      {
        title: "Better issue and PR conversations",
        summary:
          "Redesigned detail dialogs support comment posting, quote replies, linked numbers in the chat header, and clearer authorship metadata.",
      },
    ],
  },
  {
    version: "0.1.2",
    date: "May 28, 2026",
    dateTime: "2026-05-28",
    summary:
      "Desktop startup and macOS installation get friendlier while appearance controls gain familiar presets.",
    releaseUrl: `${RELEASE_BASE}/v0.1.2`,
    highlights: [
      {
        title: "A real desktop startup state",
        summary:
          "A lightweight bootstrap shell appears while the backend starts, replacing the empty wait with clear progress.",
      },
      {
        title: "VS Code theme presets",
        summary:
          "Familiar color presets and expanded appearance controls make it faster to tune Ryco to an existing editor setup.",
      },
      {
        title: "Safer unsigned macOS updates",
        summary:
          "Release guidance and installer fallbacks make installation and updates more predictable before notarized builds are available.",
      },
      {
        title: "A cleaner validation pipeline",
        summary:
          "GitHub CI moves to a shared validation workflow and the published server package now includes its own README.",
      },
    ],
  },
  {
    version: "0.1.1",
    date: "May 22, 2026",
    dateTime: "2026-05-22",
    summary:
      "Ryco's first public release establishes the local multi-agent workspace and the workflows around it.",
    releaseUrl: `${RELEASE_BASE}/v0.1.1`,
    highlights: [
      {
        title: "A workspace that feels like yours",
        summary:
          "Custom themes, preferred editor settings, JetBrains support, file previews, diff search, and editor-linked line numbers shape the core workspace.",
      },
      {
        title: "Multiple coding agents, one home",
        summary:
          "Provider settings, GitHub Copilot support, usage visibility, model short names, and reliable early-event handling establish the multi-provider runtime.",
      },
      {
        title: "Source control beyond GitHub",
        summary:
          "GitLab, Bitbucket, Azure DevOps, Forgejo, and Jira context can flow into threads alongside GitHub issues and pull requests.",
      },
      {
        title: "Worktrees built into the conversation",
        summary:
          "Fresh worktrees, staged attachments, terminal tabs, issue creation, project avatars, and safe branch cleanup bring everyday repository work into chat.",
      },
      {
        title: "Extensible from day one",
        summary:
          "MCP server management, provider MCP settings, plugins, skill mentions, interactive keybindings, and faster startup create room for different workflows.",
      },
    ],
  },
];

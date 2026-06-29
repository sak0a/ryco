/**
 * Single source of truth for every marketing version.
 * All copy is grounded in the real Ryco README / AGENTS.md so the five art
 * directions stay factually consistent while looking nothing alike.
 */

export const SITE = {
  name: "Ryco",
  tagline: "A fast local workspace for coding agents.",
  oneLiner:
    "Run Codex, Claude, GitHub Copilot, OpenCode and Cursor side by side — fast local workflows, per-provider control, and full visibility into what each agent does.",
  longDescription:
    "Ryco is a small, practical workspace for AI coding agents. It ships as a cross-platform desktop app and a local web CLI backed by an Effect/TypeScript server and a React/TanStack UI.",
  repo: "https://github.com/sak0a/ryco",
  releases: "https://github.com/sak0a/ryco/releases",
  discord: "https://discord.gg/jn4EGJjrvv",
  npx: "npx ryco-cli",
  license: "MIT",
  company: "Ryco Inc.",
  status: "Early access · expect rough edges",
  maintainer: { name: "sak0a", url: "https://saka.at" },
} as const;

export interface Provider {
  id: string;
  name: string;
  vendor: string;
  brand: string; // key into brand icon registry
  accent: string; // hex
  blurb: string;
  detail: string;
  earlyAccess?: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    brand: "openai",
    accent: "#10a37f",
    blurb: "via the Codex app-server",
    detail: "JSON-RPC over stdio, with live usage windows surfaced in the UI.",
  },
  {
    id: "claude",
    name: "Claude",
    vendor: "Anthropic",
    brand: "anthropic",
    accent: "#d97757",
    blurb: "via the Claude Agent SDK",
    detail: "Full Agent SDK integration including usage windows when available.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    vendor: "GitHub",
    brand: "copilot",
    accent: "#a371f7",
    blurb: "via @github/copilot-sdk",
    detail: "First-party driver wired straight into the Copilot SDK.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "OpenCode",
    brand: "opencode",
    accent: "#fab283",
    blurb: "via @opencode-ai/sdk",
    detail: "Use the bundled SDK or point Ryco at your own OpenCode server URL.",
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Cursor",
    brand: "cursor",
    accent: "#e4e4e7",
    blurb: "via the Cursor Agent ACP runtime",
    detail: "Agent Client Protocol driver, sharing Ryco's Effect-based ACP helpers.",
    earlyAccess: true,
  },
];

/** Model providers / routing surfaced through named provider instances. */
export const MODEL_PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "GitHub",
  "OpenCode",
  "Cursor",
  "OpenRouter",
] as const;

export interface Platform {
  id: "macos" | "linux" | "windows";
  name: string;
  brand: string;
  format: string;
  arch: string;
  install: string;
}

export const PLATFORMS: Platform[] = [
  {
    id: "macos",
    name: "macOS",
    brand: "apple",
    format: ".dmg",
    arch: "arm64 · x64",
    install: "Run Install Ryco.command from the DMG",
  },
  {
    id: "linux",
    name: "Linux",
    brand: "linux",
    format: ".AppImage",
    arch: "x64",
    install: "yay -S ryco-bin  (AUR)",
  },
  {
    id: "windows",
    name: "Windows",
    brand: "windows",
    format: ".exe",
    arch: "x64 · NSIS",
    install: "Download the installer from Releases",
  },
];

export interface Feature {
  id: string;
  title: string;
  blurb: string;
  icon: string; // lucide-react icon name
  group: "agents" | "workflow" | "ui" | "infra";
}

export const FEATURES: Feature[] = [
  {
    id: "multi-agent",
    title: "Every agent, side by side",
    blurb:
      "Codex, Claude, Copilot, OpenCode and Cursor run together — switch providers per thread without losing context.",
    icon: "LayoutGrid",
    group: "agents",
  },
  {
    id: "instances",
    title: "Named provider instances",
    blurb:
      "Run codex_personal and claude_openrouter at once — independent config, env vars, auth identity, models and accent colors.",
    icon: "Boxes",
    group: "agents",
  },
  {
    id: "worktrees",
    title: "Git worktree management",
    blurb:
      "Create and track worktrees per branch, PR, issue or Jira item, bucketed by status: idle, in progress, review, done.",
    icon: "GitBranch",
    group: "workflow",
  },
  {
    id: "terminals",
    title: "Multi-terminal drawer",
    blurb:
      "Split terminals, custom tabs and clickable file & path links — the chat bar reflects open / closed state.",
    icon: "TerminalSquare",
    group: "workflow",
  },
  {
    id: "composer",
    title: "Composer attachments",
    blurb:
      "Attach GitHub, GitLab, Forgejo, Bitbucket or Azure DevOps issues and PRs as structured context with a # trigger.",
    icon: "Paperclip",
    group: "workflow",
  },
  {
    id: "diff",
    title: "Diff panel → editor",
    blurb:
      "Fast occurrence search inside large changes; click any diff line to open your editor at the exact file and line.",
    icon: "FileDiff",
    group: "workflow",
  },
  {
    id: "themes",
    title: "Custom themes",
    blurb:
      "A full theme editor with live preview, import / export and a reusable color-picker component.",
    icon: "Palette",
    group: "ui",
  },
  {
    id: "palette",
    title: "Command palette",
    blurb: "Searchable commands with thread and model jump bindings on ⌘K.",
    icon: "Command",
    group: "ui",
  },
  {
    id: "keybindings",
    title: "Customizable keybindings",
    blurb:
      "Rebind terminal toggle, diff toggle, new chat, script execution and more to fit your hands.",
    icon: "Keyboard",
    group: "ui",
  },
  {
    id: "mcp",
    title: "MCP server support",
    blurb: "Model Context Protocol built in, with workspace-level configuration.",
    icon: "Plug",
    group: "infra",
  },
  {
    id: "scm",
    title: "Source-control providers",
    blurb:
      "GitHub, GitLab, Forgejo / Codeberg, Azure DevOps, Bitbucket, plus Jira project & work-item workflows.",
    icon: "GitPullRequest",
    group: "infra",
  },
  {
    id: "remote",
    title: "Remote environments",
    blurb:
      "Saved HTTP / WebSocket environments, pairing links, SSH utilities and Tailscale endpoint / Serve helpers.",
    icon: "Radio",
    group: "infra",
  },
  {
    id: "updates",
    title: "Auto-updates",
    blurb: "electron-updater with in-app update notifications surfaced in the sidebar.",
    icon: "RefreshCw",
    group: "infra",
  },
  {
    id: "observability",
    title: "Observability built in",
    blurb: "Local trace files, provider event logs and optional OTLP trace / metric export.",
    icon: "Activity",
    group: "infra",
  },
];

/**
 * The 14 features above, grouped into six themed buckets for the v4 toolkit grid
 * (each rendered with its own always-on animated icon). Still factually grounded
 * in the real product — every original feature is folded into one of these.
 */
export interface FeatureGroup {
  id: "agents" | "worktrees" | "terminal" | "command" | "themes" | "infra";
  title: string;
  blurb: string;
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "agents",
    title: "Every agent, side by side",
    blurb:
      "Codex, Claude, Copilot, OpenCode and Cursor run together — switch per thread, and run named instances like codex_personal and claude_openrouter at once, each with its own config and models.",
  },
  {
    id: "worktrees",
    title: "Worktrees for every branch",
    blurb:
      "Track git worktrees per branch, PR, issue or Jira item, bucketed by status — and attach those issues and PRs as structured context with a # trigger.",
  },
  {
    id: "terminal",
    title: "Terminals, diffs & your editor",
    blurb:
      "Split terminals with clickable file links, search inside large diffs, and click any diff line to open your editor at the exact file and line.",
  },
  {
    id: "command",
    title: "Everything on ⌘K",
    blurb:
      "A command palette with thread and model jumps and slash commands — plus rebindable shortcuts for terminal, diff, new chat and script execution.",
  },
  {
    id: "themes",
    title: "Make it unmistakably yours",
    blurb:
      "A full theme editor with live preview, independent interface and code fonts, text size, corner radius and a pinnable accent colour.",
  },
  {
    id: "infra",
    title: "Local-first infrastructure",
    blurb:
      "MCP servers, five source-control providers, saved remote environments, auto-updates and built-in observability — no cloud round-trips you didn't ask for.",
  },
];

export const STATS = [
  { value: "5", label: "coding agents, one workspace" },
  { value: "3", label: "platforms — macOS · Linux · Windows" },
  { value: "0", label: "cloud required — it's all local" },
  { value: "⌘K", label: "everything a keystroke away" },
] as const;

export const PILLARS = [
  {
    title: "Performance first",
    body: "Fast local workflows backed by an Effect/TypeScript server. No round-trips you didn't ask for.",
    icon: "Zap",
  },
  {
    title: "Reliability first",
    body: "Predictable under load and during failures — session restarts, reconnects and partial streams are handled.",
    icon: "ShieldCheck",
  },
  {
    title: "Full visibility",
    body: "Per-provider event logs, usage windows and traces. You see exactly what each agent is doing.",
    icon: "Eye",
  },
] as const;

export const STEPS = [
  {
    n: "01",
    title: "Install a provider",
    body: "Install and authenticate at least one agent CLI — codex login, claude auth login, or opencode auth login.",
  },
  {
    n: "02",
    title: "Launch Ryco",
    body: "Run npx ryco-cli or open the desktop app. Settings → Providers shows live auth and version status.",
  },
  {
    n: "03",
    title: "Open a workspace",
    body: "Point Ryco at a repo, spin up a worktree per branch or PR, and start a thread with any agent.",
  },
  {
    n: "04",
    title: "Ship it",
    body: "Review diffs, jump to your editor, run terminals and merge — all without leaving the thread.",
  },
] as const;

export const FAQ = [
  {
    q: "Is Ryco cloud or local?",
    a: "Fully local. Ryco runs on your machine as a desktop app or a web CLI — your code and agent sessions never need to leave it.",
  },
  {
    q: "Which agents are supported?",
    a: "Codex, Claude, GitHub Copilot and OpenCode today, with Cursor in early access. Each runs through its native SDK or protocol.",
  },
  {
    q: "What platforms are supported?",
    a: "macOS (.dmg, arm64 + x64), Linux (.AppImage / AUR ryco-bin) and Windows (NSIS .exe).",
  },
  {
    q: "Can I run more than one of the same agent?",
    a: "Yes — named provider instances let you run, say, codex_personal and claude_openrouter at once with independent config and models.",
  },
  {
    q: "Do I have to pay for Ryco?",
    a: "No — Ryco itself is free and MIT licensed. You bring the agent subscriptions you already pay for; Ryco runs them through their native SDKs or protocols.",
  },
  {
    q: "Is it open source?",
    a: "Yes, MIT licensed. Ryco is very early — expect bugs and breaking changes. Join the Discord to follow along.",
  },
] as const;

export const VERSIONS = [
  { id: 1, name: "Precision", desc: "Linear-grade dark product", path: "/1" },
  { id: 2, name: "Datasheet", desc: "Technical mono · light", path: "/2" },
  { id: 3, name: "Editorial", desc: "Swiss serif · light", path: "/3" },
  { id: 4, name: "Kinetic", desc: "Motion-led scroll story", path: "/4" },
  { id: 5, name: "Brutalist", desc: "High-contrast typographic", path: "/5" },
  { id: 6, name: "Control Plane", desc: "t3-style · real screenshots", path: "/6" },
] as const;

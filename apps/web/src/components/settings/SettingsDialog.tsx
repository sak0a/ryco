// apps/web/src/components/settings/SettingsDialog.tsx
import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  BarChart3Icon,
  BlocksIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  PlugZapIcon,
  RotateCcwIcon,
  ServerIcon,
  Settings2Icon,
  UserRoundIcon,
  SearchIcon,
} from "lucide-react";

import { type SettingsSectionId, useSettingsDialogStore } from "../../settingsDialogStore";
import { cn } from "../../lib/utils";
import { SETTINGS_SEARCH_INDEX } from "./settingsSearchIndex";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { ArchivedThreadsPanel, GeneralSettingsPanel, useSettingsRestore } from "./SettingsPanels";
import { isHostedHubMode } from "../../env";
import { useHostedHubStore } from "../../hostedHub/state";

interface NavItem {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "account", label: "Account", icon: UserRoundIcon },
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "providers", label: "Providers", icon: BlocksIcon },
  { id: "opinionated-plugins", label: "Plugins", icon: PlugZapIcon },
  { id: "mcp-servers", label: "MCP Servers", icon: ServerIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "source-control", label: "Source Control", icon: GitBranchIcon },
  { id: "connections", label: "Connections", icon: Link2Icon },
  { id: "diagnostics", label: "Diagnostics", icon: ActivityIcon },
  { id: "statistics", label: "Statistics", icon: BarChart3Icon },
  { id: "archived", label: "Archive", icon: ArchiveIcon },
];

const HOSTED_OWNER_SECTIONS = new Set<SettingsSectionId>([
  "general",
  "providers",
  "opinionated-plugins",
  "mcp-servers",
  "keybindings",
  "source-control",
  "diagnostics",
  "statistics",
]);

/**
 * Sections that exist only in the hosted client. Account management is one:
 * there is no Hub account to manage in the standard (local-server) mode, so the
 * section is filtered out entirely rather than rendered empty.
 */
const HOSTED_ONLY_SECTIONS: ReadonlySet<SettingsSectionId> = new Set(["account"]);

export function settingsSectionAvailable(section: SettingsSectionId, hosted: boolean): boolean {
  return hosted || !HOSTED_ONLY_SECTIONS.has(section);
}

export function hostedSettingsSectionAllowed(
  section: SettingsSectionId,
  role: "viewer" | "operator" | "owner" | null,
): boolean {
  if (section === "connections") return false;
  if (section === "appearance") return true;
  // Every signed-in account owns its own credentials, whatever role it holds on
  // the nodes it can reach — and, unlike the node-scoped sections, the answer
  // does not depend on a role snapshot being fresh.
  if (section === "account") return true;
  if (section === "archived") return role !== null;
  return role === "owner" && HOSTED_OWNER_SECTIONS.has(section);
}

const SECTIONS_WITH_RESTORE: ReadonlySet<SettingsSectionId> = new Set([
  "general",
  "providers",
  "appearance",
]);

const LazyAccountSettingsPanel = lazy(() =>
  import("./AccountSettings").then((module) => ({ default: module.AccountSettingsPanel })),
);
const LazyProvidersSettingsPanel = lazy(() =>
  import("./ProvidersSettingsPanel").then((module) => ({
    default: module.ProvidersSettingsPanel,
  })),
);
const LazyOpinionatedPluginsSettingsPanel = lazy(() =>
  import("./OpinionatedPluginsSettings").then((module) => ({
    default: module.OpinionatedPluginsSettingsPanel,
  })),
);
const LazyMcpServersSettings = lazy(() =>
  import("./McpServersSettings").then((module) => ({ default: module.McpServersSettings })),
);
const LazyAppearanceSettingsPanel = lazy(() =>
  import("./AppearanceSettings").then((module) => ({ default: module.AppearanceSettingsPanel })),
);
const LazyKeybindingsSettingsPanel = lazy(() =>
  import("./KeybindingsSettings").then((module) => ({
    default: module.KeybindingsSettingsPanel,
  })),
);
const LazySourceControlSettingsPanel = lazy(() =>
  import("./SourceControlSettings").then((module) => ({
    default: module.SourceControlSettingsPanel,
  })),
);
const LazyConnectionsSettings = lazy(() =>
  import("./ConnectionsSettings").then((module) => ({ default: module.ConnectionsSettings })),
);
const LazyDiagnosticsSettings = lazy(() =>
  import("./DiagnosticsSettings").then((module) => ({ default: module.DiagnosticsSettings })),
);
const LazyStatisticsPanel = lazy(() =>
  import("./StatisticsPanel").then((module) => ({ default: module.StatisticsPanel })),
);

function RestoreDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="size-3.5" />
      Restore defaults
    </Button>
  );
}

function SectionPanel({ section }: { section: SettingsSectionId }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-80 items-center justify-center text-muted-foreground text-sm">
          Loading settings...
        </div>
      }
    >
      {section === "account" ? <LazyAccountSettingsPanel /> : null}
      {section === "general" ? <GeneralSettingsPanel /> : null}
      {section === "providers" ? <LazyProvidersSettingsPanel /> : null}
      {section === "opinionated-plugins" ? <LazyOpinionatedPluginsSettingsPanel /> : null}
      {section === "mcp-servers" ? <LazyMcpServersSettings /> : null}
      {section === "appearance" ? <LazyAppearanceSettingsPanel /> : null}
      {section === "keybindings" ? <LazyKeybindingsSettingsPanel /> : null}
      {section === "source-control" ? <LazySourceControlSettingsPanel /> : null}
      {section === "connections" ? <LazyConnectionsSettings /> : null}
      {section === "diagnostics" ? <LazyDiagnosticsSettings /> : null}
      {section === "statistics" ? <LazyStatisticsPanel /> : null}
      {section === "archived" ? <ArchivedThreadsPanel /> : null}
    </Suspense>
  );
}

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.open);
  const section = useSettingsDialogStore((s) => s.section);
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings);
  const setSection = useSettingsDialogStore((s) => s.setSection);
  const hostedRole = useHostedHubStore((state) => state.effectiveRole);
  const hostedDirectoryStatus = useHostedHubStore((state) => state.directoryStatus);
  const hostedTransportStatus = useHostedHubStore((state) => state.transportStatus);
  const hosted = isHostedHubMode();
  const roleFresh = hostedDirectoryStatus === "ready" && hostedTransportStatus === "online";
  const visibleNavItems = NAV_ITEMS.filter(
    (item) =>
      settingsSectionAvailable(item.id, hosted) &&
      (!hosted || hostedSettingsSectionAllowed(item.id, roleFresh ? hostedRole : null)),
  );
  const effectiveSection = visibleNavItems.some((item) => item.id === section)
    ? section
    : (visibleNavItems[0]?.id ?? "appearance");

  useEffect(() => {
    if (hosted && !roleFresh) return;
    if (open && section !== effectiveSection) setSection(effectiveSection);
  }, [effectiveSection, hosted, open, roleFresh, section, setSection]);

  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);
  const visibleSectionIds = new Set(visibleNavItems.map((item) => item.id));
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchResults =
    normalizedQuery.length === 0
      ? []
      : SETTINGS_SEARCH_INDEX.filter(
          (entry) =>
            visibleSectionIds.has(entry.section) &&
            `${entry.title} ${entry.description} ${entry.keywords ?? ""}`
              .toLowerCase()
              .includes(normalizedQuery),
        );
  const [restoreSignal, setRestoreSignal] = useState(0);
  const handleRestored = useCallback(() => {
    setRestoreSignal((v) => v + 1);
  }, []);

  const showRestore = SECTIONS_WITH_RESTORE.has(effectiveSection);
  const activeSectionIndex = Math.max(
    0,
    visibleNavItems.findIndex((item) => item.id === effectiveSection),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeSettings();
      }}
    >
      <DialogPopup
        className="project-glass-surface h-[min(88dvh,880px)] max-w-[1180px] overflow-hidden p-0"
        bottomStickOnMobile={false}
        showCloseButton={true}
        surface="glass"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
          <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
          <div className="relative mx-4 w-full max-w-72 flex-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search settings…"
              aria-label="Search settings"
              className="h-8 w-full rounded-md border border-input bg-muted/40 pr-3 pl-8 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <div className="flex items-center gap-2 pr-9">
            {showRestore ? <RestoreDefaultsButton onRestored={handleRestored} /> : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-row">
          <nav className="relative isolate flex w-12 shrink-0 flex-col gap-1 border-r border-border p-2 sm:w-48">
            <span
              className="pointer-events-none absolute top-2 right-2 left-2 z-0 h-9 rounded-md bg-accent transition-transform duration-[240ms] ease-out"
              style={{ transform: `translateY(${activeSectionIndex * 2.5}rem)` }}
              aria-hidden
            />
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = effectiveSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "relative z-10 flex h-9 items-center gap-2.5 rounded-md px-2 text-left text-[13px] outline-hidden ring-ring transition-colors duration-150 focus-visible:ring-2",
                    isActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/70 hover:text-foreground/80",
                  )}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-foreground" : "text-muted-foreground/60",
                    )}
                  />
                  <span className="hidden truncate sm:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <ScrollArea className="min-h-0 min-w-0 flex-1">
            {normalizedQuery.length > 0 ? (
              <div className="p-4">
                <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-sm/4">
                  {searchResults.length === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                      No settings match “{searchQuery.trim()}”.
                    </p>
                  ) : (
                    searchResults.map((entry) => {
                      const sectionLabel = visibleNavItems.find(
                        (item) => item.id === entry.section,
                      )?.label;
                      return (
                        <button
                          key={`${entry.section}:${entry.title}`}
                          type="button"
                          onClick={() => {
                            setSection(entry.section);
                            setSearchQuery("");
                          }}
                          className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 text-left outline-hidden ring-ring transition-colors hover:bg-accent focus-visible:ring-2"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="text-sm font-medium">{entry.title}</span>
                            {sectionLabel ? (
                              <span className="text-[11px] text-muted-foreground/70">
                                {sectionLabel}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{entry.description}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div key={restoreSignal} className="flex flex-col">
                <SectionPanel section={effectiveSection} />
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

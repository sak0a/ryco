// apps/web/src/components/settings/SettingsDialog.tsx
import { lazy, Suspense, useCallback, useState, type ComponentType } from "react";
import {
  ArchiveIcon,
  BlocksIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  PlugZapIcon,
  RotateCcwIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";

import { type SettingsSectionId, useSettingsDialogStore } from "../../settingsDialogStore";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { ArchivedThreadsPanel, GeneralSettingsPanel, useSettingsRestore } from "./SettingsPanels";

interface NavItem {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: "general", label: "General", icon: Settings2Icon },
  { id: "providers", label: "Providers", icon: BlocksIcon },
  { id: "opinionated-plugins", label: "Plugins", icon: PlugZapIcon },
  { id: "mcp-servers", label: "MCP Servers", icon: ServerIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon },
  { id: "source-control", label: "Source Control", icon: GitBranchIcon },
  { id: "connections", label: "Connections", icon: Link2Icon },
  { id: "archived", label: "Archive", icon: ArchiveIcon },
];

const SECTIONS_WITH_RESTORE: ReadonlySet<SettingsSectionId> = new Set([
  "general",
  "providers",
  "appearance",
]);

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
      {section === "general" ? <GeneralSettingsPanel /> : null}
      {section === "providers" ? <LazyProvidersSettingsPanel /> : null}
      {section === "opinionated-plugins" ? <LazyOpinionatedPluginsSettingsPanel /> : null}
      {section === "mcp-servers" ? <LazyMcpServersSettings /> : null}
      {section === "appearance" ? <LazyAppearanceSettingsPanel /> : null}
      {section === "keybindings" ? <LazyKeybindingsSettingsPanel /> : null}
      {section === "source-control" ? <LazySourceControlSettingsPanel /> : null}
      {section === "connections" ? <LazyConnectionsSettings /> : null}
      {section === "archived" ? <ArchivedThreadsPanel /> : null}
    </Suspense>
  );
}

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.open);
  const section = useSettingsDialogStore((s) => s.section);
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings);
  const setSection = useSettingsDialogStore((s) => s.setSection);

  const [restoreSignal, setRestoreSignal] = useState(0);
  const handleRestored = useCallback(() => {
    setRestoreSignal((v) => v + 1);
  }, []);

  const showRestore = SECTIONS_WITH_RESTORE.has(section);
  const activeSectionIndex = Math.max(
    0,
    NAV_ITEMS.findIndex((item) => item.id === section),
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
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.id;
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

          <ScrollArea className="min-h-0 flex-1 min-w-0">
            <div key={restoreSignal} className="flex flex-col">
              <SectionPanel section={section} />
            </div>
          </ScrollArea>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

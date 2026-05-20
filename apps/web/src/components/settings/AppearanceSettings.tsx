import {
  BrainIcon,
  CircleOffIcon,
  ClipboardCopyIcon,
  CopyIcon,
  DownloadIcon,
  GaugeIcon,
  type LucideIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  ZapIcon,
} from "lucide-react";
import { type ChangeEvent, Fragment, useCallback, useMemo, useRef, useState } from "react";

import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import {
  type ReasoningIndicatorStyle,
  type TokenModeControlStyle,
  useUiStateStore,
} from "../../uiStateStore";
import {
  addCustomTheme,
  applyThemeToDocument,
  deleteCustomTheme,
  duplicateTheme,
  findTheme,
  generateCustomThemeId,
  getAllThemes,
  isBuiltInThemeId,
  setActiveThemeId,
  updateCustomTheme,
} from "../../themes/registry";
import { copyThemeToClipboard, downloadTheme, importThemeFromFile } from "../../themes/transport";
import type { ThemeDefinition } from "../../themes/types";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { ThemeEditor } from "./ThemeEditor";

const VARIANT_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const REASONING_INDICATOR_OPTIONS = [
  {
    value: "icon-dots" as const,
    label: "Icon + dots",
    description: "Brain icon with intensity dots",
  },
  {
    value: "text" as const,
    label: "Text label",
    description: "Color-tinted abbreviated text",
  },
] satisfies ReadonlyArray<{
  value: ReasoningIndicatorStyle;
  label: string;
  description: string;
}>;

const TOKEN_MODE_CONTROL_OPTIONS = [
  {
    value: "icon-text" as const,
    label: "Icon + text",
    description: "Show the mode icon and label",
    preview: "Balanced",
    icon: GaugeIcon,
  },
  {
    value: "icon" as const,
    label: "Icon only",
    description: "Use the compact mode icon",
    preview: "",
    icon: ZapIcon,
  },
  {
    value: "text" as const,
    label: "Text label",
    description: "Show labels without icons",
    preview: "Tokens off",
    icon: CircleOffIcon,
  },
] satisfies ReadonlyArray<{
  value: TokenModeControlStyle;
  label: string;
  description: string;
  preview: string;
  icon: LucideIcon;
}>;

export function AppearanceSettingsPanel() {
  const { theme, setTheme, resolvedTheme, activeThemeId, setActiveTheme } = useTheme();
  const reasoningIndicatorStyle = useUiStateStore((state) => state.reasoningIndicatorStyle);
  const setReasoningIndicatorStyle = useUiStateStore((state) => state.setReasoningIndicatorStyle);
  const tokenModeControlStyle = useUiStateStore((state) => state.tokenModeControlStyle);
  const setTokenModeControlStyle = useUiStateStore((state) => state.setTokenModeControlStyle);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ThemeDefinition | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const themes = getAllThemes();
  const editing = useMemo(() => {
    void refreshTick;
    return editingId !== null && draft !== null ? { source: findTheme(editingId), draft } : null;
  }, [draft, editingId, refreshTick]);
  const pendingDeleteTheme = pendingDeleteId ? findTheme(pendingDeleteId) : null;

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  const startEditing = useCallback(
    (target: ThemeDefinition) => {
      if (isBuiltInThemeId(target.id)) {
        const copy = duplicateTheme(target);
        addCustomTheme(copy);
        setActiveThemeId(copy.id);
        setActiveTheme(copy.id);
        setEditingId(copy.id);
        setDraft(copy);
        refresh();
        return;
      }
      setActiveTheme(target.id);
      setEditingId(target.id);
      setDraft(target);
    },
    [refresh, setActiveTheme],
  );

  const handleDuplicate = useCallback(
    (target: ThemeDefinition) => {
      const copy = duplicateTheme(target);
      addCustomTheme(copy);
      setActiveTheme(copy.id);
      setEditingId(copy.id);
      setDraft(copy);
      refresh();
    },
    [refresh, setActiveTheme],
  );

  const handleAddNew = useCallback(() => {
    const fresh: ThemeDefinition = {
      id: generateCustomThemeId("new"),
      name: "New theme",
      builtIn: false,
    };
    addCustomTheme(fresh);
    setActiveTheme(fresh.id);
    setEditingId(fresh.id);
    setDraft(fresh);
    refresh();
  }, [refresh, setActiveTheme]);

  const handleSave = useCallback(() => {
    if (!editing) return;
    updateCustomTheme(editing.source.id, editing.draft);
    if (editing.source.id !== editing.draft.id) {
      setActiveTheme(editing.draft.id);
    } else {
      applyThemeToDocument(editing.draft);
    }
    setEditingId(null);
    setDraft(null);
    refresh();
  }, [editing, refresh, setActiveTheme]);

  const handleCancel = useCallback(() => {
    if (editing) applyThemeToDocument(editing.source);
    setEditingId(null);
    setDraft(null);
  }, [editing]);

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    if (editingId === pendingDeleteId) {
      setEditingId(null);
      setDraft(null);
    }
    deleteCustomTheme(pendingDeleteId);
    setPendingDeleteId(null);
    refresh();
  }, [editingId, pendingDeleteId, refresh]);

  const handleExport = useCallback((target: ThemeDefinition) => {
    try {
      downloadTheme(target);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not export theme",
        description: error instanceof Error ? error.message : "Download failed.",
      });
    }
  }, []);

  const handleCopyJson = useCallback(async (target: ThemeDefinition) => {
    try {
      await copyThemeToClipboard(target);
      toastManager.add({
        type: "success",
        title: "Copied theme JSON",
        description: `${target.name} is ready to paste.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not copy theme",
        description: error instanceof Error ? error.message : "Clipboard write failed.",
      });
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const result = await importThemeFromFile(file, { collision: "rename", activate: true });
        setActiveTheme(result.theme.id);
        refresh();
        toastManager.add({
          type: "success",
          title: `Imported "${result.theme.name}"`,
          description:
            result.action === "renamed"
              ? `An existing theme used the same id, so it was imported as "${result.theme.id}".`
              : "Theme imported and activated.",
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Could not import theme",
          description: error instanceof Error ? error.message : "Invalid theme file.",
        });
      }
    },
    [refresh, setActiveTheme],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Theme palette"
        headerAction={
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={handleImportChange}
              aria-hidden
              tabIndex={-1}
            />
            <Button
              size="xs"
              variant="ghost"
              onClick={handleAddNew}
              aria-label="Create a new theme"
              title="Create a new theme"
              className="text-muted-foreground"
            >
              <PlusIcon className="size-3.5" />
              New
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={handleImportClick}
              aria-label="Import a theme from file"
              title="Import a theme from disk"
              className="text-muted-foreground"
            >
              <UploadIcon className="size-3.5" />
              Import
            </Button>
          </div>
        }
      >
        <div role="radiogroup" aria-label="Theme palette">
          {themes.map((entry, index) => {
            const isActive = entry.id === activeThemeId;
            const isEditing = editingId === entry.id;
            return (
              <Fragment key={entry.id}>
                <div
                  role="radio"
                  aria-checked={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTheme(entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      setActiveTheme(entry.id);
                    }
                  }}
                  className={cn(
                    "flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5",
                    index > 0 ? "border-t border-border/60" : "",
                    isActive ? "bg-muted/40" : "hover:bg-muted/24",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "relative flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isActive ? "border-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {isActive ? (
                      <span className="size-2 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span
                        className="truncate text-sm font-medium text-foreground"
                        title={entry.name}
                      >
                        {entry.name}
                      </span>
                      <Badge variant="outline" size="sm">
                        {entry.builtIn ? "Built-in" : "Custom"}
                      </Badge>
                    </span>
                    {entry.description ? (
                      <span
                        className="truncate text-xs text-muted-foreground/80"
                        title={entry.description}
                      >
                        {entry.description}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {!entry.builtIn ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Edit ${entry.name}`}
                        title="Edit"
                        onClick={() => startEditing(entry)}
                        className="text-muted-foreground"
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Duplicate ${entry.name}`}
                      title="Duplicate"
                      onClick={() => handleDuplicate(entry)}
                      className="text-muted-foreground"
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Export ${entry.name}`}
                      title="Export"
                      onClick={() => handleExport(entry)}
                      className="text-muted-foreground"
                    >
                      <DownloadIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Copy ${entry.name} JSON`}
                      title="Copy JSON"
                      onClick={() => void handleCopyJson(entry)}
                      className="text-muted-foreground"
                    >
                      <ClipboardCopyIcon className="size-3.5" />
                    </Button>
                    {!entry.builtIn ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Delete ${entry.name}`}
                        title="Delete"
                        onClick={() => setPendingDeleteId(entry.id)}
                        className="text-destructive-foreground"
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {isEditing && editing ? (
                  <ThemeEditor
                    source={editing.source}
                    draft={editing.draft}
                    onDraftChange={(next) => setDraft(next)}
                    onSave={handleSave}
                    onCancel={handleCancel}
                    resolvedVariant={resolvedTheme}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Composer controls">
        <SettingsRow
          title="Reasoning chip style"
          description="How the reasoning effort level appears in the composer bar."
          resetAction={
            reasoningIndicatorStyle !== "icon-dots" ? (
              <SettingResetButton
                label="reasoning indicator"
                onClick={() => setReasoningIndicatorStyle("icon-dots")}
              />
            ) : null
          }
          control={
            <div className="flex w-full flex-col gap-2 sm:w-80">
              {REASONING_INDICATOR_OPTIONS.map((option) => {
                const isSelected = reasoningIndicatorStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setReasoningIndicatorStyle(option.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2 text-left",
                      isSelected
                        ? "border-primary ring-1 ring-primary/40"
                        : "border-border hover:border-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "size-3.5 rounded-full border",
                        isSelected ? "border-primary bg-primary/80" : "border-foreground/30",
                      )}
                    />
                    <span className="flex flex-grow flex-col">
                      <span className="font-medium text-sm">{option.label}</span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-xs",
                        "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
                      )}
                    >
                      {option.value === "icon-dots" ? (
                        <>
                          <BrainIcon aria-hidden="true" className="size-3" />
                          <span className="inline-flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((position) => (
                              <span
                                key={position}
                                className={cn(
                                  "size-[5px] rounded-full bg-current",
                                  position <= 3 ? "opacity-100" : "opacity-30",
                                )}
                              />
                            ))}
                          </span>
                        </>
                      ) : (
                        <span>High</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          }
        />
        <SettingsRow
          title="Token mode style"
          description="How the token efficiency mode appears in the composer bar."
          resetAction={
            tokenModeControlStyle !== "icon-text" ? (
              <SettingResetButton
                label="token mode style"
                onClick={() => setTokenModeControlStyle("icon-text")}
              />
            ) : null
          }
          control={
            <div className="flex w-full flex-col gap-2 sm:w-80">
              {TOKEN_MODE_CONTROL_OPTIONS.map((option) => {
                const isSelected = tokenModeControlStyle === option.value;
                const PreviewIcon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setTokenModeControlStyle(option.value)}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2 text-left",
                      isSelected
                        ? "border-primary ring-1 ring-primary/40"
                        : "border-border hover:border-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "size-3.5 rounded-full border",
                        isSelected ? "border-primary bg-primary/80" : "border-foreground/30",
                      )}
                    />
                    <span className="flex flex-grow flex-col">
                      <span className="font-medium text-sm">{option.label}</span>
                      <span className="text-muted-foreground text-xs">{option.description}</span>
                    </span>
                    <span className="inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md bg-muted px-2 font-medium text-muted-foreground text-xs">
                      {option.value !== "text" ? (
                        <PreviewIcon aria-hidden="true" className="size-3.5" />
                      ) : null}
                      {option.preview ? <span>{option.preview}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="Color mode">
        <SettingsRow
          title="Theme variant"
          description="Choose between light, dark, or following the system preference."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="color mode" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Color mode">
                <SelectValue>
                  {VARIANT_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {VARIANT_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom theme?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteTheme
                ? `"${pendingDeleteTheme.name}" will be removed permanently. This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete theme
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}

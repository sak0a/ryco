import { create } from "zustand";

export type SettingsSectionId =
  | "general"
  | "providers"
  | "opinionated-plugins"
  | "mcp-servers"
  | "appearance"
  | "keybindings"
  | "source-control"
  | "connections"
  | "diagnostics"
  | "archived";

interface SettingsDialogStore {
  open: boolean;
  section: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSectionId) => void;
}

export const useSettingsDialogStore = create<SettingsDialogStore>((set) => ({
  open: false,
  section: "general",
  openSettings: (section) => set((state) => ({ open: true, section: section ?? state.section })),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));

import { useCallback, useState } from "react";
import { type SidebarProjectGroupingMode } from "@ryco/contracts";
import type { SidebarProjectGroupMember } from "../../../sidebarProjectGrouping";
import { deriveProjectGroupingOverrideKey } from "../../../logicalProject";
import { useUpdateSettings } from "~/hooks/useSettings";

interface ProjectGroupingSettings {
  sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode> | undefined;
}

export function useSidebarProjectGroupingDialog(params: {
  projectGroupingSettings: ProjectGroupingSettings;
  updateSettings: ReturnType<typeof useUpdateSettings>["updateSettings"];
}) {
  const { projectGroupingSettings, updateSettings } = params;
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  return {
    projectGroupingTarget,
    projectGroupingSelection,
    setProjectGroupingSelection,
    openProjectGroupingDialog,
    closeProjectGroupingDialog,
    saveProjectGroupingPreference,
  };
}

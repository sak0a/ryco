import { EnvironmentId } from "@ryco/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsDialogStore } from "./settingsDialogStore";

describe("settingsDialogStore", () => {
  beforeEach(() => {
    useSettingsDialogStore.setState({
      open: false,
      section: "general",
      targetEnvironmentId: null,
    });
  });

  it("keeps an explicit node target until the dialog closes", () => {
    const environmentId = EnvironmentId.make("environment-qa");

    useSettingsDialogStore.getState().openSettings("providers", environmentId);

    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      section: "providers",
      targetEnvironmentId: environmentId,
    });

    useSettingsDialogStore.getState().closeSettings();

    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: false,
      targetEnvironmentId: null,
    });
  });
});

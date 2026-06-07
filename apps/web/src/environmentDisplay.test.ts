import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import {
  isGenericLocalEnvironmentLabel,
  normalizeDisplayLabel,
  resolveProjectEnvironmentLabel,
} from "./environmentDisplay";

const primaryEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

describe("environmentDisplay", () => {
  it("normalizes empty display labels", () => {
    expect(normalizeDisplayLabel("  ")).toBeNull();
    expect(normalizeDisplayLabel("  Build box  ")).toBe("Build box");
  });

  it("recognizes generic local labels", () => {
    expect(isGenericLocalEnvironmentLabel("Local")).toBe(true);
    expect(isGenericLocalEnvironmentLabel("Local environment")).toBe(true);
    expect(isGenericLocalEnvironmentLabel("Julius's Mac mini")).toBe(false);
  });

  it("hides generic local labels for the primary environment", () => {
    expect(
      resolveProjectEnvironmentLabel({
        environmentId: primaryEnvironmentId,
        label: "Local",
      }),
    ).toBeNull();
  });

  it("hides generic local labels even when the primary environment is unknown", () => {
    expect(
      resolveProjectEnvironmentLabel({
        environmentId: remoteEnvironmentId,
        label: "Local",
      }),
    ).toBeNull();
  });

  it("keeps custom primary and remote environment labels", () => {
    expect(
      resolveProjectEnvironmentLabel({
        environmentId: primaryEnvironmentId,
        label: "Julius's Mac mini",
      }),
    ).toBe("Julius's Mac mini");
    expect(
      resolveProjectEnvironmentLabel({
        environmentId: remoteEnvironmentId,
        label: "Build box",
      }),
    ).toBe("Build box");
  });
});

import type { DeviceScreenshotResult } from "@ryco/contracts";
import { describe, expect, it } from "vitest";

import { deviceScreenshotAttachmentName, promptLooksLikeDeviceTask } from "./devicePromptContext";

describe("promptLooksLikeDeviceTask", () => {
  it("requires a simulator scope and a visual action", () => {
    expect(promptLooksLikeDeviceTask("what do you see in the simulator?")).toBe(true);
    expect(promptLooksLikeDeviceTask("Describe the simulator screen")).toBe(true);
    expect(promptLooksLikeDeviceTask("check the iOS Simulator for layout issues")).toBe(true);
    expect(promptLooksLikeDeviceTask("add a simulator target to the build")).toBe(false);
    expect(promptLooksLikeDeviceTask("what do you see in the diff?")).toBe(false);
  });

  it("normalizes whitespace and supports the inherited Italian phrases", () => {
    expect(promptLooksLikeDeviceTask("  WHAT   DO  YOU SEE  IN THE SIMULATOR  ")).toBe(true);
    expect(promptLooksLikeDeviceTask("descrivi lo schermo del simulatore")).toBe(true);
  });
});

describe("deviceScreenshotAttachmentName", () => {
  const screenshot = {
    name: "iPhone 16 Pro.png",
  } as DeviceScreenshotResult;

  it("uses a provided filename and falls back for an empty one", () => {
    expect(deviceScreenshotAttachmentName(screenshot)).toBe("iPhone 16 Pro.png");
    expect(deviceScreenshotAttachmentName({ ...screenshot, name: "   " })).toMatch(
      /^simulator-\d+\.png$/,
    );
  });
});

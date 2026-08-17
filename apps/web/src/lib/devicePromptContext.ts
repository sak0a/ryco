/** Attach the current simulator screen when a prompt clearly asks about it. */
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type DeviceScreenshotResult,
  type EnvironmentApi,
  type ThreadId,
} from "@ryco/contracts";

import type { ComposerImageAttachment } from "../composerDraftStore";

const DEVICE_SCOPE_PATTERNS = [
  "in the simulator",
  "on the simulator",
  "the simulator",
  "simulator screen",
  "ios simulator",
  "on the device",
  "device screen",
  "nel simulatore",
  "sul simulatore",
  "schermo del simulatore",
  "sul dispositivo",
];

const DEVICE_ACTION_PATTERNS = [
  "look at",
  "what do you see",
  "read",
  "describe",
  "summarize",
  "inspect",
  "screenshot",
  "screen",
  "check",
  "guarda",
  "vedi",
  "dimmi cosa vedi",
  "leggi",
  "descrivi",
  "riassumi",
  "ispeziona",
];

export function promptLooksLikeDeviceTask(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    DEVICE_SCOPE_PATTERNS.some((pattern) => normalized.includes(pattern)) &&
    DEVICE_ACTION_PATTERNS.some((pattern) => normalized.includes(pattern))
  );
}

export function deviceScreenshotAttachmentName(input: DeviceScreenshotResult): string {
  return input.name.trim().length > 0 ? input.name : `simulator-${Date.now()}.png`;
}

function screenshotFile(screenshot: DeviceScreenshotResult): File {
  const decoded = atob(screenshot.bytesBase64);
  if (decoded.length === 0) throw new Error("Simulator screenshot is empty.");
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const file = new File([buffer], deviceScreenshotAttachmentName(screenshot), {
    type: screenshot.mimeType,
  });
  if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    throw new Error("Simulator screenshot exceeds the image attachment limit.");
  }
  return file;
}

export type DevicePromptAttachmentResolution =
  | { readonly requested: false; readonly image: null }
  | {
      readonly requested: true;
      readonly image: ComposerImageAttachment | null;
      readonly reason?: "no-attached-device" | "device-not-booted" | "attachment-processing-failed";
    };

export async function maybeResolveDevicePromptAttachment(input: {
  readonly api: EnvironmentApi;
  readonly threadId: ThreadId;
  readonly prompt: string;
}): Promise<DevicePromptAttachmentResolution> {
  if (!promptLooksLikeDeviceTask(input.prompt)) return { requested: false, image: null };
  if (!input.api.device) return { requested: true, image: null, reason: "no-attached-device" };

  try {
    const state = await input.api.device.getThreadState({ threadId: input.threadId });
    const attached = state.attachedDeviceUdid
      ? state.devices.find((device) => device.udid === state.attachedDeviceUdid)
      : undefined;
    if (!attached) return { requested: true, image: null, reason: "no-attached-device" };
    if (attached.state !== "booted") {
      return { requested: true, image: null, reason: "device-not-booted" };
    }

    const file = screenshotFile(await input.api.device.screenshot({ udid: attached.udid }));
    return {
      requested: true,
      image: {
        type: "image",
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      },
    };
  } catch {
    return { requested: true, image: null, reason: "attachment-processing-failed" };
  }
}

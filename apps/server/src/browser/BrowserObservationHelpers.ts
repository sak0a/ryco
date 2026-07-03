import type {
  BrowserHostConsoleData,
  BrowserHostDomSnapshotData,
  BrowserHostNetworkData,
  BrowserHostScreenshotData,
} from "@ryco/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function decodeBrowserHostScreenshotData(value: unknown): BrowserHostScreenshotData | null {
  if (!isRecord(value) || value.kind !== "screenshot" || typeof value.base64 !== "string") {
    return null;
  }
  return { kind: "screenshot", base64: value.base64 };
}

export function decodeBrowserHostDomSnapshotData(
  value: unknown,
): BrowserHostDomSnapshotData | null {
  if (!isRecord(value) || value.kind !== "dom_snapshot" || !isRecord(value.snapshot)) {
    return null;
  }
  const snapshot = value.snapshot;
  if (
    typeof snapshot.url !== "string" ||
    typeof snapshot.title !== "string" ||
    !isRecord(snapshot.viewport) ||
    typeof snapshot.viewport.width !== "number" ||
    typeof snapshot.viewport.height !== "number" ||
    !Array.isArray(snapshot.tree)
  ) {
    return null;
  }
  return {
    kind: "dom_snapshot",
    snapshot: snapshot as BrowserHostDomSnapshotData["snapshot"],
    ...(typeof value.text === "string" ? { text: value.text } : {}),
  };
}

export function decodeBrowserHostConsoleData(value: unknown): BrowserHostConsoleData | null {
  if (!isRecord(value) || value.kind !== "console" || !Array.isArray(value.entries)) {
    return null;
  }
  return { kind: "console", entries: value.entries as BrowserHostConsoleData["entries"] };
}

export function decodeBrowserHostNetworkData(value: unknown): BrowserHostNetworkData | null {
  if (!isRecord(value) || value.kind !== "network" || !Array.isArray(value.entries)) {
    return null;
  }
  return { kind: "network", entries: value.entries as BrowserHostNetworkData["entries"] };
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = Buffer.from(base64, "base64");
  return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
}

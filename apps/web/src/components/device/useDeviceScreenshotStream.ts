import type { DeviceScreenshotResult, DeviceUdid } from "@ryco/contracts";
import { useEffect, useState, type RefObject } from "react";

import type { DeviceVideoStatus } from "./useDeviceVideoStream";

const HOSTED_SCREENSHOT_INTERVAL_MS = 750;

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function decodeBase64BlobPart(value: string): ArrayBuffer {
  const bytes = decodeBase64(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Hosted relay fallback. The lifecycle-owned relay is an RPC byte channel, so
 * until it negotiates a lossy binary subchannel we sample PNGs over its bounded
 * read RPC. Input and lifecycle calls still share the authoritative relay
 * generation, and direct/saved environments continue to use low-latency H.264.
 */
export function useDeviceScreenshotStream(input: {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly udid: DeviceUdid | null;
  readonly enabled: boolean;
  readonly screenshot: ((input: { udid: DeviceUdid }) => Promise<DeviceScreenshotResult>) | null;
}): {
  readonly status: DeviceVideoStatus;
  readonly error: string | null;
  readonly dimensions: { readonly width: number; readonly height: number } | null;
} {
  const { canvasRef, enabled, screenshot, udid } = input;
  const [status, setStatus] = useState<DeviceVideoStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!enabled || !udid || !screenshot) {
      setStatus("idle");
      setError(null);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setStatus("connecting");

    const sample = async () => {
      try {
        const shot = await screenshot({ udid });
        if (!active) return;
        const bitmap = await createImageBitmap(
          new Blob([decodeBase64BlobPart(shot.bytesBase64)], { type: shot.mimeType }),
        );
        try {
          if (!active) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            setDimensions({ width: bitmap.width, height: bitmap.height });
          }
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          setStatus("streaming");
          setError(null);
        } finally {
          bitmap.close();
        }
      } catch (sampleError) {
        if (!active) return;
        setStatus("recovering");
        setError(
          sampleError instanceof Error
            ? sampleError.message
            : "The hosted simulator preview disconnected.",
        );
      } finally {
        if (active) timer = setTimeout(() => void sample(), HOSTED_SCREENSHOT_INTERVAL_MS);
      }
    };

    void sample();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [canvasRef, enabled, screenshot, udid]);

  return { status, error, dimensions };
}

import type { DeviceScreenshotResult, DeviceUdid } from "@ryco/contracts";
import { useEffect, useState, type RefObject } from "react";

import type { DeviceVideoStatus } from "./useDeviceVideoStream";

const HOSTED_SCREENSHOT_INTERVAL_MS = 750;
const HOSTED_SCREENSHOT_TARGET_BYTES_PER_SECOND = 512 * 1024;
const HOSTED_SCREENSHOT_MAX_INTERVAL_MS = 15_000;

/**
 * Backpressure the full-PNG fallback by its actual relay payload size.
 *
 * docs/relay-capacity-assessment-3b.md measured 3,053,100 base64 bytes per
 * phone frame and 5,569,884 per tablet frame. At the old fixed 750ms cadence
 * those were 3.88/7.08 MiB/s and exhausted a 50 MiB channel after 18/10
 * frames. This target spaces the measured frames by about 5.8s/10.6s (at most
 * 0.5 MiB/s), in addition to suspending the loop while the panel or document
 * is hidden.
 */
export function hostedScreenshotDelayMs(base64PayloadBytes: number): number {
  const transferDelay = Math.ceil(
    (Math.max(0, base64PayloadBytes) / HOSTED_SCREENSHOT_TARGET_BYTES_PER_SECOND) * 1_000,
  );
  return Math.min(
    HOSTED_SCREENSHOT_MAX_INTERVAL_MS,
    Math.max(HOSTED_SCREENSHOT_INTERVAL_MS, transferDelay),
  );
}

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
    let pageVisible = document.visibilityState !== "hidden";
    let panelVisible = true;
    let sampling = false;
    setStatus("connecting");

    const clearTimer = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const visible = () => active && pageVisible && panelVisible;
    const schedule = (delayMs: number) => {
      clearTimer();
      if (!visible() || sampling) return;
      timer = setTimeout(() => {
        timer = null;
        void sample();
      }, delayMs);
    };

    const sample = async () => {
      if (!visible() || sampling) return;
      sampling = true;
      let nextDelay = HOSTED_SCREENSHOT_INTERVAL_MS;
      try {
        const shot = await screenshot({ udid });
        nextDelay = hostedScreenshotDelayMs(shot.bytesBase64.length);
        if (!visible()) return;
        const bitmap = await createImageBitmap(
          new Blob([decodeBase64BlobPart(shot.bytesBase64)], { type: shot.mimeType }),
        );
        try {
          if (!visible()) return;
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
        sampling = false;
        if (visible()) schedule(nextDelay);
      }
    };

    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== "hidden";
      if (!pageVisible) clearTimer();
      else schedule(0);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const canvas = canvasRef.current;
    const observer =
      canvas && typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            panelVisible = entries.some((entry) => entry.isIntersecting);
            if (!panelVisible) clearTimer();
            else schedule(0);
          })
        : null;
    observer?.observe(canvas!);
    schedule(0);
    return () => {
      active = false;
      clearTimer();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [canvasRef, enabled, screenshot, udid]);

  return { status, error, dimensions };
}

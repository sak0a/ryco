/* eslint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope.postMessage has no target-origin parameter. */
import {
  renderLiquidGlassPixels,
  type LiquidGlassMapWorkerRequest,
  type LiquidGlassMapWorkerResponse,
} from "../lib/liquidGlassMapProtocol";

interface LiquidGlassWorkerScope {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<LiquidGlassMapWorkerRequest>) => void,
  ) => void;
  postMessage: (message: LiquidGlassMapWorkerResponse) => void;
}

const workerScope = self as unknown as LiquidGlassWorkerScope;

workerScope.addEventListener("message", (event) => {
  void (async () => {
    const startedAt = performance.now();
    try {
      const rendered = renderLiquidGlassPixels(event.data);
      const canvas = new OffscreenCanvas(rendered.width, rendered.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("OffscreenCanvas 2D context is unavailable");
      context.putImageData(new ImageData(rendered.pixels, rendered.width, rendered.height), 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      workerScope.postMessage({
        kind: "result",
        requestId: event.data.requestId,
        blob,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      workerScope.postMessage({
        kind: "error",
        requestId: event.data.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

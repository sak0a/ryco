import { describe, expect, it, vi } from "vite-plus/test";

import { createLiquidGlassMapCache, quantizeLiquidGlassMapInput } from "./liquidGlassMapCache";
import { getLiquidGlassBitmapSize, renderLiquidGlassPixels } from "./liquidGlassMapProtocol";

const firstInput = { width: 101, height: 49, radius: 21, edgeBandPx: 35 };
const firstGenerated = { blob: new Blob(["first-map"]), durationMs: 4 };

describe("liquid-glass map cache", () => {
  it("quantizes dimensions and coalesces concurrent generation", async () => {
    let resolveGeneration: ((value: typeof firstGenerated) => void) | undefined;
    const generate = vi.fn(
      () =>
        new Promise<typeof firstGenerated>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    const createObjectUrl = vi.fn(() => "blob:first");
    const cache = createLiquidGlassMapCache({
      generate,
      createObjectUrl,
      revokeObjectUrl: vi.fn(),
    });

    const first = cache.acquire(firstInput);
    const second = cache.acquire({ ...firstInput, width: 102, height: 50 });
    resolveGeneration?.(firstGenerated);
    const [firstLease, secondLease] = await Promise.all([first, second]);

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith({ width: 104, height: 48, radius: 24, edgeBandPx: 32 });
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(firstLease?.url).toBe("blob:first");
    expect(secondLease?.url).toBe("blob:first");
    firstLease?.release();
    secondLease?.release();
  });

  it("never revokes an active lease while enforcing the LRU entry bound", async () => {
    let sequence = 0;
    const revoked: string[] = [];
    const cache = createLiquidGlassMapCache({
      generate: vi.fn(async () => ({ blob: new Blob(["map"]), durationMs: 1 })),
      createObjectUrl: () => `blob:${++sequence}`,
      revokeObjectUrl: (url) => revoked.push(url),
      maxEntries: 1,
      maxBytes: 1_000,
    });

    const firstLease = await cache.acquire(firstInput);
    const secondLease = await cache.acquire({ ...firstInput, width: 200 });
    expect(cache.inspect().entries).toBe(2);
    expect(revoked).toEqual([]);

    firstLease?.release();
    expect(cache.inspect().entries).toBe(1);
    expect(revoked).toEqual(["blob:1"]);
    expect(secondLease?.url).toBe("blob:2");
    secondLease?.release();
  });

  it("drops failed promises so a later request can retry", async () => {
    const generate = vi
      .fn<() => Promise<typeof firstGenerated>>()
      .mockRejectedValueOnce(new Error("worker failed"))
      .mockResolvedValueOnce(firstGenerated);
    const cache = createLiquidGlassMapCache({
      generate,
      createObjectUrl: () => "blob:retry",
      revokeObjectUrl: vi.fn(),
    });

    await expect(cache.acquire(firstInput)).resolves.toBeNull();
    await expect(cache.acquire(firstInput)).resolves.toMatchObject({ url: "blob:retry" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("caps bitmap work and emits a neutral opaque center", () => {
    expect(quantizeLiquidGlassMapInput(firstInput)).toEqual({
      width: 104,
      height: 48,
      radius: 24,
      edgeBandPx: 32,
    });
    const bitmap = getLiquidGlassBitmapSize(1_180, 790);
    expect(bitmap.width * bitmap.height).toBeLessThanOrEqual(263_000);

    const rendered = renderLiquidGlassPixels({
      width: 100,
      height: 60,
      radius: 20,
      edgeBandPx: 12,
    });
    const center =
      (Math.floor(rendered.height / 2) * rendered.width + Math.floor(rendered.width / 2)) * 4;
    expect(Array.from(rendered.pixels.slice(center, center + 4))).toEqual([128, 128, 128, 255]);
  });
});

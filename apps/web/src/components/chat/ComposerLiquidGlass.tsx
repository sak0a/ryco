import { useEffect, useId, useState } from "react";

import {
  buildLiquidGlassFilter,
  ensureLiquidGlassDefsHost,
  isChromiumEngine,
  isLiquidGlassMediaEligible,
  registerLiquidGlassGlintHost,
  renderDisplacementMap,
} from "../../lib/liquidGlass";

/**
 * Liquid-glass layer for the composer, adapted from rdev/liquid-glass-react
 * (MIT) but implemented on the host itself: Chromium accepts SVG reference
 * filters inside `backdrop-filter`, so the host gets
 * `backdrop-filter: url(#graph) blur() saturate()` — the page behind is
 * refracted (three per-channel displacement passes recombined with screen
 * blends, i.e. the library's chromatic aberration) and then frosted, while
 * the composer's own content is never filtered.
 *
 * The displacement map is ray-traced through a convex-squircle bezel profile
 * (see lib/liquidGlass.ts): X offsets in the red channel, Y in blue, neutral
 * 128 outside the rim so only the bezel bends light (which also self-masks
 * the aberration).
 *
 * Degradation contract: Safari/Firefox skip the displacement (blur + bezel
 * only — the design must read complete there); `prefers-reduced-transparency`
 * and `forced-colors` disable the whole layer; `prefers-reduced-motion`
 * freezes the pointer-tracked bezel glint.
 */

const DISPLACEMENT_SCALE = -64;

export function ComposerLiquidGlass({ hostRef }: { hostRef: React.RefObject<HTMLElement | null> }) {
  const filterId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [enabled, setEnabled] = useState(false);
  const [refract, setRefract] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!isLiquidGlassMediaEligible()) return;
    setEnabled(true);
    setRefract(isChromiumEngine());
  }, []);

  // Build the shared displacement graph and keep its map matched to the
  // composer's size (rAF-coalesced on resize).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled || !refract) return;
    const handles = buildLiquidGlassFilter(filterId);
    handles.setScale(DISPLACEMENT_SCALE);
    ensureLiquidGlassDefsHost().appendChild(handles.filter);
    let frame = 0;
    const regenerate = () => {
      frame = 0;
      const width = host.offsetWidth;
      const height = host.offsetHeight;
      if (width < 24 || height < 24) return;
      const url = renderDisplacementMap(width, height, 22, 36);
      if (!url) return;
      handles.setMap(url, width, height);
      setMapReady(true);
    };
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(regenerate);
    });
    observer.observe(host);
    // Generate the initial map synchronously: ResizeObserver's initial
    // delivery has proven unreliable here, and the host is already laid out.
    regenerate();
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      handles.filter.remove();
      setMapReady(false);
    };
  }, [enabled, refract, filterId, hostRef]);

  // Mark the host and hand it the composed backdrop filter. Chromium gets
  // the displacement graph in the chain; other engines get the plain frost.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;
    host.setAttribute("data-liquid-glass", "true");
    const backdrop =
      refract && mapReady
        ? `url(#${filterId}) blur(10px) saturate(185%)`
        : "blur(24px) saturate(185%)";
    host.style.setProperty("--composer-liquid-backdrop", backdrop);
    return () => {
      host.removeAttribute("data-liquid-glass");
      host.style.removeProperty("--composer-liquid-backdrop");
    };
  }, [enabled, refract, mapReady, filterId, hostRef]);

  // Pointer-tracked bezel glint via the shared tracker (one listener and one
  // rAF loop across every liquid surface; frozen under reduced motion there).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;
    return registerLiquidGlassGlintHost(host);
  }, [enabled, hostRef]);

  if (!enabled) return null;

  return (
    <>
      <div aria-hidden="true" className="liquid-glass-sheen" />
      <div aria-hidden="true" className="liquid-glass-ring" />
      <div aria-hidden="true" className="liquid-glass-ring liquid-glass-ring--overlay" />
    </>
  );
}

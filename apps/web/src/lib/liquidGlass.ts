import { getEffectiveSurfaceTransparency } from "../themes/appearancePreferences";

/**
 * Shared machinery for the experimental liquid-glass material: an SVG
 * displacement filter composed INTO `backdrop-filter` (Chromium supports SVG
 * reference filters there), so the page behind a surface is refracted at the
 * rim and then frosted while the surface's own content is never filtered.
 *
 * The displacement map is physically derived (after kube.io's liquid-glass
 * write-up): a ray is traced through a convex-squircle bezel profile using
 * Snell's law, giving a magnitude that is zero at the very edge, peaks just
 * inside the rim, and dies out toward the plateau — the characteristic lens
 * ring. Directions follow the rounded-rect SDF gradient (the true edge
 * normal), X offsets in the red channel, Y in blue, neutral 128 elsewhere.
 */

export function isChromiumEngine(): boolean {
  return typeof navigator !== "undefined" && /Chrom(e|ium)/.test(navigator.userAgent);
}

function matchesMedia(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

/**
 * The media gates shared by every liquid surface: no glass under reduced
 * transparency or forced colors, and none on coarse pointers. Engine-neutral —
 * Safari/Firefox still qualify for the frost tier.
 */
export function isLiquidGlassMediaEligible(): boolean {
  if (typeof window === "undefined") return false;
  if (matchesMedia("(prefers-reduced-transparency: reduce)")) return false;
  if (matchesMedia("(forced-colors: active)")) return false;
  return matchesMedia("(pointer: fine)");
}

export function isLiquidGlassCapable(): boolean {
  return isChromiumEngine() && isLiquidGlassMediaEligible();
}

/**
 * Displacement strength per Material step. Solid gets none — an opaque plate
 * has nothing to refract — and the effect deepens with the step, so the
 * Transparency slider drives translucency, frost, and refraction as one axis.
 */
const DISPLACEMENT_SCALE_BY_STEP: Record<string, number> = {
  default: 0,
  light: 28,
  medium: 40,
  high: 52,
  glass: 64,
};

export function getLiquidGlassDisplacementScale(): number {
  return DISPLACEMENT_SCALE_BY_STEP[getEffectiveSurfaceTransparency()] ?? 0;
}

/**
 * Displacement magnitude by normalized distance-from-edge, ray-traced once
 * through a convex-circle bezel (height `y = √(1-(1-t)²)`, refractive index
 * 1.5). A vertical ray hits the tilted surface at incidence
 * `θ1 = atan(slope)`, bends by `δ = θ1 - asin(sin(θ1)/n)`, and lands
 * `y·tan(δ)` off its entry point — zero at the sharp edge (no glass depth),
 * peaking around a fifth of the way in and carrying visible bend across the
 * whole band. (The squircle profile Apple favors plateaus within the first
 * few percent of the band, which reads as almost no refraction at our band
 * widths — the circle is the profile that actually looks like liquid glass.)
 * Normalized so the profile peak maps to the full channel range.
 */
const REFRACTION_SAMPLES = 128;
const GLASS_REFRACTIVE_INDEX = 1.5;

let refractionProfile: Float32Array | null = null;

function getRefractionProfile(): Float32Array {
  if (refractionProfile) return refractionProfile;
  const lut = new Float32Array(REFRACTION_SAMPLES);
  let peak = 0;
  for (let i = 0; i < REFRACTION_SAMPLES; i++) {
    const t = i / (REFRACTION_SAMPLES - 1);
    const u = 1 - t;
    const height = Math.sqrt(Math.max(1 - u * u, 1e-9));
    const slope = u / height;
    const theta1 = Math.atan(slope);
    const theta2 = Math.asin(Math.sin(theta1) / GLASS_REFRACTIVE_INDEX);
    lut[i] = height * Math.tan(theta1 - theta2);
    peak = Math.max(peak, lut[i] as number);
  }
  for (let i = 0; i < REFRACTION_SAMPLES; i++) lut[i] = (lut[i] as number) / peak;
  refractionProfile = lut;
  return lut;
}

/**
 * Maps are smooth gradients, so large surfaces don't need pixel-exact maps —
 * cap the generated bitmap and let feImage stretch it back over the element.
 * Keeps a 1180×790 dialog's map generation ~4× cheaper with no visible loss.
 */
const MAX_MAP_PIXELS = 262144;

/** Physically-profiled rounded-rect displacement map: X in R, Y in B. */
export function renderDisplacementMap(
  width: number,
  height: number,
  radius: number,
  edgeBandPx: number,
): string | null {
  const scale = Math.min(1, Math.sqrt(MAX_MAP_PIXELS / Math.max(1, width * height)));
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(w, h);
  const lut = getRefractionProfile();
  const halfW = w / 2 - 1;
  const halfH = h / 2 - 1;
  const r = Math.min(radius * scale, halfW, halfH);
  const band = Math.max(2, edgeBandPx * scale);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x - w / 2;
      const py = y - h / 2;
      const qx = Math.abs(px) - halfW + r;
      const qy = Math.abs(py) - halfH + r;
      const distance =
        Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
      const index = (y * w + x) * 4;
      // Normalized depth into the bezel: 0 at the edge, 1 at the plateau.
      const t = -distance / band;
      if (t <= 0 || t >= 1) {
        image.data[index] = 128;
        image.data[index + 1] = 128;
        image.data[index + 2] = 128;
        image.data[index + 3] = 255;
        continue;
      }
      const magnitude = lut[Math.round(t * (REFRACTION_SAMPLES - 1))] as number;
      // Outward edge normal from the SDF gradient: radial in the corner
      // circle, cardinal along the straight edges.
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy) || 1;
        nx = (qx / length) * Math.sign(px);
        ny = (qy / length) * Math.sign(py);
      } else if (qx > qy) {
        nx = Math.sign(px);
        ny = 0;
      } else {
        nx = 0;
        ny = Math.sign(py);
      }
      image.data[index] = 128 + nx * magnitude * 127;
      image.data[index + 1] = 128;
      image.data[index + 2] = 128 + ny * magnitude * 127;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * Maps are pure functions of (size, radius, band) and popups reopen at the
 * same sizes constantly — cache the data URLs so reopening a menu costs
 * nothing beyond a Map lookup.
 */
const MAP_CACHE_LIMIT = 24;
const displacementMapCache = new Map<string, string>();

function renderDisplacementMapCached(
  width: number,
  height: number,
  radius: number,
  edgeBandPx: number,
): string | null {
  const key = `${Math.round(width)}x${Math.round(height)}r${radius}b${edgeBandPx}`;
  const cached = displacementMapCache.get(key);
  if (cached) return cached;
  const url = renderDisplacementMap(width, height, radius, edgeBandPx);
  if (url) {
    if (displacementMapCache.size >= MAP_CACHE_LIMIT) {
      const oldest = displacementMapCache.keys().next().value;
      if (oldest !== undefined) displacementMapCache.delete(oldest);
    }
    displacementMapCache.set(key, url);
  }
  return url;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Relative spread of the three per-channel displacement passes — the
 * chromatic aberration from rdev/liquid-glass-react's filter graph. Our SDF
 * maps are neutral (128) across the center band, so every pass agrees there
 * and the fringing self-masks to the rim; no explicit edge mask is needed.
 */
const ABERRATION_SPREAD = 0.09;

/**
 * Above this area (CSS px²) the graph drops to ONE displacement pass — no
 * chromatic aberration. Chromium re-executes url() reference filters in
 * `backdrop-filter` on every frame the surface repaints (interior scroll,
 * hover states), and profiling the settings dialog showed the two extra
 * per-channel passes are the entire measurable overhead of the liquid
 * material (3-pass ≈ +34% frame time with dropped frames; 1-pass ≈ frost
 * cost). On dialog-sized surfaces the rim fringe is invisible anyway; small
 * popups and the composer keep the full effect.
 */
const ABERRATION_AREA_LIMIT = 350_000;

interface LiquidFilterHandles {
  readonly filter: SVGFilterElement;
  readonly setMap: (url: string, width: number, height: number) => void;
  readonly setScale: (scale: number) => void;
}

function channelMatrix(channel: 0 | 1 | 2): string {
  const rows = ["0 0 0 0 0", "0 0 0 0 0", "0 0 0 0 0", "0 0 0 1 0"];
  rows[channel] = ["1 0 0 0 0", "0 1 0 0 0", "0 0 1 0 0"][channel] as string;
  return rows.join(" ");
}

/**
 * Builds the displacement filter graph. With `aberration` (the default), one
 * pass per color channel at slightly different scales, channel-isolated and
 * recombined with screen blends; without it, a single displacement pass —
 * measurably as cheap as a plain frost. Returns handles to retarget the
 * map/scale without rebuilding.
 */
export function buildLiquidGlassFilter(
  id: string,
  options?: { aberration?: boolean },
): LiquidFilterHandles {
  const aberration = options?.aberration ?? true;
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const feImage = document.createElementNS(SVG_NS, "feImage");
  feImage.setAttribute("result", "map");
  feImage.setAttribute("x", "0");
  feImage.setAttribute("y", "0");
  feImage.setAttribute("preserveAspectRatio", "none");
  filter.appendChild(feImage);

  const displacements: SVGFEDisplacementMapElement[] = [];
  const channels: Array<0 | 1 | 2> = aberration ? [0, 1, 2] : [0];
  for (const channel of channels) {
    const feDisplacement = document.createElementNS(SVG_NS, "feDisplacementMap");
    feDisplacement.setAttribute("in", "SourceGraphic");
    feDisplacement.setAttribute("in2", "map");
    feDisplacement.setAttribute("xChannelSelector", "R");
    feDisplacement.setAttribute("yChannelSelector", "B");
    filter.appendChild(feDisplacement);
    displacements.push(feDisplacement);
    if (!aberration) break;

    feDisplacement.setAttribute("result", `disp${channel}`);
    const feIsolate = document.createElementNS(SVG_NS, "feColorMatrix");
    feIsolate.setAttribute("in", `disp${channel}`);
    feIsolate.setAttribute("type", "matrix");
    feIsolate.setAttribute("values", channelMatrix(channel));
    feIsolate.setAttribute("result", `chan${channel}`);
    filter.appendChild(feIsolate);
  }

  if (aberration) {
    const blendRG = document.createElementNS(SVG_NS, "feBlend");
    blendRG.setAttribute("in", "chan0");
    blendRG.setAttribute("in2", "chan1");
    blendRG.setAttribute("mode", "screen");
    blendRG.setAttribute("result", "blendRG");
    filter.appendChild(blendRG);

    const blendRGB = document.createElementNS(SVG_NS, "feBlend");
    blendRGB.setAttribute("in", "blendRG");
    blendRGB.setAttribute("in2", "chan2");
    blendRGB.setAttribute("mode", "screen");
    filter.appendChild(blendRGB);
  }

  return {
    filter,
    setMap: (url, width, height) => {
      feImage.setAttribute("href", url);
      feImage.setAttribute("width", String(width));
      feImage.setAttribute("height", String(height));
    },
    setScale: (scale) => {
      displacements.forEach((node, index) => {
        node.setAttribute("scale", String(scale * (1 + index * ABERRATION_SPREAD)));
      });
    },
  };
}

/**
 * Bezel + sheen layers and the shared pointer glint for enhancer-attached
 * surfaces, mirroring the composer's treatment. The glint writes a CSS
 * variable straight to each host — no framework work per pointermove.
 */
const glintHosts = new Set<HTMLElement>();
let glintFrame = 0;
let glintListener: ((event: PointerEvent) => void) | null = null;

function ensureGlintTracker(): void {
  if (glintListener) return;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  glintListener = (event: PointerEvent) => {
    if (glintFrame) return;
    glintFrame = window.requestAnimationFrame(() => {
      glintFrame = 0;
      for (const host of glintHosts) {
        const rect = host.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        if (Math.hypot(dx, dy) > 480 + rect.width / 2) continue;
        host.style.setProperty("--lg-bezel-angle", `${135 + dx * 0.045 + dy * 0.06}deg`);
      }
    });
  };
  window.addEventListener("pointermove", glintListener, { passive: true });
}

function releaseGlintTracker(): void {
  if (!glintListener || glintHosts.size > 0) return;
  window.removeEventListener("pointermove", glintListener);
  if (glintFrame) window.cancelAnimationFrame(glintFrame);
  glintFrame = 0;
  glintListener = null;
}

/**
 * Registers a host with the shared pointer glint (one window listener + one
 * rAF loop for every liquid surface). Returns an unregister function.
 */
export function registerLiquidGlassGlintHost(element: HTMLElement): () => void {
  glintHosts.add(element);
  ensureGlintTracker();
  return () => {
    glintHosts.delete(element);
    releaseGlintTracker();
  };
}

function attachLiquidLayers(element: HTMLElement): () => void {
  const layers: HTMLElement[] = [];
  for (const className of [
    "liquid-glass-sheen liquid-glass-sheen--subtle",
    "liquid-glass-ring",
    "liquid-glass-ring liquid-glass-ring--overlay",
  ]) {
    const layer = document.createElement("div");
    layer.className = className;
    layer.setAttribute("aria-hidden", "true");
    element.appendChild(layer);
    layers.push(layer);
  }
  const previousPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  const unregisterGlint = registerLiquidGlassGlintHost(element);
  return () => {
    for (const layer of layers) layer.remove();
    element.style.position = previousPosition;
    unregisterGlint();
  };
}

let sharedDefsHost: SVGSVGElement | null = null;
let filterSequence = 0;

export function ensureLiquidGlassDefsHost(): SVGSVGElement {
  if (sharedDefsHost?.isConnected) return sharedDefsHost;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  document.body.appendChild(svg);
  sharedDefsHost = svg;
  return svg;
}

/**
 * Attach the refraction to an element that already carries a step-driven
 * translucent material (e.g. `.selection-glass-surface`): its computed
 * backdrop-filter is re-composed as `url(#sdf) <existing filters>`. No-op at
 * the Solid step (computed filter `none`) so the Transparency slider keeps
 * full authority. Returns a detach function.
 */
export function attachLiquidGlassRefraction(element: HTMLElement, radius: number): () => void {
  const scale = getLiquidGlassDisplacementScale();
  const existing = getComputedStyle(element).backdropFilter;
  if (scale === 0 || !existing || existing === "none" || existing.includes("url(")) {
    return () => {};
  }
  const id = `liquid-glass-${++filterSequence}`;
  // Built on the first regenerate, once the element's size is known: large
  // surfaces (dialogs) get the single-pass graph, small ones the full
  // aberration graph.
  let handles: LiquidFilterHandles | null = null;
  const detachLayers = attachLiquidLayers(element);

  // Chromium drops the whole backdrop-filter when a url() reference filter
  // is combined with `will-change: transform` (the popup primitives carry it
  // as an entrance-animation hint). Stripping it while the liquid material
  // is attached revives the chain; the entrance transform itself is gone by
  // the time the filter applies (see the settle delay below).
  element.style.willChange = "auto";
  // The hint may also sit on the popup wrapper ABOVE the glass element (the
  // select primitives do this) — a grouped ancestor severs the backdrop just
  // the same, so clear the chain up to the portal positioner.
  const touchedAncestors: Array<{ node: HTMLElement; value: string }> = [];
  for (
    let ancestor = element.parentElement, depth = 0;
    ancestor && depth < 4;
    ancestor = ancestor.parentElement, depth++
  ) {
    if (getComputedStyle(ancestor).willChange !== "auto") {
      touchedAncestors.push({ node: ancestor, value: ancestor.style.willChange });
      ancestor.style.willChange = "auto";
    }
  }

  let frame = 0;
  const regenerate = () => {
    frame = 0;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (width < 24 || height < 24) return;
    // Bezel width scales with the surface so the lens ring stays readable:
    // ~a quarter of the smaller dimension, within sane bounds.
    const band = Math.round(Math.min(52, Math.max(28, Math.min(width, height) * 0.24)));
    const url = renderDisplacementMapCached(width, height, radius, band);
    if (!url) return;
    if (!handles) {
      handles = buildLiquidGlassFilter(id, {
        aberration: width * height <= ABERRATION_AREA_LIMIT,
      });
      handles.setScale(-scale);
      ensureLiquidGlassDefsHost().appendChild(handles.filter);
    }
    handles.setMap(url, width, height);
    element.style.backdropFilter = `url(#${id}) ${existing}`;
    // Safari ignores the whole declaration if url() is present, so the
    // -webkit- fallback keeps the plain frost.
    element.style.setProperty("-webkit-backdrop-filter", existing);
  };
  // Apply immediately: during the entrance animation the element is grouped
  // and cannot sample the page regardless, so the chain being in place means
  // the frost + refraction are live the instant the animation settles.
  regenerate();
  const observer = new ResizeObserver(() => {
    if (frame) return;
    frame = window.requestAnimationFrame(regenerate);
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    handles?.filter.remove();
    detachLayers();
    element.style.removeProperty("backdrop-filter");
    element.style.removeProperty("-webkit-backdrop-filter");
    element.style.removeProperty("will-change");
    for (const { node, value } of touchedAncestors) {
      if (value) node.style.willChange = value;
      else node.style.removeProperty("will-change");
    }
  };
}

/**
 * Progressive enhancement pass: every `.selection-glass-surface` that enters
 * the DOM (menus, selects, the model picker, the command palette — all
 * portaled popups) gets the rim refraction while it lives. Watching the DOM
 * beats threading a layer component through every popup primitive while the
 * material is experimental; the class name IS the contract.
 *
 */
export function installLiquidGlassEnhancer(): void {
  if (!isLiquidGlassCapable()) return;
  const detachByElement = new Map<HTMLElement, () => void>();
  const consider = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    const surfaces = node.matches(".selection-glass-surface")
      ? [node]
      : [...node.querySelectorAll<HTMLElement>(".selection-glass-surface")];
    for (const surface of surfaces) {
      if (detachByElement.has(surface)) continue;
      const radius = Number.parseFloat(getComputedStyle(surface).borderRadius) || 10;
      detachByElement.set(surface, attachLiquidGlassRefraction(surface, radius));
    }
  };
  const release = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    for (const [surface, detach] of detachByElement) {
      if (node === surface || node.contains(surface)) {
        detach();
        detachByElement.delete(surface);
      }
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(consider);
      mutation.removedNodes.forEach(release);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

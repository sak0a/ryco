import { useEffect, useLayoutEffect, useRef } from "react";
import { getWebPerfReporter, isWebPerfProfileEnabled, readWebPerfNow } from "./perfInstrumentation";

export const TAB_SWITCH_MARK_PREFIX = "ryco:tab-switch:";
export const SIDEBAR_EXPAND_MARK_PREFIX = "ryco:sidebar-expand:";
export const COMPONENT_RENDER_MARK_PREFIX = "ryco:render:";

export type TabSwitchPhase = "click" | "first-paint";
export type SidebarExpandPhase = "click" | "first-paint";

export function makeTabSwitchMarkName(phase: TabSwitchPhase, key: string): string {
  if (!key) {
    throw new Error("tab-switch mark name requires a non-empty key");
  }
  return `${TAB_SWITCH_MARK_PREFIX}${phase}:${key}`;
}

export function markTabSwitchClick(key: string): void {
  if (!isWebPerfProfileEnabled() || typeof performance === "undefined") return;
  performance.mark(makeTabSwitchMarkName("click", key));
}

export function markTabSwitchFirstPaint(key: string): void {
  if (!isWebPerfProfileEnabled() || typeof performance === "undefined") return;
  const name = makeTabSwitchMarkName("first-paint", key);
  if (performance.getEntriesByName(name).length > 0) return;
  performance.mark(name);
  try {
    performance.measure(`ryco:tab-switch:${key}`, makeTabSwitchMarkName("click", key), name);
  } catch {
    // No matching click mark — initial mount, ignore.
  }
}

export function makeSidebarExpandMarkName(phase: SidebarExpandPhase, key: string): string {
  if (!key) {
    throw new Error("sidebar-expand mark name requires a non-empty key");
  }
  return `${SIDEBAR_EXPAND_MARK_PREFIX}${phase}:${key}`;
}

export function markSidebarExpandClick(key: string): void {
  if (!isWebPerfProfileEnabled() || typeof performance === "undefined") return;
  performance.mark(makeSidebarExpandMarkName("click", key));
}

export function markSidebarExpandFirstPaint(key: string): void {
  if (!isWebPerfProfileEnabled() || typeof performance === "undefined") return;
  const name = makeSidebarExpandMarkName("first-paint", key);
  if (performance.getEntriesByName(name).length > 0) return;
  performance.mark(name);
  try {
    performance.measure(
      `ryco:sidebar-expand:${key}`,
      makeSidebarExpandMarkName("click", key),
      name,
    );
  } catch {
    // No matching click mark — initial mount, ignore.
  }
}

export function useRenderCounter(label: string): void {
  const count = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    count.current += 1;
    console.debug(`[render] ${label} #${count.current}`);
  });
}

/**
 * Dev-only: log which prop changed between renders. Use to figure out
 * why a memoized component is re-rendering. Logs `[memo:<label>] <key>
 * changed` for each prop whose identity differs from the previous
 * render. Add at the top of a component's body.
 */
export function useDevPropDiff<T extends Record<string, unknown>>(props: T, label: string): void {
  const prevRef = useRef<T | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (prevRef.current !== null) {
      const prev = prevRef.current;
      const keys = new Set([...Object.keys(prev), ...Object.keys(props)]);
      for (const key of keys) {
        if (!Object.is(prev[key as keyof T], props[key as keyof T])) {
          console.debug(`[memo:${label}] ${String(key)} changed`);
        }
      }
    }
    prevRef.current = props;
  });
}

/**
 * Opt-in render-duration mark. Sets a `<prefix><label>:start:N` mark in the
 * render body and a matching `:end:N` in useLayoutEffect (runs synchronously
 * after commit, before paint) when `VITE_RYCO_PERF_PROFILE=1`. The N-suffix
 * avoids the "latest-mark wins" problem when a component re-renders multiple
 * times during a single interaction. Inspect via:
 *
 *   performance.getEntriesByType("measure")
 *     .filter(m => m.name.startsWith("ryco:render:"))
 */
export function usePerfMark(label: string): void {
  const seq = useRef(0);
  const startedAtRef = useRef(0);
  const perfEnabled = isWebPerfProfileEnabled();
  if (perfEnabled) {
    seq.current += 1;
    startedAtRef.current = readWebPerfNow();
    if (typeof performance !== "undefined") {
      performance.mark(`${COMPONENT_RENDER_MARK_PREFIX}${label}:start:${seq.current}`);
    }
  }
  useLayoutEffect(() => {
    if (!perfEnabled) return;
    getWebPerfReporter(`web.render.${label}`).record({
      durationMs: Math.max(0, readWebPerfNow() - startedAtRef.current),
    });
    if (typeof performance === "undefined") return;
    const i = seq.current;
    const startName = `${COMPONENT_RENDER_MARK_PREFIX}${label}:start:${i}`;
    const endName = `${COMPONENT_RENDER_MARK_PREFIX}${label}:end:${i}`;
    performance.mark(endName);
    try {
      performance.measure(`${COMPONENT_RENDER_MARK_PREFIX}${label}#${i}`, startName, endName);
    } catch {
      // Ignore — start mark may have been cleared.
    }
  });
}

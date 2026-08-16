import type { CSSProperties } from "react";

export const PREFERS_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const DEFAULT_INACTIVE_PANEL_CONTAIN_INTRINSIC_SIZE = "1px 100vh";
export const DOCUMENT_MOTION_PAUSED_ATTRIBUTE = "data-ryco-motion-paused";

interface MotionVisibilityDocument {
  readonly visibilityState: DocumentVisibilityState;
  readonly documentElement: Pick<HTMLElement, "toggleAttribute">;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function syncDocumentMotionVisibility(
  documentTarget: MotionVisibilityDocument = document,
): () => void {
  const sync = () => {
    documentTarget.documentElement.toggleAttribute(
      DOCUMENT_MOTION_PAUSED_ATTRIBUTE,
      documentTarget.visibilityState === "hidden",
    );
  };
  sync();
  documentTarget.addEventListener("visibilitychange", sync);
  return () => documentTarget.removeEventListener("visibilitychange", sync);
}

export type InactivePanelContentVisibilityStyle = CSSProperties & {
  contentVisibility: "hidden";
  containIntrinsicSize: string;
};

export function shouldEnableAutoAnimate(input: {
  prefersReducedMotion: boolean;
  withinThreshold: boolean;
}): boolean {
  return input.withinThreshold && !input.prefersReducedMotion;
}

export function resolveInactivePanelContentVisibilityStyle(input: {
  active: boolean;
  containIntrinsicSize?: string | undefined;
}): InactivePanelContentVisibilityStyle | undefined {
  if (input.active) {
    return undefined;
  }

  return {
    contentVisibility: "hidden",
    containIntrinsicSize:
      input.containIntrinsicSize ?? DEFAULT_INACTIVE_PANEL_CONTAIN_INTRINSIC_SIZE,
  };
}

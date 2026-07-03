import { BrowserWindow, screen } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  DesktopBrowserSurfaceAttachInput as DesktopBrowserSurfaceAttachInputSchema,
  DesktopBrowserSurfaceDetachInput as DesktopBrowserSurfaceDetachInputSchema,
  DesktopBrowserSurfaceFocusInput as DesktopBrowserSurfaceFocusInputSchema,
  DesktopBrowserSurfaceUpdateInput as DesktopBrowserSurfaceUpdateInputSchema,
  type DesktopBrowserSurfaceAttachInput,
  type DesktopBrowserSurfaceBounds,
  type DesktopBrowserSurfaceDetachInput,
  type DesktopBrowserSurfaceFocusInput,
  type DesktopBrowserSurfaceUpdateInput,
} from "@ryco/contracts";
import { Schema } from "effect";

import { resolveElectronSurfaceBounds } from "@ryco/shared/browser";

import { BrowserKernel } from "./BrowserKernel.ts";

const decodeAttachInput = Schema.decodeUnknownSync(DesktopBrowserSurfaceAttachInputSchema);
const decodeUpdateInput = Schema.decodeUnknownSync(DesktopBrowserSurfaceUpdateInputSchema);
const decodeDetachInput = Schema.decodeUnknownSync(DesktopBrowserSurfaceDetachInputSchema);
const decodeFocusInput = Schema.decodeUnknownSync(DesktopBrowserSurfaceFocusInputSchema);

function decodeSurfaceInput<A>(decode: (input: unknown) => A, input: unknown): A | null {
  try {
    return decode(input);
  } catch {
    return null;
  }
}

function validBounds(bounds: DesktopBrowserSurfaceBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

function nativeDeviceScaleFactor(
  window: BrowserWindow,
  bounds: DesktopBrowserSurfaceBounds,
): number {
  try {
    return screen.getDisplayMatching(window.getBounds()).scaleFactor || 1;
  } catch {
    return bounds.deviceScaleFactor ?? 1;
  }
}

function clippedBounds(window: BrowserWindow, bounds: DesktopBrowserSurfaceBounds) {
  const resolved = resolveElectronSurfaceBounds(bounds, nativeDeviceScaleFactor(window, bounds));
  if (!resolved) {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    };
  }

  const content = window.getContentBounds();
  const x = Math.max(0, Math.min(resolved.x, content.width));
  const y = Math.max(0, Math.min(resolved.y, content.height));
  const maxWidth = Math.max(0, content.width - x);
  const maxHeight = Math.max(0, content.height - y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(resolved.width, maxWidth)),
    height: Math.max(1, Math.min(resolved.height, maxHeight)),
  };
}

export class BrowserSurfaceManager {
  private readonly attached = new Map<string, BrowserWindow>();
  private readonly kernel: BrowserKernel;

  constructor(kernel: BrowserKernel) {
    this.kernel = kernel;
  }

  attach(event: IpcMainInvokeEvent, unsafeInput: unknown): boolean {
    const input = decodeSurfaceInput<DesktopBrowserSurfaceAttachInput>(
      decodeAttachInput,
      unsafeInput,
    );
    if (!input) return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || !validBounds(input.bounds)) return false;
    const view = this.kernel.getView(input.sessionId, input.tabId);
    if (!view) return false;

    const key = this.key(input.sessionId, input.tabId);
    const currentWindow = this.attached.get(key);
    if (currentWindow && currentWindow !== window && !currentWindow.isDestroyed()) {
      currentWindow.contentView.removeChildView(view);
    }
    if (currentWindow !== window) {
      window.contentView.addChildView(view);
    }
    view.setBounds(clippedBounds(window, input.bounds));
    this.attached.set(key, window);
    return true;
  }

  update(event: IpcMainInvokeEvent, unsafeInput: unknown): boolean {
    const input = decodeSurfaceInput<DesktopBrowserSurfaceUpdateInput>(
      decodeUpdateInput,
      unsafeInput,
    );
    if (!input) return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || !validBounds(input.bounds)) return false;
    const view = this.kernel.getView(input.sessionId, input.tabId);
    if (!view) return false;
    const attachedWindow = this.attached.get(this.key(input.sessionId, input.tabId));
    if (attachedWindow !== window) return this.attach(event, input);
    view.setBounds(clippedBounds(window, input.bounds));
    return true;
  }

  detach(event: IpcMainInvokeEvent, unsafeInput: unknown): void {
    const input = decodeSurfaceInput<DesktopBrowserSurfaceDetachInput>(
      decodeDetachInput,
      unsafeInput,
    );
    if (!input) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    const view = this.kernel.getView(input.sessionId, input.tabId);
    if (!window || !view) return;
    const key = this.key(input.sessionId, input.tabId);
    if (this.attached.get(key) === window) {
      window.contentView.removeChildView(view);
      this.attached.delete(key);
    }
  }

  focus(_event: IpcMainInvokeEvent, unsafeInput: unknown): boolean {
    const input = decodeSurfaceInput<DesktopBrowserSurfaceFocusInput>(
      decodeFocusInput,
      unsafeInput,
    );
    if (!input) return false;
    const view = this.kernel.getView(input.sessionId, input.tabId);
    if (!view) return false;
    view.webContents.focus();
    return true;
  }

  detachAllForWindow(window: BrowserWindow): void {
    for (const [key, attachedWindow] of this.attached.entries()) {
      if (attachedWindow === window) {
        this.attached.delete(key);
      }
    }
  }

  private key(sessionId: string, tabId: string): string {
    return `${sessionId}:${tabId}`;
  }
}

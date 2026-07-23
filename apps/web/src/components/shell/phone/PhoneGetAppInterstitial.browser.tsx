import "../../../index.css";

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  cdpSession,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../../../test/browserPointer";
import { PhoneGetAppInterstitial } from "./PhoneGetAppInterstitial";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
const APP_URL = "https://example.com/ryco";

function InterstitialHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button">Host probe</button>
      {open ? <PhoneGetAppInterstitial appUrl={APP_URL} onDismiss={() => setOpen(false)} /> : null}
    </>
  );
}

function rootContainer(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  return root;
}

describe("PhoneGetAppInterstitial", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  beforeEach(async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "" }],
    });
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("makes the mounted host inert until dismissal", async () => {
    const root = rootContainer();
    mounted = await render(<InterstitialHarness />, { container: root });

    const host = root.querySelector<HTMLButtonElement>("button")!;
    const dialog = page.getByRole("dialog", { name: "Ryco is better as an app" });
    await expect.element(dialog).toBeVisible();
    expect(root.hasAttribute("inert")).toBe(true);
    expect(
      dialog
        .element()
        .contains(document.elementFromPoint(PHONE_VIEWPORT.width / 2, PHONE_VIEWPORT.height / 2)),
    ).toBe(true);
    host.focus();
    expect(document.activeElement).not.toBe(host);
    expect(dialog.element().contains(document.activeElement)).toBe(true);

    await page.getByRole("button", { name: "Continue in browser" }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(root.hasAttribute("inert")).toBe(false);
    host.focus();
    expect(document.activeElement).toBe(host);
  });

  it("links to the configured app URL", async () => {
    mounted = await render(<PhoneGetAppInterstitial appUrl={APP_URL} onDismiss={() => {}} />, {
      container: rootContainer(),
    });

    const link = page.getByRole("link", { name: "Get the app" }).element() as HTMLAnchorElement;
    expect(link.href).toBe(APP_URL);
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
  });

  it("traps focus, dismisses with Escape, and honors phone accessibility constraints", async () => {
    const onDismiss = vi.fn();
    mounted = await render(<PhoneGetAppInterstitial appUrl={APP_URL} onDismiss={onDismiss} />, {
      container: rootContainer(),
    });

    const dialog = page.getByRole("dialog", { name: "Ryco is better as an app" }).element();
    const getApp = page.getByRole("link", { name: "Get the app" }).element();
    const continueInBrowser = page.getByRole("button", { name: "Continue in browser" }).element();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("phone-get-app-interstitial-heading");
    await vi.waitFor(() => expect(document.activeElement).toBe(getApp));

    continueInBrowser.focus();
    continueInBrowser.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(getApp);

    getApp.focus();
    getApp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(continueInBrowser);
    expect(getApp.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(continueInBrowser.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await vi.waitFor(() => {
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    });
    expect(getComputedStyle(dialog).transitionProperty).toBe("none");

    getApp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

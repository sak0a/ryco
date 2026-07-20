import "../../index.css";

import { page } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import type { HostedPwaLifecycle, HostedPwaSnapshot } from "../../pwa/lifecycle";
import { HostedPwaControls } from "./HostedPwaControls";
import { HOSTED_RELAY_TRUST_DISCLOSURE } from "./HostedRelayTrustNotice";

function lifecycle(snapshot: HostedPwaSnapshot): HostedPwaLifecycle {
  return {
    activateUpdate: vi.fn(),
    dismissInstall: vi.fn(),
    getSnapshot: () => snapshot,
    promptInstall: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    subscribe: () => () => undefined,
  };
}

const baseSnapshot: HostedPwaSnapshot = {
  errorMessage: null,
  installState: "manual-available",
  platform: "ios",
  registrationState: "ready",
  updateState: "idle",
};

describe("HostedPwaControls", () => {
  it("shows iOS installation steps and the relay trust boundary", async () => {
    render(<HostedPwaControls lifecycle={lifecycle(baseSnapshot)} />);
    await page.getByRole("button", { name: "How to install" }).click();

    await expect.element(page.getByText(/Add to Home Screen/)).toBeVisible();
    await expect.element(page.getByText(HOSTED_RELAY_TRUST_DISCLOSURE)).toBeVisible();
    await page.getByRole("button", { name: "Close install instructions" }).click();
    await expect.element(page.getByText(/Add to Home Screen/)).not.toBeInTheDocument();
  });

  it("invokes the browser-owned native prompt", async () => {
    const native = lifecycle({
      ...baseSnapshot,
      installState: "native-available",
      platform: "other",
    });
    render(<HostedPwaControls lifecycle={native} />);

    await page.getByRole("button", { name: "Install Ryco" }).click();
    expect(native.promptInstall).toHaveBeenCalledOnce();
  });

  it("hides install guidance in standalone mode", async () => {
    render(
      <HostedPwaControls lifecycle={lifecycle({ ...baseSnapshot, installState: "installed" })} />,
    );
    await expect
      .element(page.getByRole("region", { name: "Ryco app installation" }))
      .not.toBeInTheDocument();
  });

  it("activates a waiting update only from the explicit action", async () => {
    const update = lifecycle({ ...baseSnapshot, installState: "installed", updateState: "ready" });
    render(<HostedPwaControls lifecycle={update} />);

    expect(update.activateUpdate).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Update ready" }).click();
    expect(update.activateUpdate).toHaveBeenCalledOnce();
  });
});

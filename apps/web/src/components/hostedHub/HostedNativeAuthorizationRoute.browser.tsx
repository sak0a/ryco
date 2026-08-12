import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { hostedHubApi } from "../../hostedHub/api";
import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import { HostedNativeAuthorizationRoute } from "./HostedNativeAuthorizationRoute";

const account = {
  id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1,
  disabledAt: null,
};
const session = {
  id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
  accountId: account.id,
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
};
const handoffId = "H".repeat(43);
const state = "S".repeat(43);
const code = "C".repeat(43);

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  hostedHubController.resetForTests();
  useHostedHubStore.setState({
    accountStatus: "authenticated",
    account,
    session,
  });
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  hostedHubController.resetForTests();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("HostedNativeAuthorizationRoute", () => {
  it("requires recovery-code acknowledgement before device consent", async () => {
    const recoveryCode = "recovery-native-authorization-canary";
    useHostedHubStore.setState({ recoveryCodes: [recoveryCode] });
    vi.spyOn(hostedHubApi, "getNativeHandoffPresentation").mockResolvedValue({
      status: "pending",
      deviceLabel: "Phone",
      expiresAt: Date.now() + 60_000,
    });
    const approve = vi.spyOn(hostedHubApi, "approveNativeHandoff");
    const cancel = vi.spyOn(hostedHubApi, "cancelNativeHandoff");
    const navigate = vi.fn();

    mounted = await render(
      <HostedNativeAuthorizationRoute handoffId={handoffId} navigate={navigate} />,
    );

    await expect
      .element(page.getByRole("heading", { name: "Save your recovery codes" }))
      .toBeVisible();
    await expect.element(page.getByText(recoveryCode)).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Continue on this device?" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Continue as Ada" }))
      .not.toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "I saved the codes" }).click();

    await expect
      .element(page.getByRole("heading", { name: "Continue on this device?" }))
      .toBeVisible();
    await expect.element(page.getByText(recoveryCode)).not.toBeInTheDocument();
    expect(useHostedHubStore.getState().recoveryCodes).toEqual([]);
    expect(approve).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("requires explicit consent and shows the exact account and requesting device", async () => {
    vi.spyOn(hostedHubApi, "getNativeHandoffPresentation").mockResolvedValue({
      status: "pending",
      deviceLabel: "Laurin’s iPhone",
      expiresAt: Date.now() + 60_000,
    });
    const approve = vi.spyOn(hostedHubApi, "approveNativeHandoff").mockResolvedValue({
      redirectUri: `ryco-dev://hosted/complete?code=${code}&state=${state}&handoff_id=${handoffId}`,
    });
    const navigate = vi.fn();

    mounted = await render(
      <HostedNativeAuthorizationRoute handoffId={handoffId} navigate={navigate} />,
    );

    await expect
      .element(page.getByRole("heading", { name: "Continue on this device?" }))
      .toBeVisible();
    await expect.element(page.getByText("Laurin’s iPhone")).toBeVisible();
    await expect.element(page.getByText("Ada", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Continue as Ada" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Use another account" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(approve).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Continue as Ada" }).click();

    expect(approve).toHaveBeenCalledWith(handoffId);
    expect(navigate).toHaveBeenCalledWith(
      `ryco-dev://hosted/complete?code=${code}&state=${state}&handoff_id=${handoffId}`,
    );
  });

  it("returns the bounded cancellation callback and supports account switching", async () => {
    vi.spyOn(hostedHubApi, "getNativeHandoffPresentation").mockResolvedValue({
      status: "pending",
      deviceLabel: "Phone",
      expiresAt: Date.now() + 60_000,
    });
    const cancel = vi.spyOn(hostedHubApi, "cancelNativeHandoff").mockResolvedValue({
      redirectUri: `ryco-dev://hosted/complete?error=access_denied&state=${state}&handoff_id=${handoffId}`,
    });
    const navigate = vi.fn();
    const signOut = vi.spyOn(hostedHubController, "signOut").mockResolvedValue();
    mounted = await render(
      <HostedNativeAuthorizationRoute handoffId={handoffId} navigate={navigate} />,
    );
    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeEnabled();

    await page.getByRole("button", { name: "Cancel" }).click();
    expect(cancel).toHaveBeenCalledWith(handoffId);
    expect(navigate).toHaveBeenCalledOnce();

    await page.getByRole("button", { name: "Use another account" }).click();
    expect(signOut).toHaveBeenCalledOnce();
  });
});

import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { hostedHubApi } from "../../hostedHub/api";
import {
  hostedHubController,
  useHostedAccountStore,
  useHostedHubStore,
} from "../../hostedHub/state";
import { resetHubRoutesForTests } from "../../hostedHub/hubRoutes";
import { HostedAuthenticationSurface } from "./HostedHubRoot";
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
  resetHubRoutesForTests();
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
  resetHubRoutesForTests();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("HostedNativeAuthorizationRoute", () => {
  it("automatically starts a hinted GitHub sign-in from the same-origin handoff route", async () => {
    window.history.replaceState(null, "", `/native/authorize/${handoffId}`);
    useHostedHubStore.setState({
      accountStatus: "signed-out",
      account: null,
      session: null,
    });
    useHostedAccountStore.setState({
      externalIdentityConfiguration: {
        version: 1,
        providers: [{ provider: "github", login: true, signup: true, link: true }],
      },
      externalIdentityConfigurationStatus: "ready",
    });
    vi.spyOn(hostedHubApi, "getPendingExternalIdentity").mockResolvedValue({ status: "none" });
    vi.spyOn(hostedHubController, "refreshExternalIdentityConfiguration").mockResolvedValue();
    const start = vi
      .spyOn(hostedHubApi, "startExternalIdentityAuthorization")
      .mockImplementation(() => new Promise(() => {}));

    mounted = await render(
      <HostedAuthenticationSurface context="native-authorization" autoExternalProvider="github" />,
    );

    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        provider: "github",
        intent: "authenticate",
        returnTo: `/native/authorize/${handoffId}`,
      });
    });
  });

  it("finishes an unlinked GitHub signup without leaving native authorization", async () => {
    window.history.replaceState(null, "", `/native/authorize/${handoffId}`);
    useHostedHubStore.setState({
      accountStatus: "signed-out",
      account: null,
      session: null,
    });
    vi.spyOn(hostedHubApi, "getNativeHandoffPresentation").mockResolvedValue({
      status: "pending",
      deviceLabel: "Laurin’s iPhone",
      expiresAt: Date.now() + 60_000,
    });
    vi.spyOn(hostedHubApi, "getPublicSignupConfiguration").mockResolvedValue({
      status: "enabled",
      antiBot: { provider: "bypass" },
    });
    vi.spyOn(hostedHubApi, "getPendingExternalIdentity").mockResolvedValue({
      status: "signup",
      provider: "github",
      suggestedUsername: "octocat",
      displayName: "The Octocat",
      expiresAt: Date.now() + 60_000,
    } as never);
    vi.spyOn(hostedHubController, "refreshExternalIdentityConfiguration").mockResolvedValue();
    const finish = vi.spyOn(hostedHubApi, "finishExternalIdentitySignup").mockResolvedValue({
      status: "complete",
      identity: {
        account: { ...account, username: "octocat" },
        session: { ...session, activeSpaceId: "space_aaaaaaaaaaaaaaaaaaaaaa" },
        activeSpace: {
          id: "space_aaaaaaaaaaaaaaaaaaaaaa",
          kind: "personal",
          displayName: "Octocat's space",
          role: "owner",
        },
        spaces: [],
        csrfToken: "csrf-native-signup",
      } as never,
      recoveryCodes: ["recovery-one"],
    });
    const adopt = vi.spyOn(hostedHubController, "adoptPublicBrowserIdentity").mockResolvedValue();

    mounted = await render(<HostedNativeAuthorizationRoute handoffId={handoffId} />);

    await expect.element(page.getByText("GitHub verified")).toBeVisible();
    await expect.element(page.getByLabelText("Username")).toHaveValue("octocat");
    await page.getByRole("button", { name: "Create account with GitHub" }).click();

    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        username: "octocat",
        antiBotAssertion: "development",
      }),
    );
    expect(adopt).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe(`/native/authorize/${handoffId}`);
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

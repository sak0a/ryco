import { describe, expect, it, vi } from "vite-plus/test";

import {
  beginGitHubAuthorization,
  externalIdentityPendingErrorMessage,
  githubProviderPolicy,
} from "./ExternalIdentityWeb.logic";

describe("external identity web decisions", () => {
  it("advertises GitHub only when the strict provider policy contains it", () => {
    expect(githubProviderPolicy({ version: 1, providers: [] })).toBeNull();
    expect(
      githubProviderPolicy({
        version: 1,
        providers: [{ provider: "github", login: true, signup: false, link: true }],
      }),
    ).toEqual({ provider: "github", login: true, signup: false, link: true });
  });

  it("navigates only to the URL returned by the strict shared runtime", async () => {
    const navigate = vi.fn();
    const start = vi.fn(async () => ({
      authorizationUrl: "https://github.com/login/oauth/authorize?client_id=client&state=opaque",
      expiresAt: 2,
    }));

    await beginGitHubAuthorization({ intent: "authenticate", returnTo: "/nodes", start, navigate });

    expect(start).toHaveBeenCalledWith({
      provider: "github",
      intent: "authenticate",
      returnTo: "/nodes",
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://github.com/login/oauth/authorize?client_id=client&state=opaque",
    );

    const rejectedNavigation = vi.fn();
    await expect(
      beginGitHubAuthorization({
        intent: "link",
        returnTo: "/account/security",
        start: vi.fn(async () => {
          throw new Error("invalid response");
        }),
        navigate: rejectedNavigation,
      }),
    ).rejects.toThrow("invalid response");
    expect(rejectedNavigation).not.toHaveBeenCalled();
  });

  it("maps callback codes to bounded copy without provider prose", () => {
    expect(externalIdentityPendingErrorMessage("external_identity_email_conflict")).toContain(
      "Sign in another way",
    );
    expect(externalIdentityPendingErrorMessage("signup_disabled")).toContain("signup is closed");
    expect(externalIdentityPendingErrorMessage("external_authorization_cancelled")).toBe(
      "GitHub authorization was cancelled.",
    );
  });
});

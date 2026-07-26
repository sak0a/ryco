import { describe, expect, it } from "vite-plus/test";

import {
  MVP_ROOT_ROUTES,
  MVP_SETTINGS_SHEET_ROUTES,
  WORKSPACE_OVERLAY_ROUTE_NAMES,
  type MvpRootRouteName,
} from "./mvpRouteConfig";

describe("MVP route config", () => {
  it("registers exactly the MVP root route set plus the NotFound catch-all", () => {
    expect(Object.keys(MVP_ROOT_ROUTES).sort()).toEqual(
      [
        "Connections",
        "ConnectionsNew",
        "Home",
        "NotFound",
        "Onboarding",
        "SettingsSheet",
        "Thread",
        "ThreadReview",
        "ThreadReviewComment",
      ].sort(),
    );
    // Deferred routes must be absent from the tree.
    for (const absent of [
      "ThreadTerminal",
      "ThreadFiles",
      "ThreadFile",
      "GitOverview",
      "NewTaskSheet",
      "SettingsLegal",
      "ConnectOnboarding",
      "SettingsArchive",
    ]) {
      expect(absent in MVP_ROOT_ROUTES).toBe(false);
    }
  });

  it("uses the exact MVP linking path strings", () => {
    expect(MVP_ROOT_ROUTES.Home.linking).toBe("");
    expect(MVP_ROOT_ROUTES.Thread.linking).toBe("threads/:environmentId/:threadId");
    expect(MVP_ROOT_ROUTES.ThreadReview.linking).toBe("threads/:environmentId/:threadId/review");
    expect(MVP_ROOT_ROUTES.ThreadReviewComment.linking).toBe(
      "threads/:environmentId/:threadId/review-comment",
    );
    expect(MVP_ROOT_ROUTES.Connections.linking).toBe("connections");
    expect(MVP_ROOT_ROUTES.ConnectionsNew.linking).toBe("connections/new");
    expect(MVP_ROOT_ROUTES.SettingsSheet.linking).toBe("settings");
    expect(MVP_ROOT_ROUTES.Onboarding.linking).toBe("onboarding");
    // NotFound is the sanctioned deep-link catch-all.
    expect(MVP_ROOT_ROUTES.NotFound.linking).toBe("*");
  });

  it("keeps the Thread route flat in the root tree (not nested)", () => {
    // A flat Thread route is required for the iOS-26 shared-header morph; the
    // nested settings routes are the only nested tree.
    expect("Thread" in MVP_ROOT_ROUTES).toBe(true);
    expect("Thread" in MVP_SETTINGS_SHEET_ROUTES).toBe(false);
  });

  it("presents the review-comment sheet with detents on iOS and fullScreenModal on Android", () => {
    const route = MVP_ROOT_ROUTES.ThreadReviewComment;
    expect(route.ios.presentation).toBe("formSheet");
    expect(route.ios.sheetAllowedDetents).toEqual([0.55, 0.92]);
    expect(route.ios.sheetGrabberVisible).toBe(true);
    expect(route.android.presentation).toBe("fullScreenModal");
    // Grabber is non-Android only.
    expect(route.android.sheetGrabberVisible).toBe(false);
  });

  it("marks every sheet/overlay route so it is excluded from the workspace pathname", () => {
    const overlays = new Set<MvpRootRouteName>(WORKSPACE_OVERLAY_ROUTE_NAMES);
    // Sheets over the workspace.
    for (const overlay of [
      "Connections",
      "ConnectionsNew",
      "ThreadReviewComment",
      "Onboarding",
    ] as const) {
      expect(overlays.has(overlay)).toBe(true);
    }
    // The workspace routes themselves are never overlays.
    for (const workspace of [
      "Home",
      "Thread",
      "ThreadReview",
      "SettingsSheet",
      "NotFound",
    ] as const) {
      expect(overlays.has(workspace)).toBe(false);
    }
  });

  it("presents Settings as a full-screen card instead of a form sheet", () => {
    expect(MVP_ROOT_ROUTES.SettingsSheet.overlay).toBe(false);
    expect(MVP_ROOT_ROUTES.SettingsSheet.ios.presentation).toBe("card");
    expect("sheetAllowedDetents" in MVP_ROOT_ROUTES.SettingsSheet.ios).toBe(false);
    expect(MVP_ROOT_ROUTES.SettingsSheet.android.presentation).toBe("card");
  });

  it("keeps ConnectionsNew a card (deliberate divergence from upstream's formSheet)", () => {
    expect(MVP_ROOT_ROUTES.ConnectionsNew.ios.presentation).toBe("card");
    expect(MVP_ROOT_ROUTES.ConnectionsNew.android.presentation).toBe("card");
  });

  it("nests the MVP settings sub-routes with their linking paths", () => {
    expect(Object.keys(MVP_SETTINGS_SHEET_ROUTES).sort()).toEqual(
      [
        "Settings",
        "SettingsAccount",
        "SettingsAbout",
        "SettingsAppearance",
        "SettingsClientStorage",
        "SettingsHub",
        "SettingsWorkspace",
      ].sort(),
    );
    expect(MVP_SETTINGS_SHEET_ROUTES.SettingsHub.linking).toBe("hub");
    expect(MVP_SETTINGS_SHEET_ROUTES.SettingsWorkspace.linking).toBe("workspace");
    expect(MVP_SETTINGS_SHEET_ROUTES.SettingsAppearance.linking).toBe("appearance");
    // The hosted Hub account is the ONLY route the hosted plane adds, and it is
    // nested: the root route set above is unchanged by hosted mode.
    expect(MVP_SETTINGS_SHEET_ROUTES.SettingsAccount.linking).toBe("account");
    expect("HostedSignIn" in MVP_ROOT_ROUTES).toBe(false);
    expect("SettingsAccount" in MVP_ROOT_ROUTES).toBe(false);
  });
});

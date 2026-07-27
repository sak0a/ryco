import { describe, expect, it } from "vite-plus/test";

import {
  MVP_ROOT_ROUTES,
  MVP_SETTINGS_SHEET_ROUTES,
  WORKSPACE_OVERLAY_ROUTE_NAMES,
  type MvpRootRouteName,
} from "./mvpRouteConfig";

describe("MVP route config", () => {
  it("registers exactly the MVP root route set plus the NotFound catch-all", () => {
    expect(Object.keys(MVP_ROOT_ROUTES).toSorted()).toEqual(
      [
        "AddProject",
        "Connections",
        "ConnectionsNew",
        "Home",
        "NewTask",
        "NotFound",
        "Onboarding",
        "Project",
        "SettingsSheet",
        "Thread",
        "ThreadReview",
        "ThreadReviewComment",
      ].toSorted(),
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
    expect(MVP_ROOT_ROUTES.AddProject.linking).toBe("projects/new");
    expect(MVP_ROOT_ROUTES.Project.linking).toBe("projects/:environmentId/:projectId");
    expect(MVP_ROOT_ROUTES.NewTask.linking).toBe("tasks/new");
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
      "AddProject",
      "ThreadReviewComment",
      "Onboarding",
      "SettingsSheet",
    ] as const) {
      expect(overlays.has(overlay)).toBe(true);
    }
    // The workspace routes themselves are never overlays.
    for (const workspace of [
      "Home",
      "NewTask",
      "Project",
      "Thread",
      "ThreadReview",
      "NotFound",
    ] as const) {
      expect(overlays.has(workspace)).toBe(false);
    }
  });

  it("presents Settings as a large iOS form sheet that floats over the workspace", () => {
    expect(MVP_ROOT_ROUTES.SettingsSheet.overlay).toBe(true);
    expect(MVP_ROOT_ROUTES.SettingsSheet.ios.presentation).toBe("formSheet");
    expect(MVP_ROOT_ROUTES.SettingsSheet.ios.sheetAllowedDetents).toEqual([0.95]);
    expect(MVP_ROOT_ROUTES.SettingsSheet.ios.sheetGrabberVisible).toBe(true);
    // Android keeps the card: a nested stack inside an Android form sheet is
    // unverified and there is no Android QA yet.
    expect(MVP_ROOT_ROUTES.SettingsSheet.android.presentation).toBe("card");
  });

  it("presents Add Project as a workspace overlay and Project as a push", () => {
    expect(MVP_ROOT_ROUTES.AddProject.ios.presentation).toBe("formSheet");
    expect(MVP_ROOT_ROUTES.AddProject.ios.sheetAllowedDetents).toEqual([0.7, 0.95]);
    expect(MVP_ROOT_ROUTES.Project.ios.presentation).toBe("card");
  });

  it("keeps ConnectionsNew a card (deliberate divergence from upstream's formSheet)", () => {
    expect(MVP_ROOT_ROUTES.ConnectionsNew.ios.presentation).toBe("card");
    expect(MVP_ROOT_ROUTES.ConnectionsNew.android.presentation).toBe("card");
  });

  it("nests the MVP settings sub-routes with their linking paths", () => {
    expect(Object.keys(MVP_SETTINGS_SHEET_ROUTES).toSorted()).toEqual(
      [
        "Settings",
        "SettingsAccount",
        "SettingsAbout",
        "SettingsAppearance",
        "SettingsClientStorage",
        "SettingsHub",
        "SettingsWorkspace",
      ].toSorted(),
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

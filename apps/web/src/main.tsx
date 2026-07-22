import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron, isHostedHubMode } from "./env";
import { installHostedNodeHistory } from "./hostedHub/nodeRoutes";
import { hostedPwaLifecycle } from "./pwa/lifecycle";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { syncDocumentPresentationTier } from "./lib/presentationTier";
import { syncDocumentVisualViewportInsets } from "./lib/visualViewportInsets";
import { syncAppearancePreferenceEnvironment } from "./themes/appearancePreferences";
import { syncDocumentWindowControlsOverlayClass } from "./lib/windowControlsOverlay";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
// Hosted-hub builds scope browser URLs under the selected node's stable route
// segment while the logical route tree stays shared; other modes are untouched.
const history = isElectron
  ? createHashHistory()
  : isHostedHubMode()
    ? installHostedNodeHistory()
    : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();
}

// The single presentation-tier classification: stamps data-tier on the root
// element so tier-critical CSS and JS agree everywhere, including the hosted
// root and /pair subtrees.
syncDocumentPresentationTier();

// The single VisualViewport subscription: publishes bounded keyboard-inset CSS
// variables that phone input surfaces consume from CSS only.
syncDocumentVisualViewportInsets();

// Reapplies the appearance variables when an environment input that feeds the
// effective preferences changes — the presentation tier, reduced transparency,
// reduced motion — without ever writing a stored value.
syncAppearancePreferenceEnvironment();

document.title = APP_DISPLAY_NAME;

if (hostedPwaLifecycle) {
  void hostedPwaLifecycle.start({ enabled: import.meta.env.PROD && isHostedHubMode() });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

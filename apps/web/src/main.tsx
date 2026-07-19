import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron, isHostedHubMode } from "./env";
import { hostedPwaLifecycle } from "./pwa/lifecycle";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { syncDocumentWindowControlsOverlayClass } from "./lib/windowControlsOverlay";

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentWindowControlsOverlayClass();
}

document.title = APP_DISPLAY_NAME;

if (hostedPwaLifecycle) {
  void hostedPwaLifecycle.start({ enabled: import.meta.env.PROD && isHostedHubMode() });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

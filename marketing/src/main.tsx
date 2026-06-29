import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, ScrollRestoration, Outlet } from "react-router-dom";
import "./index.css";

// Focused on the "Kinetic" direction (v4). The other five directions live in
// the gitignored .archive/versions/ — move a folder back into src/versions and
// re-add a route here to bring one back. They still reference the shared @/ modules.
const Version4 = lazy(() => import("@/versions/v4/Version4"));

function Shell() {
  return (
    <>
      <ScrollRestoration />
      <Suspense
        fallback={
          <div className="grid min-h-screen place-items-center text-sm text-white/40">Loading…</div>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Version4 /> },
      { path: "/4", element: <Version4 /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

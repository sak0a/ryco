import { EnvironmentId, type FilesystemBrowseResult } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  api: null as null | {
    readonly filesystem: {
      readonly browse: (input: { readonly partialPath: string }) => Promise<FilesystemBrowseResult>;
    };
  },
  connection: null as null | { readonly environmentId: string },
  listeners: new Set<() => void>(),
}));

vi.mock("~/environmentApi", () => ({
  ensureEnvironmentApi: () => {
    throw new Error("not used by filesystem browse");
  },
  readEnvironmentApi: () => harness.api ?? undefined,
}));

vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: (environmentId: string) =>
    harness.connection?.environmentId === environmentId ? harness.connection : null,
  subscribeEnvironmentConnections: (listener: () => void) => {
    harness.listeners.add(listener);
    return () => harness.listeners.delete(listener);
  },
}));

import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../rpc/atomRegistry";
import { resetProjectAtomsForTests } from "../rpc/projectAtoms";
import { useFilesystemBrowse } from "../rpc/useProject";

const ENVIRONMENT_ID = EnvironmentId.make("environment-hosted");

function BrowseProbe() {
  const state = useFilesystemBrowse({
    environmentId: ENVIRONMENT_ID,
    partialPath: "~/",
  });
  return (
    <div data-testid="browse-state">
      {state.error ? state.error.message : (state.data?.parentPath ?? "pending")}
    </div>
  );
}

function publishConnection(connection: typeof harness.connection): void {
  harness.connection = connection;
  for (const listener of harness.listeners) listener();
}

beforeEach(() => {
  harness.api = null;
  harness.connection = null;
  harness.listeners.clear();
  resetProjectAtomsForTests();
  resetAppAtomRegistryForTests();
});

afterEach(() => {
  harness.api = null;
  harness.connection = null;
  harness.listeners.clear();
  resetProjectAtomsForTests();
  resetAppAtomRegistryForTests();
});

describe("useFilesystemBrowse", () => {
  it("retries the same path when its environment connection appears", async () => {
    const browse = vi.fn().mockResolvedValue({
      parentPath: "~/",
      entries: [{ name: "Development", fullPath: "~/Development" }],
    });
    const mounted = await render(
      <AppAtomRegistryProvider>
        <BrowseProbe />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByTestId("browse-state"))
      .toHaveTextContent("temporarily unavailable");

    harness.api = { filesystem: { browse } };
    publishConnection({ environmentId: ENVIRONMENT_ID });

    await expect.element(page.getByTestId("browse-state")).toHaveTextContent("~/");
    expect(browse).toHaveBeenCalledOnce();
    expect(browse).toHaveBeenCalledWith({ partialPath: "~/" });

    await mounted.unmount();
  });
});

import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopDataHomes } from "./desktopDataHomes.ts";

describe("Desktop data homes", () => {
  it("keeps production shell and backend state together", () => {
    expect(
      resolveDesktopDataHomes({
        configuredBaseDir: undefined,
        defaultBaseDir: "/home/ada/.ryco",
        isDevelopment: false,
      }),
    ).toEqual({
      backendBaseDir: "/home/ada/.ryco",
      desktopBaseDir: "/home/ada/.ryco",
    });
  });

  it("isolates only the Desktop Dev shell from the existing backend catalog", () => {
    expect(
      resolveDesktopDataHomes({
        configuredBaseDir: undefined,
        defaultBaseDir: "/home/ada/.ryco",
        isDevelopment: true,
      }),
    ).toEqual({
      backendBaseDir: "/home/ada/.ryco",
      desktopBaseDir: "/home/ada/.ryco/desktop-dev",
    });
  });

  it("derives both homes from an explicit base directory", () => {
    expect(
      resolveDesktopDataHomes({
        configuredBaseDir: "  /tmp/custom-ryco  ",
        defaultBaseDir: "/home/ada/.ryco",
        isDevelopment: true,
      }),
    ).toEqual({
      backendBaseDir: "/tmp/custom-ryco",
      desktopBaseDir: "/tmp/custom-ryco/desktop-dev",
    });
  });
});

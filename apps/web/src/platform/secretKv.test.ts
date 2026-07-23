import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persistence = vi.hoisted(() => ({
  getSavedEnvironmentSecret: vi.fn(async () => "bridge-secret"),
  setSavedEnvironmentSecret: vi.fn(async () => true),
  removeSavedEnvironmentSecret: vi.fn(async () => {}),
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({ persistence }),
}));

import { webSecretKV } from "./secretKv";

describe("webSecretKV", () => {
  beforeEach(() => {
    persistence.getSavedEnvironmentSecret.mockClear();
    persistence.setSavedEnvironmentSecret.mockClear();
    persistence.removeSavedEnvironmentSecret.mockClear();
  });

  it("routes every secret operation through the LocalApi persistence facade", async () => {
    await expect(webSecretKV.get("env-1")).resolves.toBe("bridge-secret");
    await expect(webSecretKV.set("env-1", "token")).resolves.toBe(true);
    await webSecretKV.remove("env-1");

    expect(persistence.getSavedEnvironmentSecret).toHaveBeenCalledWith("env-1");
    expect(persistence.setSavedEnvironmentSecret).toHaveBeenCalledWith("env-1", "token");
    expect(persistence.removeSavedEnvironmentSecret).toHaveBeenCalledWith("env-1");
  });
});

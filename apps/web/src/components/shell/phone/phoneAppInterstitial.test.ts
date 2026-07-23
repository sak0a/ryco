import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { hostedMode } = vi.hoisted(() => ({ hostedMode: { value: false } }));

vi.mock("../../../env", () => ({
  isHostedHubMode: () => hostedMode.value,
}));

import {
  markInterstitialDismissed,
  readInterstitialDismissed,
  resetPhoneAppInterstitialForTests,
  shouldShowPhoneAppInterstitial,
} from "./phoneAppInterstitial";

function createSessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("phone app interstitial", () => {
  beforeEach(() => {
    hostedMode.value = false;
    resetPhoneAppInterstitialForTests();
    vi.stubGlobal("window", { sessionStorage: createSessionStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["is disabled", { enabled: false, isElectron: false, tier: "phone", dismissed: false }, false],
    [
      "runs in Electron",
      { enabled: true, isElectron: true, tier: "phone", dismissed: false },
      false,
    ],
    [
      "uses the desktop tier",
      { enabled: true, isElectron: false, tier: "desktop", dismissed: false },
      false,
    ],
    ["was dismissed", { enabled: true, isElectron: false, tier: "phone", dismissed: true }, false],
    ["qualifies", { enabled: true, isElectron: false, tier: "phone", dismissed: false }, true],
  ] as const)("shows only when it %s", (_case, input, expected) => {
    expect(shouldShowPhoneAppInterstitial(input)).toBe(expected);
  });

  it("persists a standard-mode dismissal in the tab session", () => {
    expect(readInterstitialDismissed()).toBe(false);

    markInterstitialDismissed();

    expect(readInterstitialDismissed()).toBe(true);
    expect(window.sessionStorage.getItem("ryco:phone-app-interstitial-dismissed:v1")).toBe("1");
    resetPhoneAppInterstitialForTests();
    expect(readInterstitialDismissed()).toBe(true);
  });

  it("uses only the in-memory dismissal latch in hosted mode", () => {
    hostedMode.value = true;
    const storage = window.sessionStorage;
    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");

    expect(readInterstitialDismissed()).toBe(false);
    markInterstitialDismissed();
    expect(readInterstitialDismissed()).toBe(true);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps dismissal in memory when session storage throws", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("storage unavailable");
      },
    });

    expect(readInterstitialDismissed()).toBe(false);
    markInterstitialDismissed();
    expect(readInterstitialDismissed()).toBe(true);
  });
});

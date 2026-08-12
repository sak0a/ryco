import type { KVService } from "@ryco/client-runtime/platform";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  deserializeOnboardingProgress,
  hydrateOnboardingProgress,
  ONBOARDING_PROGRESS_STORAGE_KEY,
  readCachedOnboardingProgress,
  resetOnboardingProgressForTests,
  saveOnboardingProgress,
  serializeOnboardingProgress,
} from "./onboardingProgress";

function memoryKv() {
  const values = new Map<string, string>();
  const service: KVService = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { service, values };
}

beforeEach(() => resetOnboardingProgressForTests());

describe("onboarding progress persistence", () => {
  it("round-trips only the version and explicit status", async () => {
    const { service, values } = memoryKv();
    const tainted = {
      version: 1,
      status: "in-progress",
      origin: "https://do-not-persist.example",
      callback: "secret-callback",
    } as const;

    expect(serializeOnboardingProgress(tainted)).toBe(
      JSON.stringify({ version: 1, status: "in-progress" }),
    );
    await saveOnboardingProgress(service, tainted);

    expect(values.get(ONBOARDING_PROGRESS_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, status: "in-progress" }),
    );
    expect(readCachedOnboardingProgress()).toEqual({ version: 1, status: "in-progress" });

    resetOnboardingProgressForTests();
    await expect(hydrateOnboardingProgress(service)).resolves.toEqual({
      version: 1,
      status: "in-progress",
    });
  });

  it("accepts only the two version-one states", () => {
    expect(deserializeOnboardingProgress('{"version":1,"status":"completed"}')).toEqual({
      version: 1,
      status: "completed",
    });
    for (const value of [
      "not-json",
      "null",
      "[]",
      '{"version":2,"status":"completed"}',
      '{"version":1,"status":"dismissed"}',
      '{"version":1,"status":"completed","account":"secret"}',
    ]) {
      expect(deserializeOnboardingProgress(value), value).toBeNull();
    }
  });

  it("fails absent or unreadable storage to no record", async () => {
    const { service } = memoryKv();
    await expect(hydrateOnboardingProgress(service)).resolves.toBeNull();

    resetOnboardingProgressForTests();
    await expect(
      hydrateOnboardingProgress({
        getItem: async () => {
          throw new Error("storage unavailable");
        },
      }),
    ).resolves.toBeNull();
  });

  it("does not let delayed hydration replace a newer explicit completion", async () => {
    let releaseRead: (() => void) | undefined;
    const service: KVService = {
      getItem: async () => {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        return '{"version":1,"status":"in-progress"}';
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };

    const hydration = hydrateOnboardingProgress(service);
    await saveOnboardingProgress(service, { version: 1, status: "completed" });
    releaseRead?.();
    await hydration;

    expect(readCachedOnboardingProgress()).toEqual({ version: 1, status: "completed" });
  });

  it("does not publish a write that failed", async () => {
    await expect(
      saveOnboardingProgress(
        {
          setItem: async () => {
            throw new Error("disk full");
          },
        },
        { version: 1, status: "completed" },
      ),
    ).rejects.toThrow("disk full");
    expect(readCachedOnboardingProgress()).toBeUndefined();
  });
});

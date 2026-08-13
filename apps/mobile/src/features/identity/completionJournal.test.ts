import type { SecretKVService } from "@ryco/client-runtime/platform";
import { describe, expect, it, vi } from "vitest";

import {
  createNativeIdentityCompletionJournal,
  NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY,
  type NativeIdentityCompletionJournal,
} from "./completionJournal";

const identity = {
  account: { id: "acct_abcdefghijklmnopqrstuvwxyz", username: "river", createdAt: 1 },
  session: {
    id: "session_abcdefghijklmnopqrstuvwxyz",
    accountId: "acct_abcdefghijklmnopqrstuvwxyz",
    activeSpaceId: "space_abcdefghijklmnopqrstuvwxyz",
    createdAt: 1,
    expiresAt: 2,
  },
  activeSpace: {
    id: "space_abcdefghijklmnopqrstuvwxyz",
    slug: "river",
    displayName: "River",
    role: "owner",
  },
  spaces: [
    {
      id: "space_abcdefghijklmnopqrstuvwxyz",
      slug: "river",
      displayName: "River",
      role: "owner",
    },
  ],
} as never;

function setup() {
  const data = new Map<string, string>();
  const secretKV: SecretKVService = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
      return true;
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  const commitBearerToken = vi.fn(async () => true);
  return {
    data,
    commitBearerToken,
    journal: createNativeIdentityCompletionJournal({
      secretKV,
      sessionCredentials: { commitBearerToken },
    }),
  };
}

const pending: NativeIdentityCompletionJournal = {
  version: 1,
  phase: "recovery-pending",
  origin: "https://hub.example.test",
  token: "secret-token",
  identity,
  recoveryCodes: ["code-one", "code-two"],
};

describe("native identity completion journal", () => {
  it("persists recovery codes and token in one secret item", async () => {
    const { journal } = setup();
    await expect(journal.stage(pending)).resolves.toBe(true);
    await expect(journal.read()).resolves.toEqual(pending);
  });

  it("erases codes before adopting the normal credential", async () => {
    const { data, journal, commitBearerToken } = setup();
    await journal.stage(pending);
    const committed = await journal.acknowledgeRecovery(pending);
    expect(committed?.phase).toBe("credential-committed");
    expect(data.get(NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY)).not.toContain("code-one");
    await expect(journal.commitCredential(committed as never)).resolves.toBe(true);
    expect(commitBearerToken).toHaveBeenCalledWith("secret-token");
    expect(data.has(NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY)).toBe(false);
  });

  it("keeps the committed journal when final token persistence fails", async () => {
    const { data, journal, commitBearerToken } = setup();
    commitBearerToken.mockResolvedValue(false);
    await journal.stage(pending);
    const committed = await journal.acknowledgeRecovery(pending);
    await expect(journal.commitCredential(committed as never)).resolves.toBe(false);
    expect(data.has(NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY)).toBe(true);
  });

  it("rejects malformed or code-bearing committed records", async () => {
    const { data, journal } = setup();
    data.set(
      NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY,
      JSON.stringify({ ...pending, phase: "credential-committed" }),
    );
    await expect(journal.read()).resolves.toBeNull();
  });

  it("rejects unknown fields and non-origin Hub URLs", async () => {
    const { data, journal } = setup();
    data.set(
      NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY,
      JSON.stringify({ ...pending, debug: "must-not-persist" }),
    );
    await expect(journal.read()).resolves.toBeNull();

    data.set(
      NATIVE_IDENTITY_COMPLETION_JOURNAL_KEY,
      JSON.stringify({ ...pending, origin: "https://hub.example.test/account" }),
    );
    await expect(journal.read()).resolves.toBeNull();
  });
});

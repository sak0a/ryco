import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  LocalHubIdentityStateError,
  makeLocalHubIdentityStateStore,
} from "./LocalHubIdentityState.ts";

describe("local Hub identity state", () => {
  it("creates a stable random EnvironmentId and survives restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-state-"));
    const path = join(root, "nested", "identity.json");
    const store = await makeLocalHubIdentityStateStore(path);
    const created = await store.readOrCreate();
    expect(created.environmentId).toMatch(/^env_[A-Za-z0-9_-]{22}$/);
    expect(created.revision).toBe(0);
    expect(created.activeNode).toBeNull();

    const restarted = await makeLocalHubIdentityStateStore(path);
    expect(await restarted.readOrCreate()).toEqual(created);
    if (process.platform !== "win32") {
      await expect(
        (await import("node:fs/promises")).lstat(path).then((stat) => stat.mode & 0o777),
      ).resolves.toBe(0o600);
    }
  });

  it("persists protected-store references but no polling bearer", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-pending-"));
    const path = join(root, "identity.json");
    const store = await makeLocalHubIdentityStateStore(path);
    const initial = await store.readOrCreate();
    const pollingCanary = "raw-polling-secret-must-not-be-written";
    const updated = await store.update((current) => ({
      ...current,
      revision: current.revision + 1,
      pendingEnrollment: {
        hubOrigin: "https://hub.example.com",
        keySecretName: "node-key.pending",
        pollingSecretName: "enrollment-poll.pending",
        createdAt: 1_784_160_000_000,
        expiresAt: 1_784_160_600_000,
        pollIntervalMs: 5_000,
        cleanupRequested: false,
      },
    }));
    expect(updated.environmentId).toBe(initial.environmentId);
    const persisted = await readFile(path, "utf8");
    expect(persisted).toContain("enrollment-poll.pending");
    expect(persisted).not.toContain(pollingCanary);
  });

  it("rejects environment replacement and invalid revision transitions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-invalid-update-"));
    const store = await makeLocalHubIdentityStateStore(join(root, "identity.json"));
    await store.readOrCreate();
    await expect(
      store.update((current) => ({
        ...current,
        environmentId: "env_ZZZZZZZZZZZZZZZZZZZZZZ",
        revision: current.revision + 1,
      })),
    ).rejects.toMatchObject({ code: "identity_state_operation_failed" });
    await expect(store.update((current) => ({ ...current }))).rejects.toMatchObject({
      code: "identity_state_operation_failed",
    });
  });

  it("gives concurrent writers one lock winner", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-race-"));
    const store = await makeLocalHubIdentityStateStore(join(root, "identity.json"));
    await store.readOrCreate();
    const results = await Promise.allSettled([
      store.update((current) => ({ ...current, revision: current.revision + 1 })),
      store.update((current) => ({ ...current, revision: current.revision + 1 })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "identity_state_locked" },
    });
  });

  it.runIf(process.platform !== "win32")(
    "reclaims a well-formed lock left by a terminated process",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-stale-lock-"));
      const path = join(root, "identity.json");
      const store = await makeLocalHubIdentityStateStore(path);
      await writeFile(`${path}.lock`, "2147483647\n", { mode: 0o600 });
      expect((await store.readOrCreate()).environmentId).toMatch(/^env_/);
    },
  );

  it("fails closed when state disappears before an update", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-missing-update-"));
    const path = join(root, "identity.json");
    const store = await makeLocalHubIdentityStateStore(path);
    await store.readOrCreate();
    await rm(path);
    await expect(
      store.update((current) => ({ ...current, revision: current.revision + 1 })),
    ).rejects.toMatchObject({ code: "identity_state_operation_failed" });
  });

  it.runIf(process.platform !== "win32")(
    "fails closed for insecure, corrupt, and symlinked state",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-corrupt-"));
      const path = join(root, "identity.json");
      const store = await makeLocalHubIdentityStateStore(path);
      await store.readOrCreate();

      await chmod(path, 0o644);
      await expect(store.readOrCreate()).rejects.toBeInstanceOf(LocalHubIdentityStateError);

      await chmod(path, 0o600);
      await writeFile(path, "{not-json", { mode: 0o600 });
      await expect(store.readOrCreate()).rejects.toMatchObject({ code: "identity_state_corrupt" });

      await rm(path);
      const outside = join(root, "outside.json");
      await writeFile(outside, "{}", { mode: 0o600 });
      await symlink(outside, path);
      await expect(store.readOrCreate()).rejects.toMatchObject({ code: "identity_state_corrupt" });

      const outsideDirectory = await mkdtemp(join(tmpdir(), "ryco-hub-identity-outside-"));
      const linkedDirectory = join(root, "linked-directory");
      await symlink(outsideDirectory, linkedDirectory);
      await expect(
        makeLocalHubIdentityStateStore(join(linkedDirectory, "identity.json")),
      ).rejects.toMatchObject({ code: "identity_state_unavailable" });
    },
  );
});

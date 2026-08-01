import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeNodeIdentityKeyRetirementStore } from "./NodeIdentityKeyRetirementStore.ts";

async function store(directory?: string) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), "ryco-identity-retirement-")));
  const path = join(root, "identity-retirement.json");
  return { root, path, store: await makeNodeIdentityKeyRetirementStore({ path }) };
}

describe("node identity key retirement store", () => {
  it("queues, survives a restart, and dequeues only what was destroyed", async () => {
    const context = await store();
    expect(await context.store.names()).toEqual([]);

    await context.store.enqueue("node-key.old");
    // Idempotent on the name: a promotion that retries after a crash between the
    // enqueue and its commit must not queue the same key twice.
    await context.store.enqueue("node-key.old");
    await context.store.enqueue("node-key.older");
    expect(await context.store.names()).toEqual(["node-key.old", "node-key.older"]);

    const reopened = await store(context.root);
    expect(await reopened.store.names()).toEqual(["node-key.old", "node-key.older"]);

    await reopened.store.dequeue(["node-key.older"]);
    expect(await reopened.store.names()).toEqual(["node-key.old"]);

    await reopened.store.reset();
    expect(await reopened.store.names()).toEqual([]);
  });

  it("writes nothing at all until something is queued", async () => {
    const context = await store();
    await context.store.dequeue(["node-key.absent"]);
    expect(await context.store.names()).toEqual([]);
    // A node that has never rotated leaves no record. Creating one would be
    // harmless but it would also be a file whose absence is meaningful.
    await expect(readFile(context.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves top-level keys a newer binary wrote", async () => {
    const context = await store();
    await context.store.enqueue("node-key.old");
    const written = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    await writeFile(
      context.path,
      `${JSON.stringify({ ...written, futureField: { kept: true } })}\n`,
      { mode: 0o600 },
    );

    const reopened = await store(context.root);
    await reopened.store.enqueue("node-key.older");
    // The whole reason this queue is not a field of `hub-identity.json`: that
    // parser reconstructs from its known keys and deletes the rest, and a name
    // deleted here is a private key nothing can ever collect. This record must
    // not rebuild the same trap one version later.
    const roundTripped = JSON.parse(await readFile(context.path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(roundTripped["futureField"]).toEqual({ kept: true });
    expect(roundTripped["retiringSecretNames"]).toEqual(["node-key.old", "node-key.older"]);
  });

  it("never adopts a prototype-polluting key as a forward field", async () => {
    const context = await store();
    await context.store.enqueue("node-key.old");
    await writeFile(
      context.path,
      `${JSON.stringify({
        version: 1,
        revision: 1,
        retiringSecretNames: ["node-key.old"],
        // A computed key, so this is an own property rather than a prototype
        // assignment — which is exactly the shape a hostile record would use.
        ["__proto__"]: { polluted: true },
      })}\n`,
      { mode: 0o600 },
    );
    const reopened = await store(context.root);
    await reopened.store.enqueue("node-key.older");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(await readFile(context.path, "utf8")).not.toContain("polluted");
  });

  it("refuses a name it could not name back, and a record it cannot read", async () => {
    const context = await store();
    await expect(context.store.enqueue("Node-Key.Upper")).rejects.toMatchObject({
      code: "identity_state_operation_failed",
    });
    await writeFile(
      context.path,
      `${JSON.stringify({ version: 1, revision: 0, retiringSecretNames: [1] })}\n`,
      {
        mode: 0o600,
      },
    );
    const reopened = await store(context.root);
    await expect(reopened.store.names()).rejects.toMatchObject({
      code: "identity_state_corrupt",
    });
  });

  it("refuses to grow past its bound instead of writing a record no reader accepts", async () => {
    const context = await store();
    for (let index = 0; index < 8; index += 1) {
      await context.store.enqueue(`node-key.${index}`);
    }
    // Headroom, not a working limit: every promotion drains before it queues, so
    // reaching this means the invariant broke. Refusing aborts the promotion
    // before it commits, which leaves the outgoing key intact.
    await expect(context.store.enqueue("node-key.overflow")).rejects.toMatchObject({
      code: "identity_state_operation_failed",
    });
    expect(await context.store.names()).toHaveLength(8);
  });
});

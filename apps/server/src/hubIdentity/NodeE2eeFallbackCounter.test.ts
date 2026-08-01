import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { E2EE_FALLBACK_RING_SIZE } from "@ryco/shared/relayE2eeConstants";
import {
  encodeCanonicalE2eeCbor,
  E2EE_FALLBACK_ORIGIN_DOMAIN,
} from "@ryco/shared/relayE2eeTranscripts";
import { describe, expect, it } from "vite-plus/test";

import {
  e2eeFallbackClassOf,
  e2eeFallbackOriginHash,
  makeNodeE2eeFallbackCounter,
} from "./NodeE2eeFallbackCounter.ts";

const ORIGIN = "https://hub.example.com";
const OTHER_ORIGIN = "https://other.example.com";
const INTERVAL = 3_600_000;

async function open(options?: { readonly root?: string; readonly clock?: { value: number } }) {
  const root = options?.root ?? (await mkdtemp(join(tmpdir(), "ryco-e2ee-fallback-")));
  const path = join(root, "e2ee-fallback.json");
  const clock = options?.clock ?? { value: 1_700_000_000_000 };
  const counter = await makeNodeE2eeFallbackCounter({
    path,
    now: () => clock.value,
    writeIntervalMs: INTERVAL,
  });
  return { root, path, clock, counter };
}

/** The durable write count: `revision` moves once per commit and never otherwise. */
async function revision(path: string): Promise<number> {
  const raw = JSON.parse(await readFile(path, "utf8")) as { revision: number };
  return raw.revision;
}

describe("§12.5 origin hash", () => {
  it("is SHA-256 over the canonical-CBOR domain array", () => {
    const expected = createHash("sha256")
      .update(encodeCanonicalE2eeCbor([E2EE_FALLBACK_ORIGIN_DOMAIN, ORIGIN]))
      .digest("base64url");
    expect(e2eeFallbackOriginHash(ORIGIN)).toBe(expected);
    expect(e2eeFallbackOriginHash(OTHER_ORIGIN)).not.toBe(expected);
    // The §7.1 validator normalizes nothing, so a non-canonical spelling is
    // refused rather than quietly hashed into a second entry for one Hub.
    expect(() => e2eeFallbackOriginHash("https://hub.example.com/")).toThrow();
  });
});

describe("§12.5 classes", () => {
  it("keeps the two classes disjoint and maps each label to exactly one", () => {
    expect(e2eeFallbackClassOf("peer-legacy")).toBe("peer-legacy");
    // §12.3 excludes this class from the default-flip criterion because U1 is
    // triggered by an integer the Hub asserts; conflating them is what let a
    // Hub-asserted chunk limit look like compatibility traffic.
    expect(e2eeFallbackClassOf("undersized-connection")).toBe("advertisement-unavailable");
    expect(e2eeFallbackClassOf("statement-unavailable")).toBe("advertisement-unavailable");
  });
});

describe("node E2EE fallback counter", () => {
  it("commits the leading edge of each class immediately and coalesces the rest", async () => {
    const context = await open();

    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    // Leading edge: durable before `record` resolves. Losing this one to a crash
    // would remove a whole class from the §12.3 review.
    expect(await revision(context.path)).toBe(1);
    expect((await context.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(1);

    context.clock.value += 1_000;
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    // Coalesced: three occurrences, still one durable write.
    expect(await revision(context.path)).toBe(1);
    expect(context.counter.read().classes["peer-legacy"].occurrences).toBe(3);
    expect((await context.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(1);

    // The other class has its own leading edge, so the two do not share a window.
    await context.counter.record({ hubOrigin: ORIGIN, reason: "statement-unavailable" });
    expect(await revision(context.path)).toBe(2);
    const durable = await context.counter.readDurable();
    // Ring entries and counters travel in the same commit, so the coalesced
    // peer-legacy occurrences land with the advertisement-unavailable one.
    expect(durable.classes["peer-legacy"].occurrences).toBe(3);
    expect(durable.classes["advertisement-unavailable"].occurrences).toBe(1);
    expect(durable.ring).toHaveLength(4);

    // Past the interval boundary the next occurrence is a leading edge again.
    context.clock.value += INTERVAL;
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    expect(await revision(context.path)).toBe(3);

    await context.counter.stop();
  });

  it("never loses an occurrence recorded while a write is in flight", async () => {
    const context = await open();
    // The ordinary receive-path case: two channels record at once and the second
    // lands inside the first's durable write. A commit that wrote back its own
    // snapshot and cleared the dirty flag would drop the second from memory AND
    // from the next flush, which §12.5 forbids — the counter is a lower bound
    // precisely because it never loses an occurrence it was told about.
    const first = context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    // Long enough for the leading-edge write to be past its own snapshot and
    // inside `writeJson`; the durable write does more I/O than a microtask
    // drain, so the second record lands in the middle of it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    context.clock.value += 1;
    const second = context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await Promise.all([first, second]);
    expect(context.counter.read().classes["peer-legacy"].occurrences).toBe(2);

    await context.counter.stop();
    expect((await context.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(2);
    expect((await context.counter.readDurable()).ring).toHaveLength(2);
  });

  it("flushes coalesced state on clean shutdown", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    context.clock.value += 1_000;
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    expect((await context.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(1);

    await context.counter.stop();
    expect((await context.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(2);
  });

  it("bounds the ring and counts every eviction in the recording class", async () => {
    const context = await open();
    for (let index = 0; index < E2EE_FALLBACK_RING_SIZE + 5; index += 1) {
      context.clock.value += 1;
      await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    }
    const state = context.counter.read();
    expect(state.ring).toHaveLength(E2EE_FALLBACK_RING_SIZE);
    expect(state.classes["peer-legacy"].occurrences).toBe(E2EE_FALLBACK_RING_SIZE + 5);
    // Once per evicted entry, which is what tells the maintainers the ring is
    // not a complete account of the window (§12.3, §12.5).
    expect(state.classes["peer-legacy"].ringOverflows).toBe(5);
    // Oldest first, and the oldest five are gone.
    expect(state.ring[0]?.occurredAt).toBeGreaterThan(state.windowStartedAt ?? 0);
    expect(state.ring.every((entry) => entry.reason === "peer-legacy")).toBe(true);

    // The overflow counter is per class: the other class has seen nothing.
    expect(state.classes["advertisement-unavailable"].ringOverflows).toBe(0);
    await context.counter.stop();
  });

  it("retains only the three §12.5 fields per ring entry", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "undersized-connection" });
    await context.counter.stop();
    const raw = JSON.parse(await readFile(context.path, "utf8")) as {
      ring: readonly Record<string, unknown>[];
    };
    // No account, channel, session, key or payload data — and no Hub origin
    // either, only its hash (§12.5, §12.3).
    expect(Object.keys(raw.ring[0] ?? {}).toSorted()).toEqual([
      "occurredAt",
      "originHash",
      "reason",
    ]);
    expect(JSON.stringify(raw)).not.toContain("hub.example.com");
  });

  it("survives a restart and never decrements", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    context.clock.value += 1;
    await context.counter.record({ hubOrigin: OTHER_ORIGIN, reason: "statement-unavailable" });
    await context.counter.stop();

    const reopened = await open({ root: context.root, clock: context.clock });
    const state = reopened.counter.read();
    expect(state.classes["peer-legacy"].occurrences).toBe(1);
    expect(state.classes["advertisement-unavailable"].occurrences).toBe(1);
    expect(state.ring).toHaveLength(2);
    expect(state.windowStartedAt).toBeDefined();

    // A restart is not a flush boundary: the first occurrence after it is a
    // leading edge, which is the reading that keeps a class from being lost.
    reopened.clock.value += 1;
    await reopened.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    expect((await reopened.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(2);
    await reopened.counter.stop();
  });

  it("does not discard a concurrent writer's occurrences", async () => {
    // §12.5's counter is a lower bound precisely because it must never lose an
    // occurrence it was told about, and every commit writes the WHOLE record —
    // so a second holder of the same file would otherwise be overwritten by
    // whatever this process happened to be carrying.
    const first = await open();
    await first.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });

    const second = await open({ root: first.root, clock: { value: first.clock.value + 1 } });
    await second.counter.record({ hubOrigin: OTHER_ORIGIN, reason: "peer-legacy" });
    await second.counter.stop();
    expect((await first.counter.readDurable()).classes["peer-legacy"].occurrences).toBe(2);

    // The first process now commits again, from a view that predates the
    // second's write.
    first.clock.value += INTERVAL + 1;
    await first.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await first.counter.stop();

    const durable = await first.counter.readDurable();
    expect(durable.classes["peer-legacy"].occurrences).toBe(3);
    expect(durable.ring).toHaveLength(3);
    await first.counter.stop();
  });

  it("resets only on the explicit operator action", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    for (let index = 0; index < E2EE_FALLBACK_RING_SIZE + 1; index += 1) {
      context.clock.value += 1;
      await context.counter.record({ hubOrigin: ORIGIN, reason: "statement-unavailable" });
    }
    // 1 peer-legacy plus 33 advertisement-unavailable is 34 entries into a
    // 32-entry ring: two evictions, both counted in the recording class.
    expect(context.counter.read().classes["advertisement-unavailable"].ringOverflows).toBe(2);

    context.clock.value += 5_000;
    const reset = await context.counter.reset();
    // Both occurrence counters, both ring-overflow counters, and the ring — and
    // a new observation-window start.
    expect(reset.classes["peer-legacy"]).toEqual({
      occurrences: 0,
      ringOverflows: 0,
      lastOccurrenceAt: undefined,
    });
    expect(reset.classes["advertisement-unavailable"].ringOverflows).toBe(0);
    expect(reset.ring).toEqual([]);
    expect(reset.windowStartedAt).toBe(context.clock.value);
    expect((await context.counter.readDurable()).ring).toEqual([]);
    await context.counter.stop();
  });

  it("preserves top-level keys a newer binary wrote", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await context.counter.stop();
    const written = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    await writeFile(
      context.path,
      `${JSON.stringify({ ...written, futureField: { kept: true } })}\n`,
      { mode: 0o600 },
    );

    const reopened = await open({ root: context.root, clock: context.clock });
    reopened.clock.value += 1;
    await reopened.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await reopened.counter.stop();
    const after = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    expect(after["futureField"]).toEqual({ kept: true });
  });

  it("refuses a stored record it cannot validate", async () => {
    const context = await open();
    await context.counter.record({ hubOrigin: ORIGIN, reason: "peer-legacy" });
    await context.counter.stop();
    const written = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    for (const broken of [
      { ...written, ring: [{ originHash: "short", occurredAt: 1, reason: "peer-legacy" }] },
      { ...written, ring: [{ originHash: "x".repeat(43), occurredAt: 1, reason: "invented" }] },
      { ...written, classes: { "peer-legacy": { occurrences: -1, ringOverflows: 0 } } },
    ]) {
      await writeFile(context.path, `${JSON.stringify(broken)}\n`, { mode: 0o600 });
      await expect(open({ root: context.root })).rejects.toMatchObject({
        code: "fallback_state_corrupt",
      });
    }
  });

  it("ignores a label outside the fixed set", async () => {
    const context = await open();
    await context.counter.record({
      hubOrigin: ORIGIN,
      reason: "made-up" as unknown as "peer-legacy",
    });
    expect(context.counter.read().ring).toEqual([]);
    expect(context.counter.read().classes["peer-legacy"].occurrences).toBe(0);
    await context.counter.stop();
  });
});

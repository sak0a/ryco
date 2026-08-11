import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LTI_LEDGER_MAX_ENTRIES,
  LTI_LEDGER_RETENTION_MS,
} from "@ryco/shared/relayE2eeLocalIntroduction";
import { describe, expect, it } from "vite-plus/test";

import {
  makeNodeLocalIntroductionLedger,
  NodeLocalIntroductionLedgerError,
} from "./NodeLocalIntroductionLedger.ts";

const NOW = 1_800_000_000_000;
const bytes = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
const approval = (seed: number): Uint8Array => Uint8Array.from([0x82, seed % 256]);
const signature = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 64 }, (_, index) => (seed + index) % 256);

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "ryco-lti-ledger-"));
  const path = join(root, "hub-e2ee-local-introductions.json");
  const ledger = await makeNodeLocalIntroductionLedger({ path });
  return { root, path, ledger };
}

describe("node Local Trusted Introduction replay ledger", () => {
  it("commits and returns an exact idempotent replay", async () => {
    const test = await harness();
    const input = {
      introductionId: bytes(1),
      requestDigest: bytes(2),
      approvalTbs: approval(3),
      approvalSignature: signature(3),
      approvedAt: NOW - 10,
      recordedAt: NOW,
    };
    const first = await test.ledger.commit(input);
    const second = await test.ledger.commit(input);
    expect(second).toEqual(first);
    expect(await test.ledger.get(bytes(1))).toEqual(first);

    const stored = JSON.parse(await readFile(test.path, "utf8")) as {
      readonly version: number;
      readonly revision: number;
      readonly entries: readonly unknown[];
    };
    expect(stored).toMatchObject({ version: 1, revision: 1 });
    expect(stored.entries).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain("requestSignature");
    expect(JSON.stringify(stored)).not.toContain("nonce");
  });

  it("collapses introduction-id reuse with any different committed value", async () => {
    const test = await harness();
    const input = {
      introductionId: bytes(4),
      requestDigest: bytes(5),
      approvalTbs: approval(6),
      approvalSignature: signature(6),
      approvedAt: NOW,
      recordedAt: NOW,
    };
    await test.ledger.commit(input);
    for (const changed of [
      { ...input, requestDigest: bytes(7) },
      { ...input, approvalTbs: approval(8) },
      { ...input, approvalSignature: signature(8) },
      { ...input, approvedAt: NOW + 1 },
    ]) {
      await expect(test.ledger.commit(changed)).rejects.toMatchObject({
        code: "local_introduction_ledger_conflict",
      });
    }
    expect(
      (JSON.parse(await readFile(test.path, "utf8")) as { entries: unknown[] }).entries,
    ).toHaveLength(1);
  });

  it("keeps the newest bounded entries and prunes only replay state", async () => {
    const test = await harness();
    for (let index = 0; index < LTI_LEDGER_MAX_ENTRIES + 5; index += 1) {
      await test.ledger.commit({
        introductionId: bytes(index),
        requestDigest: bytes(index + 70),
        approvalTbs: approval(index),
        approvalSignature: signature(index),
        approvedAt: NOW + index,
        recordedAt: NOW + index,
      });
    }
    const stored = JSON.parse(await readFile(test.path, "utf8")) as {
      readonly entries: readonly { readonly introductionId: string }[];
    };
    expect(stored.entries).toHaveLength(LTI_LEDGER_MAX_ENTRIES);
    expect(await test.ledger.get(bytes(0))).toBeUndefined();
    expect(await test.ledger.get(bytes(LTI_LEDGER_MAX_ENTRIES + 4))).toBeDefined();

    // A wall-clock rollback cannot delete replay evidence and make an already
    // used introduction id reusable.
    expect(await test.ledger.prune(NOW - 10_000)).toBe(0);
    expect(await test.ledger.get(bytes(LTI_LEDGER_MAX_ENTRIES + 4))).toBeDefined();

    expect(await test.ledger.prune(NOW + LTI_LEDGER_RETENTION_MS + 100)).toBeGreaterThan(0);
    expect(
      (JSON.parse(await readFile(test.path, "utf8")) as { entries: unknown[] }).entries,
    ).toEqual([]);
  });

  it("preserves unknown fields and rejects malformed or duplicate state", async () => {
    const test = await harness();
    const id = Buffer.from(bytes(10)).toString("base64url");
    const digest = Buffer.from(bytes(11)).toString("base64url");
    const entry = {
      introductionId: id,
      requestDigest: digest,
      approvalTbs: Buffer.from(approval(12)).toString("base64url"),
      approvalSignature: Buffer.from(signature(12)).toString("base64url"),
      approvedAt: NOW,
      recordedAt: NOW,
      futureEntryField: { retained: true },
    };
    await writeFile(
      test.path,
      `${JSON.stringify({
        version: 1,
        revision: 9,
        entries: [entry],
        futureTopField: "retained",
      })}\n`,
      { mode: 0o600 },
    );
    const ledger = await makeNodeLocalIntroductionLedger({ path: test.path });
    await ledger.commit({
      introductionId: bytes(13),
      requestDigest: bytes(14),
      approvalTbs: approval(15),
      approvalSignature: signature(15),
      approvedAt: NOW,
      recordedAt: NOW,
    });
    const preserved = JSON.parse(await readFile(test.path, "utf8")) as Record<string, unknown>;
    expect(preserved.futureTopField).toBe("retained");
    expect((preserved.entries as readonly Record<string, unknown>[])[0]?.futureEntryField).toEqual({
      retained: true,
    });

    await writeFile(
      test.path,
      `${JSON.stringify({ version: 1, revision: 1, entries: [entry, entry] })}\n`,
      { mode: 0o600 },
    );
    const corrupt = await makeNodeLocalIntroductionLedger({ path: test.path });
    await expect(corrupt.get(bytes(10))).rejects.toBeInstanceOf(NodeLocalIntroductionLedgerError);
  });

  it("resets without reusing the revision", async () => {
    const test = await harness();
    await test.ledger.commit({
      introductionId: bytes(20),
      requestDigest: bytes(21),
      approvalTbs: approval(22),
      approvalSignature: signature(22),
      approvedAt: NOW,
      recordedAt: NOW,
    });
    await test.ledger.reset();
    expect(await test.ledger.get(bytes(20))).toBeUndefined();
    expect(JSON.parse(await readFile(test.path, "utf8"))).toMatchObject({
      version: 1,
      revision: 2,
      entries: [],
    });
  });
});

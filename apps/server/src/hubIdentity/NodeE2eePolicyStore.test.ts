import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { E2EE_SUITE_25519_CHACHAPOLY_SHA256, type E2eeSuiteId } from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import { makeNodeContinuityAnchor } from "./NodeContinuityAnchor.ts";
import {
  e2eePolicyNarrows,
  e2eePolicyRefusesInFlightHandshake,
  e2eeWithdrawnChannelClass,
  effectiveNodeE2eePolicy,
  makeNodeE2eePolicyStore,
  NODE_E2EE_FAIL_CLOSED_POLICY,
  nodeE2eeAdmissionPolicyForMode,
  resolveNodeE2eePolicyProposal,
} from "./NodeE2eePolicyStore.ts";

const SUITE = E2EE_SUITE_25519_CHACHAPOLY_SHA256;
/** Not a suite this version defines; used only where a registry is compared, never parsed. */
const OTHER_SUITE = 0x02 as unknown as E2eeSuiteId;

async function open(directory?: string) {
  const root = directory ?? (await mkdtemp(join(tmpdir(), "ryco-e2ee-policy-")));
  const path = join(root, "e2ee-policy.json");
  const anchorPath = join(root, "anchor.json");
  const anchor = await makeNodeContinuityAnchor({ path: anchorPath });
  return { root, path, anchorPath, anchor, store: await makeNodeE2eePolicyStore({ path, anchor }) };
}

const policy = (
  requireE2EE: boolean,
  requireApprovedClientE2EE: boolean,
  suites: readonly E2eeSuiteId[] = [SUITE],
) =>
  effectiveNodeE2eePolicy({
    mode: requireApprovedClientE2EE
      ? "require-locally-approved-native-e2ee"
      : requireE2EE
        ? "require-e2ee"
        : "compatibility",
    requireE2EE,
    requireApprovedClientE2EE,
    suiteRegistry: suites,
  });

describe("effective node E2EE policy (§12.4)", () => {
  it("projects the four public modes to one exact, non-combinatorial policy", () => {
    expect(nodeE2eeAdmissionPolicyForMode("compatibility")).toEqual({
      mode: "compatibility",
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [2, 1],
    });
    expect(nodeE2eeAdmissionPolicyForMode("require-e2ee")).toEqual({
      mode: "require-e2ee",
      requireE2EE: true,
      requireApprovedClientE2EE: false,
      suiteRegistry: [2, 1],
    });
    expect(
      effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyForMode("require-native-e2ee")),
    ).toMatchObject({
      requireE2EE: true,
      admittedPatterns: ["IK"],
      suiteRegistry: [2, 1],
      accountGrantsAllowed: true,
    });
    expect(nodeE2eeAdmissionPolicyForMode("require-locally-approved-native-e2ee")).toEqual({
      mode: "require-locally-approved-native-e2ee",
      requireE2EE: true,
      requireApprovedClientE2EE: true,
      suiteRegistry: [1],
    });
  });

  it("accepts deprecated inputs only when they resolve to an exact public mode", () => {
    const current = effectiveNodeE2eePolicy(nodeE2eeAdmissionPolicyForMode("compatibility"));
    expect(resolveNodeE2eePolicyProposal(current, { requireE2EE: true }).mode).toBe("require-e2ee");
    expect(resolveNodeE2eePolicyProposal(current, { suiteRegistry: [SUITE] }).mode).toBe(
      "require-locally-approved-native-e2ee",
    );
    expect(() =>
      resolveNodeE2eePolicyProposal(current, {
        mode: "require-native-e2ee",
        suiteRegistry: [SUITE],
      }),
    ).toThrowError(expect.objectContaining({ code: "policy_state_operation_failed" }));
    expect(() =>
      resolveNodeE2eePolicyProposal(current, {
        mode: "require-native-e2ee",
        requireApprovedClientE2EE: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "policy_state_operation_failed" }));
  });

  it("computes effective requireE2EE as the OR, and leaves the advertised pair raw", () => {
    const implied = policy(false, true);
    // §12.4's implication: the admission rule says true while the value the
    // §7.6 statement carries stays false, which is what element 14 then
    // explains to a client.
    expect(implied.requireE2EE).toBe(true);
    expect(implied.advertised.requireE2EE).toBe(false);
    expect(implied.admittedPatterns).toEqual(["IK"]);

    const plain = policy(true, false);
    expect(plain.requireE2EE).toBe(true);
    expect(plain.advertised.requireE2EE).toBe(true);
    // `requireE2EE` alone still admits the unsigned web tier (§12.3's stated
    // scope), so element 14 keeps NX.
    expect(plain.admittedPatterns).toEqual(["IK", "NX"]);

    const open_ = policy(false, false);
    expect(open_.requireE2EE).toBe(false);
    expect(open_.admittedPatterns).toEqual(["IK", "NX"]);
  });

  it("fails closed when the durable policy cannot be read", () => {
    expect(NODE_E2EE_FAIL_CLOSED_POLICY.requireE2EE).toBe(true);
    expect(NODE_E2EE_FAIL_CLOSED_POLICY.requireApprovedClientE2EE).toBe(true);
    expect(NODE_E2EE_FAIL_CLOSED_POLICY.admittedPatterns).toEqual(["IK"]);
  });
});

describe("policy narrowing (§12.6 the transition)", () => {
  it("names all four cases and only the four", () => {
    expect(e2eePolicyNarrows(policy(false, false), policy(true, false))).toBe(true);
    expect(e2eePolicyNarrows(policy(false, false), policy(false, true))).toBe(true);
    // Case 1 by implication: raw `requireE2EE` never moves, but the effective
    // value does, and §12.6 says that is case 1 as well as case 2.
    expect(policy(false, true).requireE2EE).toBe(true);
    expect(e2eePolicyNarrows(policy(false, false), policy(false, false, [OTHER_SUITE]))).toBe(true);
    // A change that both narrows and widens IS a withdrawal.
    expect(e2eePolicyNarrows(policy(false, false), policy(true, false, [OTHER_SUITE]))).toBe(true);

    // Pure widenings sweep nothing.
    expect(e2eePolicyNarrows(policy(true, false), policy(false, false))).toBe(false);
    expect(e2eePolicyNarrows(policy(false, true), policy(false, false))).toBe(false);
    expect(
      e2eePolicyNarrows(policy(false, false), policy(false, false, [SUITE, OTHER_SUITE])),
    ).toBe(false);
    expect(e2eePolicyNarrows(policy(true, false), policy(true, false))).toBe(false);
  });
});

describe("the per-channel withdrawal test (§12.6)", () => {
  it("closes legacy only under effective requireE2EE", () => {
    expect(e2eeWithdrawnChannelClass({ phase: "legacy" }, policy(false, false))).toBeUndefined();
    expect(e2eeWithdrawnChannelClass({ phase: "legacy" }, policy(true, false))).toBe("legacy");
    // Effective, not raw: `requireApprovedClientE2EE` alone closes plaintext.
    expect(e2eeWithdrawnChannelClass({ phase: "legacy" }, policy(false, true))).toBe("legacy");
  });

  it("closes NX e2ee channels when NX leaves the admitted set, and never IK for that reason", () => {
    const nx = { phase: "e2ee", pattern: "NX", suite: SUITE } as const;
    const ik = { phase: "e2ee", pattern: "IK", suite: SUITE } as const;
    expect(e2eeWithdrawnChannelClass(nx, policy(true, false))).toBeUndefined();
    expect(e2eeWithdrawnChannelClass(nx, policy(false, true))).toBe("nx_e2ee");
    // The consequence §12.6 spells out: §8.6 step 6 admitted no IK channel
    // without an approved record, so this narrowing reaches none of them.
    expect(e2eeWithdrawnChannelClass(ik, policy(false, true))).toBeUndefined();
  });

  it("closes a withdrawn suite on either tier", () => {
    const narrowed = policy(false, false, [OTHER_SUITE]);
    expect(
      e2eeWithdrawnChannelClass({ phase: "e2ee", pattern: "IK", suite: SUITE }, narrowed),
    ).toBe("suite_withdrawn");
    expect(
      e2eeWithdrawnChannelClass({ phase: "e2ee", pattern: "NX", suite: SUITE }, narrowed),
    ).toBe("suite_withdrawn");
  });

  it("never sweeps a negotiating channel, and counts a doubly-withdrawn one once", () => {
    expect(
      e2eeWithdrawnChannelClass({ phase: "negotiating" }, NODE_E2EE_FAIL_CLOSED_POLICY),
    ).toBeUndefined();
    // NX on a withdrawn suite matches two bullets; the test names the first.
    expect(
      e2eeWithdrawnChannelClass(
        { phase: "e2ee", pattern: "NX", suite: SUITE },
        policy(false, true, [OTHER_SUITE]),
      ),
    ).toBe("nx_e2ee");
  });

  it("refuses an in-flight handshake by tier or by selected suite", () => {
    const inFlightNx = { phase: "in_flight", pattern: "NX", suite: SUITE } as const;
    expect(e2eePolicyRefusesInFlightHandshake(inFlightNx, policy(true, false))).toBe(false);
    expect(e2eePolicyRefusesInFlightHandshake(inFlightNx, policy(false, true))).toBe(true);
    expect(
      e2eePolicyRefusesInFlightHandshake(
        { phase: "in_flight", pattern: "IK", suite: SUITE },
        policy(false, false, [OTHER_SUITE]),
      ),
    ).toBe(true);
    // Not yet past §8.6 step 2: never on the in-flight list.
    expect(
      e2eePolicyRefusesInFlightHandshake({ phase: "negotiating" }, NODE_E2EE_FAIL_CLOSED_POLICY),
    ).toBe(false);
  });
});

describe("the durable policy record", () => {
  it("defaults to the §12.3/§12.4 values and writes nothing until something changes", async () => {
    const context = await open();
    const read = await context.store.read();
    expect(read.policy.requireE2EE).toBe(false);
    expect(read.record.generation).toBe(0);
    // A node that has never been configured leaves no record; its absence is
    // meaningful and materializing it would spend a write and a generation.
    await expect(readFile(context.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const unchanged = await context.store.commit({ requireE2EE: false });
    expect(unchanged.changed).toBe(false);
    expect(unchanged.record.generation).toBe(0);
    await expect(readFile(context.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("survives a restart and cannot be weakened by one", async () => {
    const context = await open();
    const committed = await context.store.commit({ requireApprovedClientE2EE: true });
    expect(committed.withdrawal).toBe(true);
    expect(committed.record.generation).toBe(1);

    // The restart every operator actually performs: a different shell, no
    // environment variable, nothing configured. An absent value leaves the
    // committed one alone rather than reading as `false`.
    const restarted = await open(context.root);
    const after = await restarted.store.read();
    expect(after.policy.requireApprovedClientE2EE).toBe(true);
    expect(after.policy.requireE2EE).toBe(true);
    expect(after.record.generation).toBe(1);

    const reapplied = await restarted.store.commit({});
    expect(reapplied.changed).toBe(false);
    // A restart that changes nothing spends no generation, so a node whose
    // policy never moves does not climb past the clients remembering it.
    expect(reapplied.record.generation).toBe(1);
  });

  it("increments the generation monotonically across restarts and widenings", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    const widened = await context.store.commit({ requireE2EE: false });
    expect(widened.withdrawal).toBe(false);
    // A widening is not a withdrawal, but it IS a change to an advertised
    // value, so §5.7 still increments.
    expect(widened.record.generation).toBe(2);

    const restarted = await open(context.root);
    const next = await restarted.store.commit({ requireApprovedClientE2EE: true });
    expect(next.record.generation).toBe(3);
    const anchor = await restarted.anchor.read();
    expect(anchor?.policyGenerationHighWater).toBe(3);
  });

  it("refuses to run on a rolled-back record and recovers only through the §5.7 command", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    await context.store.commit({ requireApprovedClientE2EE: true });
    const stored = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    expect(stored["generation"]).toBe(2);

    // The restore the anchor exists to catch: the state directory goes back,
    // the anchor — which lives outside it — does not.
    await writeFile(context.path, `${JSON.stringify({ ...stored, generation: 1 })}\n`, {
      mode: 0o600,
    });
    const reopened = await open(context.root);
    await expect(reopened.store.read()).rejects.toMatchObject({
      code: "policy_generation_rolled_back",
    });
    await expect(reopened.store.commit({ requireE2EE: true })).rejects.toMatchObject({
      code: "policy_generation_rolled_back",
    });

    const recovered = await reopened.store.recoverGeneration();
    // Strictly above anything this node may have advertised, which is the only
    // value a client remembering the old one will accept.
    expect(recovered.record.generation).toBe(3);
    expect((await reopened.store.read()).record.generation).toBe(3);
  });

  it("recovery does not re-adopt the policy a restore put in the record", async () => {
    const context = await open();
    // The owner narrows further after the snapshot below is taken, so the
    // generation the anchor remembers belongs to the NARROW policy while the
    // restorable record still holds the wider one.
    await context.store.commit({ requireE2EE: true });
    const wide = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    await context.store.commit({ requireApprovedClientE2EE: true });

    // The restore: the state directory goes back to the older snapshot, the
    // anchor does not.
    await writeFile(context.path, `${JSON.stringify(wide)}\n`, { mode: 0o600 });
    const reopened = await open(context.root);
    await expect(reopened.store.read()).rejects.toMatchObject({
      code: "policy_generation_rolled_back",
    });

    const recovered = await reopened.store.recoverGeneration();
    // NOT the restored record's values at a fresh generation, which is what
    // makes a rollback look like a legitimate change: the owner's
    // `requireApprovedClientE2EE` would be durably undone at a generation every
    // client accepts as current. The §12.4 fail-closed policy instead — recovery
    // advances the generation, which is what it is for, and weakens nothing.
    expect(recovered.record.generation).toBe(3);
    expect(recovered.policy.requireE2EE).toBe(true);
    expect(recovered.policy.requireApprovedClientE2EE).toBe(true);
    expect(recovered.withdrawal).toBe(true);
    const after = await reopened.store.read();
    expect(after.record.mode).toBe("require-locally-approved-native-e2ee");
  });

  it("recovery keeps the committed policy when the record is not rolled back", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    const recovered = await context.store.recoverGeneration();
    // Nothing accuses this record of a restore — its generation is at the mark
    // — so its values are this node's own and only the generation is spent.
    expect(recovered.record.generation).toBe(2);
    expect(recovered.policy.requireApprovedClientE2EE).toBe(false);
    expect(recovered.withdrawal).toBe(false);
  });

  it("raises the mark to meet a record that committed before the mark caught up", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    // The crash window inside a commit: the record is durable and the mark has
    // not caught up. The record is the evidence — the node wrote it — so the
    // mark is raised to meet it, never the reverse.
    const anchor = JSON.parse(await readFile(context.anchorPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      context.anchorPath,
      `${JSON.stringify({ ...anchor, policyGenerationHighWater: 0, pendingPolicyGeneration: 1 })}\n`,
      { mode: 0o600 },
    );
    const reopened = await open(context.root);
    expect((await reopened.store.read()).record.generation).toBe(1);
    expect((await reopened.anchor.read())?.policyGenerationHighWater).toBe(1);
  });

  it("a continuity-driven anchor repair leaves the policy mark able to catch a rollback", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    await context.store.commit({ requireApprovedClientE2EE: true });
    const stored = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;

    // The repair the continuity store performs. It holds no evidence for the
    // §5.7 policy pair, so it names none — and the anchor keeps what it has.
    await context.anchor.reset({
      continuityId: null,
      generationHighWater: 0,
      pendingGeneration: 0,
    });
    expect((await context.anchor.read())?.policyGenerationHighWater).toBe(2);

    // A restore after the repair is still caught. Zeroing the mark here would
    // have let the old record pass the cross-check and raise the mark to its own
    // generation, laundering the rollback.
    await writeFile(context.path, `${JSON.stringify({ ...stored, generation: 1 })}\n`, {
      mode: 0o600,
    });
    const reopened = await open(context.root);
    await expect(reopened.store.read()).rejects.toMatchObject({
      code: "policy_generation_rolled_back",
    });
  });

  it("preserves top-level keys a newer binary wrote", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    const written = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    await writeFile(
      context.path,
      `${JSON.stringify({ ...written, futureField: { kept: true } })}\n`,
      { mode: 0o600 },
    );

    const reopened = await open(context.root);
    await reopened.store.commit({ requireApprovedClientE2EE: true });
    const after = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    // The 2b downgrade trap, not rebuilt here: a binary that dropped an
    // unrecognized key would be a downgrade that silently widens an operator's
    // admission policy.
    expect(after["futureField"]).toEqual({ kept: true });
    expect(after["mode"]).toBe("require-locally-approved-native-e2ee");
  });

  it("rejects a stored record it cannot validate", async () => {
    const context = await open();
    await context.store.commit({ requireE2EE: true });
    const written = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
    for (const broken of [
      { ...written, mode: "unknown" },
      { ...written, generation: -1 },
      { ...written, revision: -1 },
      { ...written, version: 3 },
      { ...written, requireE2EE: true },
      { ...written, suiteRegistry: [SUITE] },
    ]) {
      await writeFile(context.path, `${JSON.stringify(broken)}\n`, { mode: 0o600 });
      const reopened = await open(context.root);
      await expect(reopened.store.read()).rejects.toMatchObject({ code: "policy_state_corrupt" });
    }
  });

  it("migrates every v1 boolean state to the exact v2 mode projection", async () => {
    for (const [requireE2EE, requireApprovedClientE2EE, mode] of [
      [false, false, "compatibility"],
      [true, false, "require-e2ee"],
      [false, true, "require-locally-approved-native-e2ee"],
      [true, true, "require-locally-approved-native-e2ee"],
    ] as const) {
      const context = await open();
      await writeFile(
        context.path,
        `${JSON.stringify({
          version: 1,
          revision: 7,
          generation: 4,
          requireE2EE,
          requireApprovedClientE2EE,
          suiteRegistry: [SUITE],
          futureField: { kept: true },
        })}\n`,
        { mode: 0o600 },
      );

      const migrated = await context.store.read();
      expect(migrated.record).toMatchObject({ version: 2, revision: 8, generation: 5, mode });
      expect(migrated.policy.advertised).toEqual(
        mode === "require-locally-approved-native-e2ee"
          ? {
              mode,
              requireE2EE: true,
              requireApprovedClientE2EE: true,
              suiteRegistry: [SUITE],
            }
          : {
              mode,
              requireE2EE,
              requireApprovedClientE2EE: false,
              suiteRegistry: [2, SUITE],
            },
      );
      const stored = JSON.parse(await readFile(context.path, "utf8")) as Record<string, unknown>;
      expect(stored["futureField"]).toEqual({ kept: true });
      expect(stored["requireE2EE"]).toBeUndefined();
      expect(stored["requireApprovedClientE2EE"]).toBeUndefined();
      expect(stored["suiteRegistry"]).toBeUndefined();
      expect((await context.anchor.read())?.policyGenerationHighWater).toBe(5);
    }
  });

  it("rejects malformed v1 state instead of guessing a migration", async () => {
    const context = await open();
    const base = {
      version: 1,
      revision: 0,
      generation: 0,
      requireE2EE: false,
      requireApprovedClientE2EE: false,
      suiteRegistry: [SUITE],
    };
    for (const broken of [
      { ...base, requireE2EE: "false" },
      { ...base, suiteRegistry: [] },
      { ...base, suiteRegistry: [SUITE, SUITE] },
      { ...base, suiteRegistry: [999] },
      { ...base, mode: "compatibility" },
    ]) {
      await writeFile(context.path, `${JSON.stringify(broken)}\n`, { mode: 0o600 });
      const reopened = await open(context.root);
      await expect(reopened.store.read()).rejects.toMatchObject({ code: "policy_state_corrupt" });
    }
  });

  it("exposes no operation that returns the policy to its defaults", async () => {
    const context = await open();
    await context.store.commit({ requireApprovedClientE2EE: true });
    // There is deliberately no `reset` here. The other node records have one
    // because a `leave` erases Hub-scoped state; this record is the operator's
    // own admission policy, and returning it to the §12.3/§12.4 defaults is
    // `requireE2EE: false` — a silent widening performed by a command whose name
    // does not say so. An operator who wants the defaults states them.
    expect("reset" in context.store).toBe(false);
    const widened = await context.store.commit({ requireApprovedClientE2EE: false });
    expect(widened.changed).toBe(true);
    expect(widened.withdrawal).toBe(false);
    // §5.7: never silently reset. A client remembering generation 1 would
    // reject every later statement of a node that went back to 0.
    expect(widened.record.generation).toBe(2);
  });
});

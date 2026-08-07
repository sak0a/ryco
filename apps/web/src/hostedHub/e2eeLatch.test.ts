import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hostedHubStore } from "@ryco/client-runtime/authorization";
import { EnvironmentId } from "@ryco/contracts";
import type { NodeE2eeCapabilityVerification } from "@ryco/shared/relayE2eeCapabilityVerify";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import latchSource from "./e2eeLatch.ts?raw";
import {
  resetWebRelayE2eeForTests,
  watchWebHostedSessionForE2ee,
  webRelayE2eeAttempt,
} from "./e2eeAttempt";
import * as latchModule from "./e2eeLatch";
import {
  acceptedWebE2eePolicyGeneration,
  clearWebE2eeLatches,
  isWebE2eeSelectionLatched,
  latchWebE2eeSelection,
  recordWebE2eePolicyGeneration,
  type WebE2eeSelection,
} from "./e2eeLatch";
import { clearWebHostedNodeScopedState } from "./environment";
import {
  clearWebE2eeLocalDiagnostics,
  recordWebE2eePolicyGenerationRegression,
  webE2eeLocalDiagnostics,
} from "./e2eeSession";

// docs/relay-e2ee-protocol.md §12.1's web latch, and §12.1.1's degenerate
// mapping over it.
//
// Two of these cases are about what the module CANNOT do rather than about what
// it does, and they are the load-bearing ones: §12.1's five MUST NOTs and §6.3's
// storage prohibition are discharged here by reading the module back, so
// "nothing writes the latch anywhere" is checked rather than remembered.

const SELECTION: WebE2eeSelection = {
  hubOrigin: "https://hub.example.test",
  accountId: "acct_0123456789",
  nodeId: "node_AAAAAAAAAAAAAAAAAAAAAA",
};

/** Code with its comments removed, so prose about an API is not a use of it. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

const WEB_SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every non-test module in `apps/web/src`, as `[path relative to src, code]`. */
function webSourceFiles(): ReadonlyArray<readonly [string, string]> {
  const files: Array<readonly [string, string]> = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${directory}/${entry.name}`, `${prefix}${entry.name}/`);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name)) continue;
      if (/\.(?:test|browser)\.tsx?$/u.test(entry.name)) continue;
      files.push([`${prefix}${entry.name}`, readFileSync(`${directory}/${entry.name}`, "utf8")]);
    }
  };
  walk(WEB_SOURCE_ROOT, "");
  return files;
}

/** §5.2 steps 0–7 passed and step 8/9 refused it: still a VALIDATED statement. */
const UNUSABLE: NodeE2eeCapabilityVerification = {
  kind: "unusable",
  reason: "pattern_not_admitted",
  statement: { policyGeneration: 8 } as never,
};

/** Genuine first contact: self-signed, no pin anchored it, and it validated. */
const FIRST_CONTACT: NodeE2eeCapabilityVerification = {
  kind: "verified",
  statement: { policyGeneration: 7 } as never,
  selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
  anchor: "none",
};

/** §5.2 steps 0–7 REFUSED it. Nothing validated, so nothing may latch. */
const INVALID: NodeE2eeCapabilityVerification = {
  kind: "invalid",
  reason: "identity_signature_invalid",
};

function observeStatement(verification: NodeE2eeCapabilityVerification): void {
  // The REAL rule, read off the real attempt rather than restated here.
  webRelayE2eeAttempt(SELECTION).onStatement?.(verification);
}

beforeEach(() => {
  clearWebE2eeLatches();
  clearWebE2eeLocalDiagnostics();
  resetWebRelayE2eeForTests();
});

afterEach(() => {
  clearWebE2eeLatches();
  clearWebE2eeLocalDiagnostics();
  resetWebRelayE2eeForTests();
});

describe("§12.1 web latch keying", () => {
  it("keys on the NUL-joined (hubOrigin, accountId, nodeId) triple", () => {
    latchWebE2eeSelection(SELECTION);
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);

    // Each component alone moves the selection, so none of the three is
    // decorative and none is ignored.
    for (const other of [
      { ...SELECTION, hubOrigin: "https://other.example.test" },
      { ...SELECTION, accountId: "acct_9876543210" },
      { ...SELECTION, nodeId: "node_BBBBBBBBBBBBBBBBBBBBBB" },
    ]) {
      expect(isWebE2eeSelectionLatched(other)).toBe(false);
    }
  });

  it("cannot have one selection's key spelled by another's Hub-issued fields", () => {
    // §12.1.1: `accountId` and `nodeId` are Hub-minted, so the Hub picks both
    // halves of the key's tail. A concatenating implementation would let it
    // reuse a latched selection's key from an unlatched pair — which is the
    // direction that RELEASES, since a wrongly-latched pair only closes.
    latchWebE2eeSelection({
      hubOrigin: "https://hub.example.test",
      accountId: "a",
      nodeId: "bc",
    });
    expect(
      isWebE2eeSelectionLatched({
        hubOrigin: "https://hub.example.test",
        accountId: "ab",
        nodeId: "c",
      }),
    ).toBe(false);
  });
});

describe("§12.1 web latch set condition", () => {
  it("sets on the first VALIDATED statement, including an unusable verdict", () => {
    // §12.1: "A statement that is valid but **unusable** under §5.2 step 8, §5.2
    // step 9, or §8.2 has validated and therefore sets the latch, so such a
    // channel takes K2 (`P15`) rather than K3 and no buffered plaintext is
    // flushed at `T_ADV`." This is the inversion that matters: latching from the
    // handshake lock instead would leave exactly this channel unlatched.
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(false);
    observeStatement(UNUSABLE);
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
  });

  it("sets on a self-signed first-contact statement", () => {
    // The narrowly scoped exception to the native set condition: web latches on
    // first contact, which native explicitly MUST NOT do.
    observeStatement(FIRST_CONTACT);
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
  });

  it("does not set when §5.2 steps 0–7 refused the statement", () => {
    observeStatement(INVALID);
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(false);
  });

  it("promotes no pin and satisfies no §13 release gate", () => {
    observeStatement(FIRST_CONTACT);
    // §12.1: the latch "MUST NOT be treated as a verified pin, MUST NOT promote
    // any pin state". The attempt built AFTER it is set carries no pin, no
    // policy generation, and no account scope — a latched selection is strictly
    // stricter, never more trusted. The generation is a separate monotone
    // statement-validation guard, not a pin or a release gate.
    const attempt = webRelayE2eeAttempt(SELECTION);
    expect(attempt.selectionClass).toBe("latched");
    expect(attempt.verifiedPin).toBeUndefined();
    expect(attempt.acceptedPolicyGeneration).toBe(7);
    expect(attempt.accountId).toBeUndefined();
  });
});

describe("§5.7 web application-session policy-generation high-water", () => {
  it("advances monotonically and never regresses", () => {
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBeUndefined();
    recordWebE2eePolicyGeneration(SELECTION, 7);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
    recordWebE2eePolicyGeneration(SELECTION, 6);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
    recordWebE2eePolicyGeneration(SELECTION, 8);
    recordWebE2eePolicyGeneration(SELECTION, 8);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(8);
  });

  it("is isolated by the same selection triple as the latch", () => {
    recordWebE2eePolicyGeneration(SELECTION, 7);
    for (const other of [
      { ...SELECTION, hubOrigin: "https://other.example.test" },
      { ...SELECTION, accountId: "acct_other" },
      { ...SELECTION, nodeId: "node_other" },
    ]) {
      expect(acceptedWebE2eePolicyGeneration(other)).toBeUndefined();
    }
  });

  it("records every validated statement, including unusable, but never invalid", () => {
    observeStatement(FIRST_CONTACT);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
    observeStatement(UNUSABLE);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(8);
    observeStatement(INVALID);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(8);
  });

  it("refuses stale usable and unusable verdicts from overlapping attempts", () => {
    const staleUsable = webRelayE2eeAttempt(SELECTION);
    const staleUnusable = webRelayE2eeAttempt(SELECTION);
    recordWebE2eePolicyGeneration(SELECTION, 9);

    expect(() => staleUsable.onStatement?.(FIRST_CONTACT)).toThrow(
      "Web E2EE policy generation regressed.",
    );
    expect(() => staleUnusable.onStatement?.(UNUSABLE)).toThrow(
      "Web E2EE policy generation regressed.",
    );
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(9);
  });
});

describe("§12.1 the latch never leaves memory", () => {
  it("exports only the bounded in-memory operations and no serializer", () => {
    // A serializer, a snapshot, or an accessor that returned the container is
    // how "MUST NOT persist beyond the application session" gets undone later.
    // There is deliberately nothing to call.
    expect(Object.keys(latchModule).toSorted()).toEqual([
      "acceptedWebE2eePolicyGeneration",
      "clearWebE2eeLatches",
      "isWebE2eeSelectionLatched",
      "latchWebE2eeSelection",
      "recordWebE2eePolicyGeneration",
    ]);
  });

  it("imports no module at all, so no storage API is in its graph", () => {
    // §6.3 forbids web from placing this material in any storage class, and
    // §12.1 forbids it outliving the session. The module's whole graph is
    // itself, so there is no handle to misuse — checked against the source
    // rather than trusted, because an import added later would be invisible to
    // every behavioural assertion above.
    //
    // Comments are stripped first: the module's own header NAMES the APIs it
    // does not touch, and a scan that counted prose would either fail on an
    // honest comment or push the comment out of the file.
    const code = latchSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
    for (const api of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "caches",
      "cookie",
      "JSON",
      "fetch",
      "postMessage",
    ]) {
      expect(code.includes(api), api).toBe(false);
    }
  });
});

describe("§12.1 the latch ends with the application session and not before", () => {
  it("survives the node-scoped clearing catalog, which runs on every node change", () => {
    // THE DIRECTION IS THE WHOLE POINT. `clearWebHostedNodeScopedState` is what
    // `deactivateCurrentHostedNode` calls, and `activateHostedNode` calls that
    // on the node being left whenever the selection moves A→B. Clearing the
    // latch there returns every already-latched selection to `legacy-eligible`,
    // and an unlatched selection is the one that takes row K13 and flushes its
    // buffered sends as plaintext when the Hub withholds the §5.3 carrier past
    // `T_ADV`. §12.1 scopes the latch to the APPLICATION SESSION; a node
    // teardown is not one.
    latchWebE2eeSelection(SELECTION);
    recordWebE2eePolicyGeneration(SELECTION, 7);
    clearWebHostedNodeScopedState(EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa"));
    expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
    expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
    // …and the second selection of an A→B→A round trip is still classified
    // `latched` by the real rule, read off the real attempt.
    expect(webRelayE2eeAttempt(SELECTION).selectionClass).toBe("latched");
  });

  it("is called from exactly one place, and this module says which", () => {
    // The behavioural test above proves the catalog does not clear the latch
    // TODAY. It does not stop the module's own doc comment from claiming the
    // opposite — and that comment is the first thing a maintainer reads, in a
    // file whose entire design premise is that the comment is the mechanism. A
    // sentence naming the clearing catalog as a caller instructs precisely the
    // §12.1.1 relaxation `environment.ts` spends a paragraph forbidding.
    //
    // So the caller set is read off the source of every non-test module in this
    // app, and the doc comment is held to it.
    const callers = webSourceFiles()
      .filter(([, code]) => /\bclearWebE2eeLatches\s*\(/.test(stripComments(code)))
      .map(([path]) => path)
      .toSorted();
    expect(callers).toEqual(["hostedHub/e2eeAttempt.ts", "hostedHub/e2eeLatch.ts"]);

    const doc = latchSource.slice(0, latchSource.indexOf("export function clearWebE2eeLatches"));
    expect(doc).toContain("CALLED ONLY AFTER COMMITTED SIGN-OUT OR SESSION EXPIRY");
    expect(doc).toContain("deliberately does NOT call it");
  });

  it("is cleared on sign-out and survives a node deselect within the session", () => {
    const stop = watchWebHostedSessionForE2ee();
    try {
      hostedHubStore.setState({ accountStatus: "authenticated" });
      latchWebE2eeSelection(SELECTION);

      // A node change is not a session end: §12.1's key already scopes the latch
      // per node, and clearing here would move a selection OUT of `latched`,
      // which is the only direction that releases anything.
      hostedHubStore.setState({ selectedNode: null });
      expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
      expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBeUndefined();

      recordWebE2eePolicyGeneration(SELECTION, 7);
      recordWebE2eePolicyGenerationRegression();
      hostedHubStore.setState({ selectedNode: { id: "node_other" } as never });
      expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
      expect(webE2eeLocalDiagnostics()).toEqual(["e2ee_policy_generation_regressed"]);

      // A failed sign-out restores authenticated and does not end this
      // application session, so none of its rollback guards may relax.
      hostedHubStore.setState({ accountStatus: "signing-out" });
      hostedHubStore.setState({ accountStatus: "authenticated" });
      expect(isWebE2eeSelectionLatched(SELECTION)).toBe(true);
      expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBe(7);
      expect(webE2eeLocalDiagnostics()).toEqual(["e2ee_policy_generation_regressed"]);

      hostedHubStore.setState({ accountStatus: "signing-out" });
      hostedHubStore.setState({ accountStatus: "signed-out" });
      expect(isWebE2eeSelectionLatched(SELECTION)).toBe(false);
      expect(acceptedWebE2eePolicyGeneration(SELECTION)).toBeUndefined();
      expect(webE2eeLocalDiagnostics()).toEqual([]);
    } finally {
      stop();
      hostedHubStore.setState({
        accountStatus: "signed-out",
        selectedNode: null,
      });
    }
  });
});

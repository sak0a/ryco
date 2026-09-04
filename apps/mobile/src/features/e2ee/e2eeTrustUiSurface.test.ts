// The app's `tsconfig` is the react-native one, which resolves no Node builtins;
// this test runs under Node, so it pulls the types in for itself.
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/**
 * Surface properties of the §13 trust UI, asserted over the SOURCE rather than
 * over one call.
 *
 * Three of the slice's rules are only worth anything if they hold everywhere,
 * and "everywhere" is not a thing a unit test of a function can see:
 *
 *  - `docs/relay-e2ee-protocol.md` §13.2: "In no flow may a product silently
 *    promote a self-signed first-contact key to a verified pin." The decision
 *    token is branded and its minter re-derives §13.4 from both keys, which
 *    stops a token being FORGED — it does not stop a second screen from calling
 *    the minter without an owner act. That is a property of the call graph, so
 *    it is checked as one.
 *  - §13.4: the safety number "never travels in any protocol message, log, or
 *    analytics surface".
 *  - `AppSymbol.tsx`: an unmapped SF name renders NOTHING on Android, with no
 *    error, so a trust surface's icon can silently disappear on one platform.
 */

import {
  CLAIM_SYMBOLS,
  E2EE_ACKNOWLEDGEMENT_SYMBOLS,
  E2EE_TRUST_SYMBOLS,
} from "./e2eeTrustSymbols";

const SRC = join(import.meta.dirname, "..", "..");

function sourceFiles(directory: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/u.test(entry.name)) out.push(path);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const ALL_SOURCES = sourceFiles(SRC);
const NON_TEST_SOURCES = ALL_SOURCES.filter((path) => !/\.(test|fuzz\.test)\.tsx?$/u.test(path));

describe("§13.2 step 5 has exactly one construction site", () => {
  it("names the minter nowhere but its definition and this slice's model", () => {
    const referencing = NON_TEST_SOURCES.filter((path) =>
      read(path).includes("mintE2eeOwnerVerificationDecision"),
    ).map((path) => path.slice(SRC.length + 1));
    expect(referencing.toSorted()).toEqual(
      [
        // The constructor itself.
        join("platform", "e2eeTrustStore.ts"),
        // The one screen model, whose action is absent until the owner has
        // compared the §13.4 value on that screen.
        join("features", "e2ee", "e2eeTrustUiModel.ts"),
      ].toSorted(),
    );
  });

  it("promotes a pin from nowhere but that same model", () => {
    // `promote` is the store's only path to a `verified` record. A second caller
    // would need a token it cannot mint, but a second caller is still the shape
    // this rule forbids, so the call site is bounded too.
    const promoting = NON_TEST_SOURCES.filter((path) => /\.promote\(/u.test(read(path))).map(
      (path) => path.slice(SRC.length + 1),
    );
    expect(promoting).toEqual([join("features", "e2ee", "e2eeTrustUiModel.ts")]);
  });

  it("keeps the promotion behind an action that does not exist until the owner acts", () => {
    const model = read(join(SRC, "features", "e2ee", "e2eeTrustUiModel.ts"));
    // The action is produced by a conditional whose test is the acknowledgement,
    // and its false arm is `null` — not a disabled button.
    expect(model).toContain("confirm: draft.comparisonAcknowledged");
    expect(model).toMatch(/comparisonAcknowledged[\s\S]{0,900}?:\s*null,/u);
  });
});

describe("§13.4: the safety number is display-only", () => {
  it("is never logged, reported, or attached to anything that leaves the device", () => {
    // The derivation itself is imported by exactly the modules that DISPLAY the
    // value or mint the decision over it. Anything else importing it would be a
    // new place the value could be produced — including a logger.
    const importers = NON_TEST_SOURCES.filter((path) =>
      read(path).includes("deriveE2eeSafetyNumber"),
    ).map((path) => path.slice(SRC.length + 1));
    expect(importers.toSorted()).toEqual(
      [join("platform", "e2eeTrustStore.ts"), join("hostedHub", "e2eeSession.ts")].toSorted(),
    );
  });

  it("never reaches a console, an observability call, or a persisted value", () => {
    // WHOLE-FILE, not per line. A per-line match only kills the same-line form:
    // `const leaked = display.safetyNumber;` followed by `console.warn(leaked)`
    // on the next line survived it, and so did any helper that took the value as
    // an argument. A file that names the value at all may not name a sink.
    // Word-delimited, so `comparedSafetyNumber` — the minter's INPUT, which the
    // trust store compares and never stores — is covered by its own assertion
    // below rather than making the whole store a carrier of the display value.
    const carriers = [/\bsafetyNumber\b/u, /\bsafetyNumberGroups\b/u];
    const sinks = [
      /console\.\w+\(/u,
      /\breportError\(/u,
      /\btrack\(/u,
      /\bcapture\w*\(/u,
      /\bsetItemAsync\(/u,
      /\bJSON\.stringify\(/u,
      // This repository's only telemetry seam, which the list above did not name
      // at all — `recordPerformance` takes an arbitrary `unknown` payload.
      /\brecordPerformance\(/u,
      /\bperformanceEnabled\(/u,
      /\bmobileObservability\b/u,
      /\btracingLayer\b/u,
      /\bwithSpan\(/u,
      /\bannotateCurrentSpan\(/u,
    ];
    for (const path of NON_TEST_SOURCES) {
      const source = read(path);
      if (!carriers.some((carrier) => carrier.test(source))) continue;
      for (const sink of sinks) {
        expect(sink.test(source), `${path.slice(SRC.length + 1)}: ${String(sink)}`).toBe(false);
      }
    }
  });

  it("is compared by the trust store and never written into its document", () => {
    // §13.4: the client persists no copy at all. The minter re-derives the value
    // and compares it, which is why the store names it; the stored shape and the
    // serializer must not, or the comparison input would become durable state.
    const store = read(join(SRC, "platform", "e2eeTrustStore.ts"));
    const stored = store.slice(
      store.indexOf("interface StoredTrustRecord"),
      store.indexOf("function serializeDocument"),
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(/safetynumber/iu.test(stored)).toBe(false);
  });

  it("keeps the trust surfaces out of the observability adapter's import graph", () => {
    // The importer allowlist, which is the shape that actually works — the check
    // below reads `observability.ts` itself and says nothing about its CALLERS.
    // §13.4's "never travels in any … analytics surface" is a property of who
    // can reach the seam, so no §13 module may reach it at all.
    const importers = NON_TEST_SOURCES.filter(
      (path) =>
        (path.startsWith(join(SRC, "features", "e2ee")) ||
          path.startsWith(join(SRC, "hostedHub"))) &&
        /from "[^"]*platform\/observability"/u.test(read(path)),
    );
    expect(importers.map((path) => path.slice(SRC.length + 1))).toEqual([]);
  });

  it("never enters a §4 attempt, a handshake, or anything the wire path reads", () => {
    // The relay attempt is the one structure that reaches the protocol. Its
    // resolver may name keys and fingerprints; it must not name the display value.
    const attempt = read(join(SRC, "hostedHub", "e2eeAttempt.ts"));
    expect(attempt).not.toContain("safetyNumber");
    const provider = read(join(SRC, "platform", "e2eeRelayProvider.ts"));
    expect(provider).not.toContain("safetyNumber");
  });

  it("is not carried by the observability adapter under any name", () => {
    const observability = read(join(SRC, "platform", "observability.ts"));
    for (const term of ["safetyNumber", "e2ee", "fingerprint", "pin"]) {
      expect(observability.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

describe("every SF Symbol a trust surface renders is mapped for Android", () => {
  const androidMap = (): string => {
    const symbols = read(join(SRC, "components", "AppSymbol.tsx"));
    return symbols.slice(
      symbols.indexOf("ANDROID_ICON_BY_SF_SYMBOL"),
      symbols.indexOf("ANDROID_ICON_BY_MATERIAL_NAME"),
    );
  };
  const isMapped = (mapped: string, name: string): boolean =>
    mapped.includes(`"${name}"`) || mapped.includes(`${name}:`);

  it("resolves every name in the surfaces' own symbol tables", () => {
    // The TABLES, imported, rather than a hardcoded list restating them: a
    // symbol added to `CLAIM_SYMBOLS` or renamed in `E2EE_TRUST_SYMBOLS` is
    // covered by construction, where a restated list silently is not.
    const mapped = androidMap();
    const names = new Set<string>([
      ...E2EE_TRUST_SYMBOLS,
      ...Object.values(CLAIM_SYMBOLS),
      ...Object.values(E2EE_ACKNOWLEDGEMENT_SYMBOLS),
    ]);
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(isMapped(mapped, name), name).toBe(true);
  });

  it("names no SF symbol in a trust screen that the tables do not carry", () => {
    // NOT `name="…"`. Every glyph in this slice is chosen through a ternary or a
    // table lookup, so an attribute-shaped scan saw exactly one of them:
    // `name={view.x ? "checkmark.seal" : "questionmark.diamond"}` — which spans
    // three lines after formatting — and `name={CLAIM_SYMBOLS[props.claim]}`
    // were both invisible to it. On Android an unmapped name renders NOTHING,
    // with no error, so the acknowledgement checkbox the §13.2 step 5 action is
    // gated on would silently disappear on one platform.
    //
    // So the shape is matched instead of the attribute: any string literal that
    // LOOKS like an SF name has to be one of the tables' own, which forces a new
    // glyph through the tables and therefore through the check above.
    const declared = new Set<string>([
      ...E2EE_TRUST_SYMBOLS,
      ...Object.values(CLAIM_SYMBOLS),
      ...Object.values(E2EE_ACKNOWLEDGEMENT_SYMBOLS),
    ]);
    let seen = 0;
    for (const path of NON_TEST_SOURCES.filter(
      (candidate) =>
        candidate.startsWith(join(SRC, "features", "e2ee")) && candidate.endsWith(".tsx"),
    )) {
      for (const match of read(path).matchAll(/"([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)"/gu)) {
        const name = match[1]!;
        seen += 1;
        expect(declared.has(name), `${path.slice(SRC.length + 1)}: ${name}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("the react-native-free convention", () => {
  it("keeps every §13 decision out of a `.tsx`", () => {
    for (const path of ALL_SOURCES.filter(
      (candidate) =>
        candidate.startsWith(join(SRC, "features", "e2ee")) && candidate.endsWith(".tsx"),
    )) {
      const source = read(path);
      // A `.tsx` may lay a view model out; it may not build one, mint a
      // decision, or reach the trust store.
      expect(source).not.toContain("mintE2ee");
      expect(source).not.toContain("mobileE2eeTrustStore");
      expect(source).not.toMatch(/E2EE_UNEXPECTED_NODE_MESSAGES\[/u);
    }
  });

  it("keeps the model and the session projection free of react-native", () => {
    for (const path of [
      join(SRC, "features", "e2ee", "e2eeTrustUiModel.ts"),
      join(SRC, "hostedHub", "e2eeSession.ts"),
    ]) {
      const source = read(path);
      expect(source).not.toMatch(/from "react-native"/u);
      expect(source).not.toMatch(/from "react"/u);
    }
  });
});

describe("the §4.4 provider is actually injected", () => {
  it("builds every hosted relay socket with a resolved E2EE provider", () => {
    // The headline of this slice. `makeMobileRelayE2eeProvider` was built and
    // tested by an earlier slice and reached nothing; this is the wiring that
    // turns it on, and it is asserted here so a refactor that drops the field
    // silently turns native E2EE back off.
    const runtime = read(join(SRC, "hostedHub", "runtime.ts"));
    expect(runtime).toContain("providerForMobileRelaySocketContext(input.preparedSocketContext)");
    expect(runtime).toMatch(
      /createRelaySocket:[\s\S]{0,250}e2ee: providerForMobileRelaySocketContext\(input\.preparedSocketContext\)/u,
    );
    const attempt = read(join(SRC, "hostedHub", "e2eeAttempt.ts"));
    expect(attempt).toContain("makeMobileRelayE2eeProvider");
  });
});

import { E2EE_BROWSER_CROSS_RUNTIME_COVERAGE } from "@ryco/shared/relayE2eeCorpusLiveness";
import { describe, expect, it } from "vite-plus/test";

import {
  F01,
  F02,
  F03,
  F07,
  F08,
  F10,
  F14,
  F16,
  F17,
  F19,
  type E2eeFixtureFamily,
} from "../../../test/e2eeCorpus";

// Executable census for §16.4's browser half. Static fixture imports prove the
// committed JSON was bundled into this Chromium run; Vite's static glob proves
// every declared consumer is still a browser-suite module. Semantic and
// byte-level assertions remain in those consumer files.

const families = new Map<number, E2eeFixtureFamily>([
  [1, F01],
  [2, F02],
  [3, F03],
  [7, F07],
  [8, F08],
  [10, F10],
  [14, F14],
  [16, F16],
  [17, F17],
  [19, F19],
]);

const browserModules = import.meta.glob("./E2ee*.browser.tsx");

describe("§16.4 executable browser coverage census", () => {
  it("loads exactly every declared family from the committed corpus", () => {
    expect([...families.keys()]).toEqual(
      E2EE_BROWSER_CROSS_RUNTIME_COVERAGE.map((entry) => entry.family),
    );
    for (const coverage of E2EE_BROWSER_CROSS_RUNTIME_COVERAGE) {
      const family = families.get(coverage.family);
      expect(family, coverage.fixtureFile).toBeDefined();
      expect(family!.family.number, coverage.fixtureFile).toBe(coverage.family);
      expect(family!.cases.length, coverage.fixtureFile).toBeGreaterThan(0);
    }
  });

  it("keeps every declared consumer inside the browser-suite include path", () => {
    const moduleNames = new Set(Object.keys(browserModules).map((path) => path.split("/").at(-1)));
    for (const coverage of E2EE_BROWSER_CROSS_RUNTIME_COVERAGE) {
      expect(coverage.consumers.length, coverage.fixtureFile).toBeGreaterThan(0);
      for (const consumer of coverage.consumers) {
        expect(moduleNames.has(consumer), `${coverage.fixtureFile}: ${consumer}`).toBe(true);
      }
    }
  });

  it("pins the scoped-family selectors that are narrower than a whole family", () => {
    expect(F03.cases.filter((entry) => entry.name.includes("admitted-pattern-set")).length).toBe(5);
    expect(F14.cases.filter((entry) => entry.name.startsWith("web-sas-")).length).toBe(3);
    expect(
      F16.cases.filter(
        (entry) =>
          entry.inputs.tier === "web" || entry.name.includes("nx") || entry.name.includes("NX"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      F17.cases.filter(
        (entry) =>
          entry.name.includes("p256") ||
          entry.inputs.algorithm === "p256" ||
          entry.inputs.keyFamily === "p256",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      F19.cases.some((entry) => entry.name === "valid-account-enrolled-native-device-grant"),
    ).toBe(true);
  });
});

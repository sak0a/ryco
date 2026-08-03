import { describe, expect, it } from "vitest";

import {
  canSwitchNewThreadProject,
  NEW_THREAD_HERO_PROJECT_NAME_LIMIT,
  resolveNewThreadHeadline,
} from "./NewThreadHero.logic";

describe("resolveNewThreadHeadline", () => {
  it("names the project", () => {
    const headline = resolveNewThreadHeadline({ projectName: "saka-ui" });

    expect(headline.text).toBe("What should we do in saka-ui?");
    expect(headline.prefix).toBe("What should we do in ");
    expect(headline.projectName).toBe("saka-ui");
    expect(headline.suffix).toBe("?");
  });

  it("drops the project slot when there is no project", () => {
    for (const projectName of [null, undefined, "", "   "]) {
      const headline = resolveNewThreadHeadline({ projectName });

      expect(headline.text).toBe("What should we do?");
      expect(headline.projectName).toBeNull();
      expect(headline.suffix).toBe("");
    }
  });

  it("trims surrounding whitespace out of the project name", () => {
    expect(resolveNewThreadHeadline({ projectName: "  ryco  " }).projectName).toBe("ryco");
  });

  it("elides a project name past the limit", () => {
    const longName = "a".repeat(NEW_THREAD_HERO_PROJECT_NAME_LIMIT + 10);
    const headline = resolveNewThreadHeadline({ projectName: longName });

    expect(headline.projectName).toHaveLength(NEW_THREAD_HERO_PROJECT_NAME_LIMIT);
    expect(headline.projectName?.endsWith("…")).toBe(true);
    expect(headline.text).toBe(`What should we do in ${headline.projectName}?`);
  });

  it("keeps a project name exactly at the limit intact", () => {
    const exactName = "b".repeat(NEW_THREAD_HERO_PROJECT_NAME_LIMIT);

    expect(resolveNewThreadHeadline({ projectName: exactName }).projectName).toBe(exactName);
  });
});

describe("canSwitchNewThreadProject", () => {
  it("allows switching on an unlocked draft with somewhere to go", () => {
    expect(
      canSwitchNewThreadProject({ routeKind: "draft", envLocked: false, projectCount: 2 }),
    ).toBe(true);
  });

  it("refuses on server threads, which are already bound to a project", () => {
    expect(
      canSwitchNewThreadProject({ routeKind: "server", envLocked: false, projectCount: 2 }),
    ).toBe(false);
  });

  it("refuses once the thread is locked to an environment", () => {
    expect(
      canSwitchNewThreadProject({ routeKind: "draft", envLocked: true, projectCount: 2 }),
    ).toBe(false);
  });

  it("refuses when there is nowhere else to switch to", () => {
    for (const projectCount of [0, 1]) {
      expect(
        canSwitchNewThreadProject({ routeKind: "draft", envLocked: false, projectCount }),
      ).toBe(false);
    }
  });
});

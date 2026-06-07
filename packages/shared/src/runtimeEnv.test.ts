import { describe, expect, it } from "vitest";

import { parseOptInSourcemapEnv } from "./runtimeEnv.ts";

describe("parseOptInSourcemapEnv", () => {
  it("defaults release sourcemaps off", () => {
    expect(parseOptInSourcemapEnv(undefined)).toBe(false);
    expect(parseOptInSourcemapEnv("")).toBe(false);
    expect(parseOptInSourcemapEnv("0")).toBe(false);
    expect(parseOptInSourcemapEnv("false")).toBe(false);
    expect(parseOptInSourcemapEnv("yes")).toBe(false);
  });

  it("enables sourcemaps only for explicit opt-in values", () => {
    expect(parseOptInSourcemapEnv("1")).toBe(true);
    expect(parseOptInSourcemapEnv("true")).toBe(true);
    expect(parseOptInSourcemapEnv(" TRUE ")).toBe(true);
  });

  it("allows hidden sourcemaps only when the caller supports them", () => {
    expect(parseOptInSourcemapEnv("hidden")).toBe(false);
    expect(parseOptInSourcemapEnv(" hidden ", { allowHidden: true })).toBe("hidden");
  });
});

import { describe, expect, it } from "vitest";

import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from "./color-picker";

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ff8800")).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("parses 3-digit hex by doubling each nibble", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("accepts uppercase and missing hash", () => {
    expect(hexToRgb("FFAA00")).toEqual({ r: 255, g: 170, b: 0 });
  });

  it("returns null for invalid input", () => {
    expect(hexToRgb("not-hex")).toBeNull();
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("formats with leading zeros and lowercase", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 1, g: 17, b: 254 })).toBe("#0111fe");
  });

  it("clamps out-of-range values", () => {
    expect(rgbToHex({ r: -10, g: 300, b: 128 })).toBe("#00ff80");
  });

  it("rounds fractional channels", () => {
    expect(rgbToHex({ r: 127.4, g: 127.6, b: 0 })).toBe("#7f8000");
  });
});

describe("rgbToHsv / hsvToRgb", () => {
  it("round-trips primary colors", () => {
    const cases: Array<[string, { r: number; g: number; b: number }]> = [
      ["red", { r: 255, g: 0, b: 0 }],
      ["green", { r: 0, g: 255, b: 0 }],
      ["blue", { r: 0, g: 0, b: 255 }],
      ["yellow", { r: 255, g: 255, b: 0 }],
      ["magenta", { r: 255, g: 0, b: 255 }],
      ["cyan", { r: 0, g: 255, b: 255 }],
    ];
    for (const [, rgb] of cases) {
      const round = hsvToRgb(rgbToHsv(rgb));
      expect(Math.round(round.r)).toBe(rgb.r);
      expect(Math.round(round.g)).toBe(rgb.g);
      expect(Math.round(round.b)).toBe(rgb.b);
    }
  });

  it("computes hue for orange near 30deg", () => {
    const hsv = rgbToHsv({ r: 255, g: 128, b: 0 });
    expect(hsv.h).toBeGreaterThan(29);
    expect(hsv.h).toBeLessThan(31);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
  });

  it("returns saturation 0 for greys", () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(rgbToHsv({ r: 0, g: 0, b: 0 }).s).toBe(0);
  });

  it("hsvToRgb wraps hue values past 360", () => {
    const a = hsvToRgb({ h: 0, s: 1, v: 1 });
    const b = hsvToRgb({ h: 360, s: 1, v: 1 });
    const c = hsvToRgb({ h: 720, s: 1, v: 1 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

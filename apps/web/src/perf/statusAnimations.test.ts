import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vite-plus/test";

let css = "";

beforeAll(async () => {
  css = await readFile(new URL("../index.css", import.meta.url), "utf8");
});

function cssSection(start: string, end: string): string {
  const startIndex = css.indexOf(start);
  const endIndex = css.indexOf(end, startIndex + start.length);

  expect(startIndex, `Missing CSS marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Missing CSS marker after ${start}: ${end}`).toBeGreaterThan(startIndex);

  return css.slice(startIndex, endIndex);
}

describe("status animation CSS", () => {
  it("steps only the changing pulse ramps and preserves the six-second flat hold", () => {
    const classRule = cssSection(".animate-status-pulse", ".animate-status-ping");
    const keyframes = cssSection("@keyframes status-pulse", "@keyframes status-ping");

    expect(classRule).toContain("animation: status-pulse 6s ease-in-out infinite");
    expect(keyframes.match(/animation-timing-function: steps\(6, end\)/g)).toHaveLength(2);
    expect(keyframes).toMatch(/0%\s*{[^}]*steps\(6, end\)/s);
    expect(keyframes).toMatch(/12%\s*{[^}]*steps\(6, end\)/s);
    expect(keyframes).toMatch(/18%,\s*100%\s*{\s*opacity: 1;/s);
  });

  it("steps the visible ping burst and preserves its long invisible hold", () => {
    const classRule = cssSection(".animate-status-ping", "@keyframes status-pulse");
    const keyframes = cssSection(
      "@keyframes status-ping",
      "@media (prefers-reduced-motion: reduce)",
    );

    expect(classRule).toContain("animation: status-ping 6s cubic-bezier(0, 0, 0.2, 1) infinite");
    expect(keyframes.match(/animation-timing-function: steps\(8, end\)/g)).toHaveLength(1);
    expect(keyframes).toMatch(/0%\s*{[^}]*steps\(8, end\)/s);
    expect(keyframes).toMatch(/24\.01%,\s*100%\s*{[^}]*opacity: 0;[^}]*scale\(2\)/s);
  });

  it("duty-cycles only the scoped Thinking shimmer", () => {
    const keyframes = cssSection(
      "@keyframes thinking-status-shimmer",
      "@media (prefers-reduced-motion: reduce)",
    );
    const scopedClass = cssSection(
      ".thinking-status-shimmer",
      "@keyframes thinking-status-shimmer",
    );

    expect(scopedClass).toContain("animation-name: thinking-status-shimmer");
    expect(scopedClass).toContain("animation-duration: 6s");
    expect(keyframes).toMatch(/0%\s*{[^}]*steps\(8, end\)/s);
    expect(keyframes).toMatch(/20%,\s*100%\s*{\s*background-position: 0 0;/s);

    const vendoredUtility = cssSection("@utility shimmer {", "@utility shimmer-once");
    expect(vendoredUtility).toContain(
      "animation: tw-shimmer var(--shimmer-duration, 2s) linear infinite",
    );
    expect(vendoredUtility).not.toContain("thinking-status-shimmer");
  });

  it("disables the affected animations under reduced motion", () => {
    const statusReducedMotion = cssSection(
      "@media (prefers-reduced-motion: reduce) {\n  .animate-status-pulse",
      "/* Safe-area inset utilities",
    );
    const shimmerReducedMotion = css.slice(css.lastIndexOf("@media (prefers-reduced-motion"));

    expect(statusReducedMotion).toContain(".animate-status-ping");
    expect(statusReducedMotion).toContain("animation: none");
    expect(shimmerReducedMotion).toContain(".thinking-status-shimmer");
    expect(shimmerReducedMotion).toContain("animation: none");
    expect(shimmerReducedMotion).toContain("-webkit-text-fill-color: currentColor");
  });
});

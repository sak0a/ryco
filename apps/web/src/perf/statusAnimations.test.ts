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
  it("uses a continuous subtle breathe for generic active icons", () => {
    const classRule = cssSection(".animate-status-pulse", ".animate-status-ping");
    const keyframes = cssSection("@keyframes status-pulse", "@keyframes status-ping");

    expect(classRule).toContain("animation: status-pulse 1.8s ease-in-out infinite");
    expect(classRule).toContain("--app-motion-activity-play-state");
    expect(keyframes).toMatch(/0%,\s*100%\s*{[^}]*scale\(0\.97\)/s);
    expect(keyframes).toMatch(/50%\s*{[^}]*scale\(1\.04\)/s);
    expect(keyframes).not.toContain("steps(");
  });

  it("keeps ping and dedicated dot halos continuous", () => {
    const classRule = cssSection(".animate-status-ping", "@keyframes status-pulse");
    const signalRule = cssSection(".status-activity-signal", ":root[data-ryco-motion-paused]");
    const keyframes = cssSection("@keyframes status-ping", "@media (prefers-reduced-motion");

    expect(classRule).toContain("animation: status-ping 1.8s");
    expect(signalRule).toContain("animation: status-activity-halo 1.8s");
    expect(signalRule).toContain("border: 1px solid currentColor");
    expect(keyframes).toContain("@keyframes status-activity-halo");
    expect(keyframes).not.toContain("steps(");
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

  it("keeps a colored sidebar wave present throughout its continuous flow", () => {
    const fileEdit = cssSection(".chat-file-edit-text--active", ".chat-final-diff-section");
    const sidebar = cssSection(".sidebar-status-text.sidebar-status-text", "@media (forced-colors");
    const hidden = cssSection(":root[data-ryco-motion-paused]", "@keyframes status-pulse");

    expect(fileEdit).toContain("animation: chat-file-edit-text-shimmer 6s linear infinite");
    expect(fileEdit).toMatch(/0%\s*{[^}]*steps\(8, end\)/s);
    expect(fileEdit).toMatch(/20%,\s*100%/s);
    expect(sidebar).toContain("--sidebar-status-text-duration: 2.35s");
    expect(sidebar).toContain("--sidebar-status-text-crest-color");
    expect(sidebar).toContain("background-repeat: repeat-x");
    expect(sidebar).toContain("background-size: var(--sidebar-status-text-period) 100%");
    expect(sidebar).toContain("animation: sidebar-status-text-flow");
    expect(sidebar).toMatch(/background-position: var\(--sidebar-status-text-period\) center;/s);
    expect(sidebar).not.toMatch(/sidebar-status-text-flow[^]*steps\(/s);
    expect(hidden).toContain(".chat-file-edit-text--active");
    expect(hidden).toContain(".sidebar-status-text--flow");
    expect(hidden).toContain(".status-activity-signal::after");
    expect(hidden).toContain(".thinking-status-shimmer");
    expect(hidden).toContain("animation-play-state: paused");
  });

  it("disables the affected animations under reduced motion", () => {
    const statusReducedMotion = cssSection(
      "@media (prefers-reduced-motion: reduce) {\n  .animate-status-pulse",
      "/* Safe-area inset utilities",
    );
    const shimmerReducedMotion = css.slice(css.lastIndexOf("@media (prefers-reduced-motion"));
    const sidebarReducedMotion = cssSection(
      "@media (prefers-reduced-motion: reduce) {\n    .sidebar-status-text--flow",
      "@media (forced-colors: active)",
    );

    expect(statusReducedMotion).toContain(".animate-status-ping");
    expect(statusReducedMotion).toContain(".status-activity-signal::after");
    expect(statusReducedMotion).toContain("animation: none");
    expect(shimmerReducedMotion).toContain(".thinking-status-shimmer");
    expect(shimmerReducedMotion).toContain("animation: none");
    expect(shimmerReducedMotion).toContain("-webkit-text-fill-color: currentColor");
    expect(sidebarReducedMotion).toContain(".sidebar-status-text--flow");
    expect(sidebarReducedMotion).toContain("animation: none");
    expect(sidebarReducedMotion).toContain("--sidebar-status-text-base-color");
  });
});

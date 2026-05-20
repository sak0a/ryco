import { describe, expect, it } from "vitest";
import { eventToShortcut, formatShortcutTokens, serializeShortcut } from "./shortcutCapture";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

interface EventInput {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

function ev(input: EventInput) {
  const base = {
    key: input.key,
    metaKey: Boolean(input.metaKey),
    ctrlKey: Boolean(input.ctrlKey),
    shiftKey: Boolean(input.shiftKey),
    altKey: Boolean(input.altKey),
  };
  return input.code === undefined ? base : { ...base, code: input.code };
}

describe("eventToShortcut", () => {
  it("collapses Cmd into mod on macOS", () => {
    const shortcut = eventToShortcut(ev({ key: "k", metaKey: true }), { platform: MAC });
    expect(shortcut).toEqual({
      key: "k",
      modKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  it("collapses Ctrl into mod on Linux/Windows", () => {
    const shortcut = eventToShortcut(ev({ key: "k", ctrlKey: true }), { platform: LINUX });
    expect(shortcut).toEqual({
      key: "k",
      modKey: true,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
  });

  it("keeps non-primary modifiers (ctrl on macOS, meta on Linux)", () => {
    const macCtrl = eventToShortcut(ev({ key: "k", ctrlKey: true }), { platform: MAC });
    expect(macCtrl).toMatchObject({ modKey: false, ctrlKey: true });

    const linuxMeta = eventToShortcut(ev({ key: "k", metaKey: true }), { platform: LINUX });
    expect(linuxMeta).toMatchObject({ modKey: false, metaKey: true });
  });

  it("combines multiple modifiers", () => {
    const shortcut = eventToShortcut(
      ev({ key: "k", metaKey: true, shiftKey: true, altKey: true }),
      { platform: MAC },
    );
    expect(shortcut).toMatchObject({
      key: "k",
      modKey: true,
      shiftKey: true,
      altKey: true,
      metaKey: false,
    });
  });

  it("rejects modifier-only events", () => {
    expect(eventToShortcut(ev({ key: "Shift", shiftKey: true }), { platform: MAC })).toBeNull();
    expect(eventToShortcut(ev({ key: "Meta", metaKey: true }), { platform: MAC })).toBeNull();
    expect(eventToShortcut(ev({ key: "Control", ctrlKey: true }), { platform: LINUX })).toBeNull();
  });

  it("rejects plain Escape / Tab / Enter (no modifiers)", () => {
    expect(eventToShortcut(ev({ key: "Escape" }), { platform: MAC })).toBeNull();
    expect(eventToShortcut(ev({ key: "Tab" }), { platform: MAC })).toBeNull();
    expect(eventToShortcut(ev({ key: "Enter" }), { platform: MAC })).toBeNull();
  });

  it("accepts Escape / Tab / Enter when a modifier is held", () => {
    expect(eventToShortcut(ev({ key: "Enter", metaKey: true }), { platform: MAC })).toMatchObject({
      key: "enter",
      modKey: true,
    });
    expect(
      eventToShortcut(ev({ key: "Escape", ctrlKey: true }), { platform: LINUX }),
    ).toMatchObject({ key: "escape", modKey: true });
  });

  it("normalizes the space key", () => {
    expect(eventToShortcut(ev({ key: " ", metaKey: true }), { platform: MAC })).toMatchObject({
      key: "space",
    });
  });

  it("resolves Digit codes to their numeric character", () => {
    expect(
      eventToShortcut(ev({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }), {
        platform: MAC,
      }),
    ).toMatchObject({ key: "1", modKey: true, shiftKey: true });
  });

  it("resolves bracket codes to literal brackets", () => {
    expect(
      eventToShortcut(ev({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }), {
        platform: MAC,
      }),
    ).toMatchObject({ key: "[", modKey: true, shiftKey: true });
  });

  it("returns null for an empty key", () => {
    expect(eventToShortcut(ev({ key: "" }), { platform: MAC })).toBeNull();
  });
});

describe("formatShortcutTokens", () => {
  const baseShortcut = {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: false,
  } as const;

  it("formats mac shortcuts with symbol glyphs", () => {
    expect(
      formatShortcutTokens(
        { ...baseShortcut, key: "k", modKey: true, shiftKey: true },
        { platform: MAC },
      ),
    ).toEqual(["⌘", "⇧", "K"]);
  });

  it("formats linux shortcuts with text labels", () => {
    expect(
      formatShortcutTokens(
        { ...baseShortcut, key: "k", modKey: true, shiftKey: true },
        { platform: LINUX },
      ),
    ).toEqual(["Ctrl", "Shift", "K"]);
  });

  it("displays the space key as 'Space'", () => {
    expect(
      formatShortcutTokens({ ...baseShortcut, key: "space", modKey: true }, { platform: MAC }),
    ).toEqual(["⌘", "Space"]);
  });

  it("displays arrow keys as glyphs", () => {
    expect(
      formatShortcutTokens({ ...baseShortcut, key: "up", modKey: true }, { platform: MAC }),
    ).toEqual(["⌘", "↑"]);
  });

  it("emits modifiers in the canonical order", () => {
    expect(
      formatShortcutTokens(
        {
          ...baseShortcut,
          key: "k",
          modKey: true,
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
        },
        { platform: MAC },
      ),
    ).toEqual(["⌘", "⌃", "⌥", "⇧", "K"]);
  });
});

describe("serializeShortcut", () => {
  it("emits mod+key for a plain mod combo", () => {
    expect(
      serializeShortcut({
        key: "k",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      }),
    ).toBe("mod+k");
  });

  it("emits all modifiers in canonical order", () => {
    expect(
      serializeShortcut({
        key: "k",
        metaKey: true,
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        modKey: true,
      }),
    ).toBe("mod+meta+ctrl+alt+shift+k");
  });

  it("encodes the space key as 'space'", () => {
    expect(
      serializeShortcut({
        key: " ",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      }),
    ).toBe("mod+space");
  });
});

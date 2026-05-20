export interface WhenPreset {
  readonly id: string;
  readonly label: string;
  readonly value: string | undefined;
}

export const WHEN_PRESETS: ReadonlyArray<WhenPreset> = [
  { id: "always", label: "Always", value: undefined },
  { id: "terminalFocus", label: "Terminal focused", value: "terminalFocus" },
  { id: "notTerminalFocus", label: "Not in terminal", value: "!terminalFocus" },
  { id: "terminalOpen", label: "Terminal open", value: "terminalOpen" },
  { id: "notTerminalOpen", label: "Terminal not open", value: "!terminalOpen" },
  { id: "modelPickerOpen", label: "Model picker open", value: "modelPickerOpen" },
  { id: "commandPaletteOpen", label: "Command palette open", value: "commandPaletteOpen" },
  { id: "composerFocus", label: "Composer focused", value: "composerFocus" },
  { id: "notComposerFocus", label: "Not in composer", value: "!composerFocus" },
];

const PRESET_VALUE_INDEX = new Map<string | undefined, WhenPreset>(
  WHEN_PRESETS.map((preset) => [preset.value, preset]),
);

const PRESET_VALUE_NORMALIZED_INDEX = new Map<string | undefined, WhenPreset>(
  WHEN_PRESETS.map((preset) => [
    preset.value === undefined ? undefined : preset.value.replace(/\s+/g, ""),
    preset,
  ]),
);

/**
 * Find the preset that matches a stored `when` string. Tolerates whitespace
 * variation. Returns `undefined` if the value is a custom expression like
 * `terminalOpen && !terminalFocus` that cannot be expressed as a preset.
 */
export function presetForWhen(when: string | undefined): WhenPreset | undefined {
  if (when === undefined) return PRESET_VALUE_INDEX.get(undefined);
  const direct = PRESET_VALUE_INDEX.get(when);
  if (direct) return direct;
  return PRESET_VALUE_NORMALIZED_INDEX.get(when.replace(/\s+/g, ""));
}

/** Plain-English label for any `when` string, falling back to the raw value. */
export function describeWhen(when: string | undefined): string {
  const preset = presetForWhen(when);
  if (preset) return preset.label;
  return when ?? "Always";
}

import type { KeybindingWhenNode } from "@ryco/contracts";

/**
 * Serialize a `whenAst` back to the canonical string form the server expects.
 * Mirrors the server's private `encodeWhenAst`.
 */
export function serializeWhenAst(node: KeybindingWhenNode | undefined): string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${serializeWhenAst(node.node)}`;
    case "and":
      return `(${serializeWhenAst(node.left)} && ${serializeWhenAst(node.right)})`;
    case "or":
      return `(${serializeWhenAst(node.left)} || ${serializeWhenAst(node.right)})`;
  }
}

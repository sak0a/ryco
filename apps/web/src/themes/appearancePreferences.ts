export const APPEARANCE_PREFERENCES_STORAGE_KEY = "ryco:appearance-preferences";
export const APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID = "ryco-appearance-preferences";
export const APPEARANCE_PREFERENCES_CHANGE_EVENT = "ryco:appearance-preferences-change";

export const APPEARANCE_PREFERENCE_KEYS = [
  "fontFamilySans",
  "fontFamilyMono",
  "fontSizeBase",
  "radius",
  "primaryColorMode",
  "primaryColor",
  "surfaceTransparency",
  "panelLayout",
] as const;

export type AppearancePreferenceKey = (typeof APPEARANCE_PREFERENCE_KEYS)[number];

export type AppearancePreferenceOption = {
  value: string;
  label: string;
  description: string;
};

export type AppearancePreferences = Record<AppearancePreferenceKey, string>;

export const FONT_FAMILY_SANS_OPTIONS = [
  {
    value: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "DM Sans",
    description: "Default",
  },
  {
    value: '"Geist", "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    label: "Geist",
    description: "Modern",
  },
  {
    value: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "Inter",
    description: "Neutral",
  },
  {
    value: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif',
    label: "IBM Plex",
    description: "Technical",
  },
  {
    value: '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif',
    label: "Atkinson",
    description: "Readable",
  },
  {
    value: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    label: "System UI",
    description: "Native",
  },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const FONT_FAMILY_MONO_OPTIONS = [
  {
    value: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    label: "SF Mono",
    description: "Default",
  },
  {
    value: '"Geist Mono", "SF Mono", "SFMono-Regular", Consolas, monospace',
    label: "Geist Mono",
    description: "Modern",
  },
  {
    value: '"JetBrains Mono", "SF Mono", "SFMono-Regular", Consolas, monospace',
    label: "JetBrains",
    description: "Editor",
  },
  {
    value: '"Fira Code", "SF Mono", "SFMono-Regular", Consolas, monospace',
    label: "Fira Code",
    description: "Ligatures",
  },
  {
    value: '"IBM Plex Mono", "SF Mono", "SFMono-Regular", Consolas, monospace',
    label: "IBM Plex",
    description: "Technical",
  },
  {
    value: '"Source Code Pro", "SF Mono", "SFMono-Regular", Consolas, monospace',
    label: "Source Code",
    description: "Adobe",
  },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const FONT_SIZE_OPTIONS = [
  { value: "14px", label: "Compact", description: "14 px" },
  { value: "15px", label: "Small", description: "15 px" },
  { value: "16px", label: "Default", description: "16 px" },
  { value: "17px", label: "Roomy", description: "17 px" },
  { value: "18px", label: "Large", description: "18 px" },
  { value: "20px", label: "Display", description: "20 px" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const RADIUS_OPTIONS = [
  { value: "0rem", label: "Square", description: "0 px" },
  { value: "0.375rem", label: "Tight", description: "6 px" },
  { value: "0.625rem", label: "Default", description: "10 px" },
  { value: "0.875rem", label: "Soft", description: "14 px" },
  { value: "1.125rem", label: "Round", description: "18 px" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const SURFACE_TRANSPARENCY_OPTIONS = [
  { value: "default", label: "Solid", description: "0%" },
  { value: "light", label: "Light", description: "8%" },
  { value: "medium", label: "Medium", description: "16%" },
  { value: "high", label: "High", description: "22%" },
  { value: "glass", label: "Glass", description: "28%" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const PRIMARY_COLOR_MODE_OPTIONS = [
  { value: "theme", label: "Theme", description: "Use palette" },
  { value: "custom", label: "Custom", description: "Override" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const PANEL_LAYOUT_OPTIONS = [
  { value: "stack", label: "Stack", description: "Cards" },
  { value: "hybrid", label: "Hybrid", description: "Tiles + cards" },
  { value: "board", label: "Status board", description: "Lanes" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export type PanelLayout = (typeof PANEL_LAYOUT_OPTIONS)[number]["value"];

export const PRIMARY_COLOR_OPTIONS = [
  { value: "#4f46e5", label: "Indigo", description: "Default" },
  { value: "#0ea5e9", label: "Sky", description: "Clear" },
  { value: "#14b8a6", label: "Teal", description: "Calm" },
  { value: "#22c55e", label: "Green", description: "Active" },
  { value: "#f59e0b", label: "Amber", description: "Warm" },
  { value: "#f43f5e", label: "Rose", description: "Bright" },
  { value: "#a855f7", label: "Violet", description: "Sharp" },
] as const satisfies ReadonlyArray<AppearancePreferenceOption>;

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  fontFamilySans: FONT_FAMILY_SANS_OPTIONS[0].value,
  fontFamilyMono: FONT_FAMILY_MONO_OPTIONS[0].value,
  fontSizeBase: "16px",
  radius: "0.625rem",
  primaryColorMode: "theme",
  primaryColor: PRIMARY_COLOR_OPTIONS[0].value,
  surfaceTransparency: "default",
  panelLayout: PANEL_LAYOUT_OPTIONS[0].value,
};

const RADIUS_TOKEN_OFFSETS_PX = {
  sm: -4,
  md: -2,
  lg: 0,
  xl: 4,
  "2xl": 8,
  "3xl": 12,
  "4xl": 16,
} as const;

const OPTION_VALUES: Record<AppearancePreferenceKey, ReadonlySet<string>> = {
  fontFamilySans: new Set(FONT_FAMILY_SANS_OPTIONS.map((option) => option.value)),
  fontFamilyMono: new Set(FONT_FAMILY_MONO_OPTIONS.map((option) => option.value)),
  fontSizeBase: new Set(FONT_SIZE_OPTIONS.map((option) => option.value)),
  radius: new Set(RADIUS_OPTIONS.map((option) => option.value)),
  primaryColorMode: new Set(PRIMARY_COLOR_MODE_OPTIONS.map((option) => option.value)),
  primaryColor: new Set(PRIMARY_COLOR_OPTIONS.map((option) => option.value)),
  surfaceTransparency: new Set(SURFACE_TRANSPARENCY_OPTIONS.map((option) => option.value)),
  panelLayout: new Set(PANEL_LAYOUT_OPTIONS.map((option) => option.value)),
};

const SURFACE_TRANSPARENCY_STEPS: Record<string, number> = {
  default: 0,
  light: 0.08,
  medium: 0.16,
  high: 0.22,
  glass: 0.28,
};

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function parseStoredOverrides(): Partial<AppearancePreferences> {
  if (!hasStorage()) return {};
  const raw = localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const candidate = parsed as Record<string, unknown>;
    const next: Partial<AppearancePreferences> = {};
    for (const key of APPEARANCE_PREFERENCE_KEYS) {
      if (isValidPreferenceValue(key, candidate[key])) {
        const value =
          key === "primaryColor" ? normalizePrimaryColor(candidate[key]) : candidate[key];
        if (typeof value === "string") next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeStoredOverrides(overrides: Partial<AppearancePreferences>): void {
  if (!hasStorage()) return;
  if (Object.keys(overrides).length === 0) {
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    return;
  }
  localStorage.setItem(APPEARANCE_PREFERENCES_STORAGE_KEY, JSON.stringify(overrides));
}

export function isValidPreferenceValue(
  key: AppearancePreferenceKey,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  if (key === "primaryColor") return normalizePrimaryColor(value) !== null;
  return OPTION_VALUES[key].has(value);
}

export function getAppearancePreferences(): AppearancePreferences {
  return { ...DEFAULT_APPEARANCE_PREFERENCES, ...parseStoredOverrides() };
}

export function hasAppearancePreferenceOverride(key: AppearancePreferenceKey): boolean {
  return parseStoredOverrides()[key] !== undefined;
}

export function setAppearancePreference(key: AppearancePreferenceKey, value: string): void {
  if (!isValidPreferenceValue(key, value)) return;
  const normalizedValue = key === "primaryColor" ? normalizePrimaryColor(value) : value;
  if (!normalizedValue) return;
  const overrides = parseStoredOverrides();
  if (normalizedValue === DEFAULT_APPEARANCE_PREFERENCES[key]) {
    delete overrides[key];
  } else {
    overrides[key] = normalizedValue;
  }
  writeStoredOverrides(overrides);
}

export function resetAppearancePreference(key: AppearancePreferenceKey): void {
  const overrides = parseStoredOverrides();
  delete overrides[key];
  writeStoredOverrides(overrides);
}

export function applyAppearancePreferencesToDocument(): void {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  const preferences = getAppearancePreferences();
  const style = ensureAppearancePreferencesStyleElement();
  style.textContent = `:root { --font-family-sans: ${preferences.fontFamilySans}; --font-family-mono: ${preferences.fontFamilyMono}; --font-size-base: ${preferences.fontSizeBase}; ${buildRadiusCssVariables(preferences.radius)} ${buildSurfaceTransparencyCssVariables(preferences.surfaceTransparency)} }${buildPrimaryColorCssRule(preferences)}`;
  dispatchAppearancePreferencesChangeEvent();
}

export function normalizePrimaryColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const shortMatch = /^#?([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch?.[1]) {
    return `#${shortMatch[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  const longMatch = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  if (!longMatch?.[1]) return null;
  return `#${longMatch[1].toLowerCase()}`;
}

function buildRadiusCssVariables(radius: string): string {
  const tokens = Object.entries(RADIUS_TOKEN_OFFSETS_PX)
    .map(
      ([token, offset]) => `--radius-${token}: ${resolveRadiusToken(radius, offset)} !important;`,
    )
    .join(" ");
  return `--radius: ${radius}; ${tokens}`;
}

function resolveRadiusToken(radius: string, offsetPx: number): string {
  if (radius === "0rem") return "0px";
  const baseRem = Number.parseFloat(radius);
  if (!Number.isFinite(baseRem)) return radius;
  const nextPx = Math.max(0, baseRem * 16 + offsetPx);
  return formatRemLength(nextPx / 16);
}

function formatRemLength(rem: number): string {
  if (rem === 0) return "0px";
  return `${Number(rem.toFixed(4))}rem`;
}

function buildSurfaceTransparencyCssVariables(surfaceTransparency: string): string {
  const transparency = SURFACE_TRANSPARENCY_STEPS[surfaceTransparency] ?? 0;
  const surfaceOpacity = 100 - transparency * 100;
  return [
    ["--app-surface-opacity", formatPercent(surfaceOpacity)],
    ["--app-muted-surface-opacity", formatPercent(100 - transparency * 75)],
    ["--app-dialog-viewport-light-alpha", formatPercent(Math.max(34, 48 - transparency * 50))],
    ["--app-dialog-viewport-dark-alpha", formatPercent(Math.max(16, 28 - transparency * 36))],
    ["--app-sheet-backdrop-alpha", formatPercent(Math.max(18, 32 - transparency * 42))],
    ["--app-command-backdrop-opacity", formatPercent(Math.max(38, 60 - transparency * 60))],
    ["--app-glass-light-start-alpha", formatPercent(transparency * 75)],
    ["--app-glass-light-end-alpha", formatPercent(transparency * 32)],
    ["--app-glass-foreground-alpha", formatPercent(transparency * 18)],
    ["--app-glass-light-popover-alpha", formatPercent(surfaceOpacity)],
    ["--app-glass-dark-start-alpha", formatPercent(transparency * 18)],
    ["--app-glass-dark-end-alpha", formatPercent(transparency * 5)],
    ["--app-glass-dark-popover-alpha", formatPercent(surfaceOpacity)],
  ]
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

function buildPrimaryColorCssRule(preferences: AppearancePreferences): string {
  if (preferences.primaryColorMode !== "custom") return "";
  const primaryColor = normalizePrimaryColor(preferences.primaryColor);
  if (!primaryColor) return "";
  const primaryForeground = resolvePrimaryForeground(primaryColor);
  return ` :root, :root.dark { --primary: ${primaryColor}; --ring: ${primaryColor}; --primary-foreground: ${primaryForeground}; }`;
}

function resolvePrimaryForeground(hex: string): string {
  const normalized = normalizePrimaryColor(hex);
  if (!normalized) return "#ffffff";
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const srgb = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
  return luminance > 0.46 ? "#0f172a" : "#ffffff";
}

function formatPercent(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

function ensureAppearancePreferencesStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) {
    document.head.append(existing);
    return existing;
  }
  const style = document.createElement("style");
  style.id = APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID;
  document.head.append(style);
  return style;
}

function dispatchAppearancePreferencesChangeEvent(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_CHANGE_EVENT));
}

export const APPEARANCE_PREFERENCES_STORAGE_KEY = "ryco:appearance-preferences";
export const APPEARANCE_PREFERENCES_STYLE_ELEMENT_ID = "ryco-appearance-preferences";
export const APPEARANCE_PREFERENCES_CHANGE_EVENT = "ryco:appearance-preferences-change";

export const APPEARANCE_PREFERENCE_KEYS = [
  "fontFamilySans",
  "fontFamilyMono",
  "fontSizeBase",
  "radius",
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

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  fontFamilySans: FONT_FAMILY_SANS_OPTIONS[0].value,
  fontFamilyMono: FONT_FAMILY_MONO_OPTIONS[0].value,
  fontSizeBase: "16px",
  radius: "0.625rem",
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
        next[key] = candidate[key];
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
  return typeof value === "string" && OPTION_VALUES[key].has(value);
}

export function getAppearancePreferences(): AppearancePreferences {
  return { ...DEFAULT_APPEARANCE_PREFERENCES, ...parseStoredOverrides() };
}

export function hasAppearancePreferenceOverride(key: AppearancePreferenceKey): boolean {
  return parseStoredOverrides()[key] !== undefined;
}

export function setAppearancePreference(key: AppearancePreferenceKey, value: string): void {
  if (!isValidPreferenceValue(key, value)) return;
  const overrides = parseStoredOverrides();
  if (value === DEFAULT_APPEARANCE_PREFERENCES[key]) {
    delete overrides[key];
  } else {
    overrides[key] = value;
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
  style.textContent = `:root { --font-family-sans: ${preferences.fontFamilySans}; --font-family-mono: ${preferences.fontFamilyMono}; --font-size-base: ${preferences.fontSizeBase}; ${buildRadiusCssVariables(preferences.radius)} }`;
  dispatchAppearancePreferencesChangeEvent();
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

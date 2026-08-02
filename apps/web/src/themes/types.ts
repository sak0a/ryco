export const THEME_TOKEN_NAMES = [
  "background",
  "app-chrome-background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "info",
  "info-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "scrollbar-thumb-thin",
  "scrollbar-thumb-thin-hover",
  // Retained so existing custom themes still import after the composited
  // full-screen noise layer was removed. It is no longer rendered or edited.
  "noise-opacity",
  "radius",
  "font-family-sans",
  "font-family-mono",
  "font-size-base",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokenKind = "color" | "opacity" | "length" | "font-family";

export const THEME_TOKEN_META: Readonly<Record<ThemeTokenName, { kind: ThemeTokenKind }>> = {
  background: { kind: "color" },
  "app-chrome-background": { kind: "color" },
  foreground: { kind: "color" },
  card: { kind: "color" },
  "card-foreground": { kind: "color" },
  popover: { kind: "color" },
  "popover-foreground": { kind: "color" },
  primary: { kind: "color" },
  "primary-foreground": { kind: "color" },
  secondary: { kind: "color" },
  "secondary-foreground": { kind: "color" },
  muted: { kind: "color" },
  "muted-foreground": { kind: "color" },
  accent: { kind: "color" },
  "accent-foreground": { kind: "color" },
  destructive: { kind: "color" },
  "destructive-foreground": { kind: "color" },
  border: { kind: "color" },
  input: { kind: "color" },
  ring: { kind: "color" },
  info: { kind: "color" },
  "info-foreground": { kind: "color" },
  success: { kind: "color" },
  "success-foreground": { kind: "color" },
  warning: { kind: "color" },
  "warning-foreground": { kind: "color" },
  "scrollbar-thumb": { kind: "color" },
  "scrollbar-thumb-hover": { kind: "color" },
  "scrollbar-thumb-thin": { kind: "color" },
  "scrollbar-thumb-thin-hover": { kind: "color" },
  "noise-opacity": { kind: "opacity" },
  radius: { kind: "length" },
  "font-family-sans": { kind: "font-family" },
  "font-family-mono": { kind: "font-family" },
  "font-size-base": { kind: "length" },
};

export function getTokenKind(token: string): ThemeTokenKind | null {
  if (token in THEME_TOKEN_META) return THEME_TOKEN_META[token as ThemeTokenName].kind;
  return null;
}

export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;

export type ThemeVariant = "light" | "dark";

export type ThemeDefinition = {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  light?: ThemeTokens;
  dark?: ThemeTokens;
};

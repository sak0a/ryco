import type { AgentTokenMode } from "@ryco/contracts";
import { CircleOffIcon, Minimize2Icon, ScaleIcon, type LucideIcon } from "lucide-react";

export type TokenModePresentation = {
  label: string;
  triggerLabel: string;
  description: string;
  icon: LucideIcon;
};

export const tokenModePresentation: Record<AgentTokenMode, TokenModePresentation> = {
  off: {
    label: "Off",
    triggerLabel: "Tokens off",
    description: "Do not add Ryco token-efficiency instructions.",
    icon: CircleOffIcon,
  },
  balanced: {
    label: "Balanced",
    triggerLabel: "Balanced",
    description: "Favor concise answers and targeted reads without hiding important detail.",
    icon: ScaleIcon,
  },
  aggressive: {
    label: "Aggressive",
    triggerLabel: "Aggressive",
    description: "Minimize prose and avoid copying large outputs unless needed.",
    icon: Minimize2Icon,
  },
};

export const tokenModeOptions = Object.keys(tokenModePresentation) as AgentTokenMode[];

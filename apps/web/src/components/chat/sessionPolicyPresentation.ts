import type { ProviderInteractionMode, RuntimeMode } from "@ryco/contracts";
import {
  ClipboardListIcon,
  HammerIcon,
  type LucideIcon,
  LockIcon,
  LockOpenIcon,
  MessageCircleQuestionMarkIcon,
  PenLineIcon,
} from "lucide-react";

/**
 * Labels, descriptions, and glyphs for the two session-policy mode axes.
 *
 * Extracted from `ComposerFooter` unchanged so the phone session-policy sheet
 * presents exactly the same vocabulary as the desktop selects rather than a
 * second copy of it. No semantics live here — only presentation.
 */

export interface SessionPolicyOptionPresentation {
  readonly label: string;
  readonly triggerLabel: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const runtimeModeConfig: Record<RuntimeMode, SessionPolicyOptionPresentation> = {
  "approval-required": {
    label: "Supervised",
    triggerLabel: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    triggerLabel: "Auto-accept",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    triggerLabel: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/**
 * The one runtime mode that removes every prompt before a command runs. It
 * carries a warning treatment wherever it is offered, and must never be
 * selectable other than by its own deliberate activation.
 */
export const CAUTION_RUNTIME_MODE: RuntimeMode = "full-access";

export const interactionModeConfig: Record<
  ProviderInteractionMode,
  SessionPolicyOptionPresentation
> = {
  default: {
    label: "Build",
    triggerLabel: "Build",
    description: "Make changes and run commands.",
    icon: HammerIcon,
  },
  plan: {
    label: "Plan",
    triggerLabel: "Plan",
    description: "Chat toward a plan before making changes.",
    icon: ClipboardListIcon,
  },
  ask: {
    label: "Ask",
    triggerLabel: "Ask",
    description: "Read-only — answer questions without editing files.",
    icon: MessageCircleQuestionMarkIcon,
  },
};

export const interactionModeOptions = Object.keys(
  interactionModeConfig,
) as ProviderInteractionMode[];

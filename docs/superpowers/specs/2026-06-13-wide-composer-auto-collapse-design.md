# Wide Composer Auto-Collapse

## Goal

Add a default-on Appearance setting that keeps the wide chat composer footer compact by collapsing long mode labels to icons at rest, then revealing the relevant label smoothly when the user hovers, focuses, or opens that control.

The feature targets the high-noise controls in the wide footer: Build/Plan, runtime/security mode, token-efficiency mode, and the active-plan sidebar toggle. Compact/narrow composer behavior remains unchanged and continues to use the existing `...` controls menu.

## Scope

In scope:

- New persisted UI preference, `wideComposerControlsAutoCollapse`, defaulting to `true`.
- Appearance Settings entry under "Composer controls" with a reset action.
- Wide composer footer behavior only:
  - Build/Plan toggle collapses to its icon at rest.
  - Runtime/security select collapses to its icon at rest.
  - Token-efficiency select collapses to its icon at rest.
  - Plan sidebar toggle collapses to its icon at rest.
- Independent expansion: only the hovered, focused, or open control expands. The surrounding control group does not expand as a whole.
- Shared reusable component/helper for icon + expandable label rendering, used by both button-like controls and select triggers.
- Accessibility parity with today's controls: stable `aria-label`, keyboard focus expansion, and existing menu/select behavior.
- Tests for persistence, rendering defaults, token-style interaction, and wide-vs-compact behavior.

Out of scope:

- Changing the compact `CompactComposerControlsMenu` behavior or menu content.
- Collapsing provider trait chips such as reasoning, fast mode, context window, thinking, or agent.
- Changing the model picker.
- Removing the existing `tokenModeControlStyle` preference. It remains active when wide auto-collapse is disabled.
- Group-level expansion where hovering one control expands all controls.

## User Experience

When the setting is enabled, the wide footer reads as a compact icon strip:

```text
[model picker] [bot icon] [lock icon] [gauge icon] [plan icon] [send]
```

When the user hovers or focuses a control, only that control expands:

```text
[model picker] [bot icon] [lock icon Full access] [gauge icon] [plan icon] [send]
```

Select controls also stay expanded while their popup is open, so the currently active mode remains visible during menu interaction.

The default enabled state means new and existing users get the cleaner composer immediately after the change ships. Users who prefer persistent text labels can turn the setting off in Appearance settings.

## Appearance Settings

Extend `apps/web/src/uiStateStore.ts`:

```ts
export interface PersistedUiState {
  // ...
  wideComposerControlsAutoCollapse?: boolean;
}

export interface UiState {
  // ...
  wideComposerControlsAutoCollapse: boolean;
}
```

Default and sanitization:

- Missing value defaults to `true`.
- Only a boolean persisted value is accepted.
- Invalid values fall back to `true`.
- Add `setWideComposerControlsAutoCollapse(enabled: boolean)`.

In `apps/web/src/components/settings/AppearanceSettings.tsx`, add a row under "Composer controls":

- Title: `Auto-collapse wide composer labels`
- Description: `Show long composer mode labels only on hover or focus.`
- Control: binary toggle/check-style button consistent with existing settings UI.
- Reset action appears when the value is `false` and restores `true`.

The existing `Token mode style` row stays. Its description should clarify that it applies when auto-collapse is disabled, because auto-collapse intentionally renders token mode as icon-only at rest.

## Component Design

Add a small shared primitive, colocated with the chat composer controls unless reuse elsewhere appears immediately useful:

```ts
interface ComposerExpandableLabelControlProps {
  icon: React.ReactNode;
  label: React.ReactNode;
  collapsed: boolean;
  expanded?: boolean;
  className?: string;
  labelClassName?: string;
}
```

The primitive renders icon and label with stable control height and no layout shift outside the hovered/focused control. It does not own click handling, menu state, or button semantics. Consumers place it inside `Button` or `SelectTrigger`.

Behavior:

- `collapsed === false`: render icon and label normally.
- `collapsed === true`: keep icon visible, hide label with `max-width: 0`, opacity `0`, and clipped overflow.
- `hover`, `focus-visible`, `focus-within`, select trigger `data-pressed`, or explicit `expanded === true`: animate label to its content width and opacity `1`.
- Use a bounded `max-width` large enough for the known labels (`Build`, `Plan`, `Supervised`, `Auto-accept`, `Full access`, `Tokens off`, `Balanced`, `Aggressive`, and plan sidebar labels).
- Respect reduced motion by allowing the global CSS/Tailwind reduced-motion utilities to disable or shorten transitions.

The primitive should avoid measuring text in JavaScript. CSS-only expansion is sufficient and lower risk.

## Composer Wiring

In `ComposerFooterModeControls`:

- Read `wideComposerControlsAutoCollapse` from `useUiStateStore`.
- Compute `autoCollapse = wideComposerControlsAutoCollapse`.
- Apply the expandable primitive to:
  - interaction mode button,
  - runtime `SelectTrigger`,
  - token mode `SelectTrigger`,
  - plan sidebar button.

Runtime/security select:

- Preserve the current orange warning tint for `full-access`.
- Keep the current select popup unchanged.
- Keep the trigger expanded while the select is open by targeting the existing Base UI `data-pressed` state on `SelectTrigger`; do not introduce controlled select state only for this animation.

Token-efficiency select:

- When `autoCollapse` is enabled, render icon + expandable label regardless of `tokenModeControlStyle`.
- When `autoCollapse` is disabled, preserve current `tokenModeControlStyle` behavior exactly:
  - `icon-text`: icon + label,
  - `icon`: icon only,
  - `text`: label only.

Plan sidebar button:

- Only rendered when `showPlanToggle` is true, same as today.
- Existing active blue tint remains.
- Collapsed at rest only when auto-collapse is enabled.

Compact footer:

- `shouldUseCompactComposerFooter` and `CompactComposerControlsMenu` remain unchanged.
- The new setting has no effect once the composer switches into compact footer mode.

## Accessibility

- Existing `aria-label` values stay descriptive even when visible text is collapsed.
- Hover is not the only reveal path. Keyboard users get the label on focus/focus-within.
- Select triggers remain discoverable through the same labels and menu contents as today.
- Collapsed labels are visually hidden by clipping and opacity, not removed from the DOM, so the animation can stay smooth. Screen reader naming still comes from explicit `aria-label` on icon-only-looking controls.
- The setting control in Appearance is keyboard operable and announces its checked state.

## Performance And Reliability

- No runtime measurement, resize observers, timers, or animation JavaScript.
- No changes to provider option descriptors, contracts, WebSocket messages, or session state.
- The setting is stored with other UI preferences and debounced through the existing persistence path.
- CSS-only expansion keeps behavior predictable under frequent composer re-renders.

## Testing

Unit/store tests:

- `uiStateStore.test.ts` covers the default `true` value.
- Sanitization accepts only booleans.
- Setter returns a new state when changed and no-ops when unchanged.
- Persistence writes `wideComposerControlsAutoCollapse`.

Component/browser tests:

- Appearance settings renders the new row, toggles the value, and shows reset only when disabled.
- Wide composer with auto-collapse enabled renders affected controls with collapsed-label styling.
- Wide composer with auto-collapse disabled preserves visible labels and existing token style behavior.
- Token mode style is overridden only while auto-collapse is enabled.
- Compact composer continues to show `CompactComposerControlsMenu` and does not render the wide auto-collapse treatment.
- Hover/focus behavior reveals a label for at least one button control and one select trigger.

Verification before completion:

- `bun fmt`
- `bun lint`
- `bun typecheck`

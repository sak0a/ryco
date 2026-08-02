# Sidebar Inbox visual density implementation plan

**Design:** `docs/superpowers/specs/2026-08-01-sidebar-inbox-visual-density-design.md`

**Goal:** Give Inbox threads distinct inset surfaces, reduce the filter controls to a responsive
icon-led row, center local Search content, and make the selected Workspace or Inbox view
unmistakable without changing Inbox behavior or data flow.

## Task 1: Pin the visual contracts with browser tests

**Files:**

- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Extend the view-toggle harness to assert that the selected and unselected tabs expose different
   stable presentation states while preserving `aria-selected` and arrow-key behavior.
2. Extend the Inbox row harness with a current entry and assert that resting, hovered, and current
   rows retain identical outer geometry while exposing distinct surface states.
3. Add a filter harness narrow enough to cross the 5.25rem container threshold and assert that only
   the text label hides; artwork, chevron, title, and accessible name remain available.
4. Open a filter popup and assert that option artwork and text precede the selected indicator in
   horizontal geometry.
5. Render `SidebarInboxFilters` and assert that the local search wrapper and inner input share the
   intended height, with the input line box centered and its left inset clearing the search icon.
6. Run the focused browser file and confirm the new expectations fail for the current presentation:

   ```sh
   bun run --cwd apps/web test:browser -- src/components/sidebar/SidebarViewToggle.browser.tsx
   ```

## Task 2: Add an opt-in end indicator to the shared combobox item

**Files:**

- Modify: `apps/web/src/components/ui/combobox.tsx`
- Modify: `apps/web/src/components/sidebar/inbox/InboxFilterCombobox.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Add `indicatorPosition?: "start" | "end"` to `ComboboxItem`, defaulting to `"start"`.
2. Preserve the current start-indicator grid and padding exactly for every existing caller.
3. For the end variant, render content in the flexible first column and the semantic
   `ItemIndicator` in a fixed final column with matching right inset.
4. Keep `hideIndicator` compatible with both positions and prevent long content from overlapping
   the indicator slot.
5. Opt Inbox filter options into `indicatorPosition="end"`; keep artwork and text in one truncating
   content row.
6. Run the focused browser test and verify both the option selection behavior and horizontal order.

## Task 3: Compact and responsively collapse the Inbox filters

**Files:**

- Modify: `apps/web/src/components/sidebar/inbox/InboxFilterCombobox.tsx`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInboxFilters.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Wrap each combobox trigger in a named size container so its child can react to that trigger's
   actual allocated width.
2. Reduce the closed trigger to a 24px visual height with tighter horizontal padding, artwork gap,
   and chevron sizing while preserving `min-w-0` and focus behavior.
3. Hide the visible label below 5.25rem and reveal it at or above that threshold. Keep the artwork
   and chevron fixed and centered in the remaining space.
4. Preserve the complete `Filter by <category>: <value>` accessible name and `<Category>: <value>`
   title in both modes.
5. Tighten the three-column grid without changing its equal-width behavior or filter dependency
   semantics.
6. Run the focused browser tests at wide and narrow harness widths.

## Task 4: Correct local thread-search geometry

**Files:**

- Modify: `apps/web/src/components/sidebar/inbox/SidebarInboxFilters.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Target the inner `[data-slot=input]` element rather than applying height and padding only to the
   `SidebarInput` wrapper.
2. Give the wrapper and inner search control the same explicit height, zero asymmetric vertical
   padding, and a matching line height.
3. Apply the left inset to the inner input so placeholder and typed text clear the centered search
   icon.
4. Keep native search decorations suppressed through the existing Input primitive and preserve the
   `Search Inbox` accessible name.
5. Run the focused browser test and inspect placeholder and typed-text geometry.

## Task 5: Strengthen the Workspace / Inbox selected state

**Files:**

- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Give the tab track a restrained semantic border, quieter surface, and inset separation from the
   surrounding sidebar chrome.
2. Give every tab a transparent border so switching states cannot change geometry.
3. Apply the stronger semantic fill, border, foreground, and restrained shadow only to the selected
   tab.
4. Keep inactive hover visibly weaker than selection and preserve existing dimensions, icons,
   labels, roles, roving tab index, and arrow-key switching.
5. Run the focused view-toggle browser tests.

## Task 6: Introduce inset thread-card surfaces in both list paths

**Files:**

- Modify: `apps/web/src/components/sidebar/inbox/SidebarInboxRow.tsx`
- Modify: `apps/web/src/components/sidebar/inbox/SidebarInbox.tsx`
- Modify: `apps/web/src/components/sidebar/SidebarViewToggle.browser.tsx`

1. Give every row a transparent structural border plus a resting `sidebar-accent` surface so hover
   and current states do not alter dimensions.
2. Compose progressively stronger resting, hover/focus-within, and current surface and border states;
   keep the current state stronger than hover in both themes.
3. Retain the settled-row opacity hierarchy while giving it the same recognizable card outline.
4. Increase list separation to one compact spacing step in the non-virtual active, current-settled,
   and settled groups.
5. Match that spacing in the LegendList row wrapper and update the active-row estimate from 78px to
   the resulting 82px pitch.
6. Preserve fixed provider, status, and action slots, tooltip anchoring, context-menu targeting, and
   reduced-motion behavior.
7. Run the focused browser tests and verify row geometry before and after hover/focus.

## Task 7: Visual QA and focused regression checks

1. Build the web package and run the focused browser test file.
2. Inspect the live app at normal and narrow supported desktop sidebar widths in dark and light
   themes.
3. Verify active and settled cards, current and hover states, provider stability, hover detail-card
   placement, Settle and Move to Active actions, filter popup alignment, right-side checks, icon-only
   transitions, local Search centering, and selected-view contrast.
4. Exercise keyboard tab switching, combobox navigation and dismissal, focus restoration, and row
   actions.
5. Check the browser console for render, hydration, layout, and accessibility errors.

## Task 8: Full validation

1. Install with the Bun version pinned in `package.json`:

   ```sh
   bun install --frozen-lockfile
   ```

2. Run the complete repository backstop:

   ```sh
   bun fmt
   bun run fmt:check
   bun lint
   bun typecheck
   bun run typecheck:effect
   bun run test
   bun run build
   ```

3. Run the required web build and browser suite. Install the pinned browser runtime first only if it
   is missing:

   ```sh
   bun run build --filter=@ryco/web
   bun run --cwd apps/web test:browser:install
   bun run --cwd apps/web test:browser
   ```

4. Inspect the final diff for scope, verify no server or contract behavior changed, and report the
   pre-existing generated declaration and Android Gradle worktree changes separately.

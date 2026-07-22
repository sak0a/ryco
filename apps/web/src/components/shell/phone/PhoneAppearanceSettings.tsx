import { useState } from "react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

import {
  useAppearancePreference,
  useSurfaceTransparencyReducedBySystem,
} from "../../../hooks/useAppearancePreference";
import {
  FONT_SIZE_OPTIONS,
  MOTION_OPTIONS,
  PHONE_MATERIAL_OPTIONS,
  SOLID_SURFACE_TRANSPARENCY,
  SURFACE_TRANSPARENCY_OPTIONS,
  applyAppearancePreferencesToDocument,
  setAppearancePreference,
  type AppearancePreferenceKey,
  type AppearancePreferenceOption,
} from "../../../themes/appearancePreferences";
import { MobileListRow } from "../../mobile/MobileListRow";
import {
  MobileSheet,
  MobileSheetDescription,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
} from "../../mobile/MobileSheet";

interface PhoneAppearanceControl {
  readonly key: AppearancePreferenceKey;
  readonly label: string;
  readonly description: string;
  /** The options offered on the phone. */
  readonly options: ReadonlyArray<AppearancePreferenceOption>;
  /**
   * Every value the key can hold. For Material this is wider than `options`:
   * the phone offers three of the five steps, and the desktop Appearance panel
   * — reachable on the phone too — can store either of the other two. The row
   * must still name the real current step rather than render blank.
   */
  readonly scale: ReadonlyArray<AppearancePreferenceOption>;
}

const SOLID_LABEL =
  SURFACE_TRANSPARENCY_OPTIONS.find((option) => option.value === SOLID_SURFACE_TRANSPARENCY)
    ?.label ?? "Solid";

/** Bounded, and stated as an override rather than as the selection. */
const SYSTEM_TRANSPARENCY_OVERRIDE = `System reduce transparency is on, showing ${SOLID_LABEL}`;

/**
 * The phone appearance group.
 *
 * **Material** writes the existing `surfaceTransparency` key through a
 * three-option subset of the desktop scale — Solid / Standard / Glass — so the
 * phone exposes fewer steps of one axis rather than a competing axis. **Text
 * size** writes the same `fontSizeBase` key the desktop control writes.
 * **Motion** reduces the sheet and stack-push animation beyond the OS setting.
 *
 * Every row displays and writes the same source of truth — the selected value —
 * so a system override can never be persisted as though it were a choice.
 *
 * Dock density ships with the dock.
 */
const PHONE_APPEARANCE_CONTROLS: ReadonlyArray<PhoneAppearanceControl> = [
  {
    key: "surfaceTransparency",
    label: "Material",
    description: "How much of the content behind a surface shows through.",
    options: PHONE_MATERIAL_OPTIONS,
    scale: SURFACE_TRANSPARENCY_OPTIONS,
  },
  {
    key: "fontSizeBase",
    label: "Text size",
    description: "The base type size for the whole interface.",
    options: FONT_SIZE_OPTIONS,
    scale: FONT_SIZE_OPTIONS,
  },
  {
    key: "motion",
    label: "Motion",
    description: "Reduce sheet and stack animation beyond the system setting.",
    options: MOTION_OPTIONS,
    scale: MOTION_OPTIONS,
  },
];

function PhoneAppearanceControlRow({ control }: { readonly control: PhoneAppearanceControl }) {
  const [open, setOpen] = useState(false);
  // The selection, which is exactly what a tap writes back: the stored value,
  // or the phone tier's unstored default. It deliberately does NOT fold in
  // `prefers-reduced-transparency` — that override is reported separately and
  // enforced in CSS, so displaying it here would let a tap on the displayed
  // selection overwrite the stored choice with the forced one.
  const value = useAppearancePreference(control.key, { effective: true });
  const reducedBySystem = useSurfaceTransparencyReducedBySystem();
  const overrideNote =
    control.key === "surfaceTransparency" && reducedBySystem ? SYSTEM_TRANSPARENCY_OVERRIDE : null;
  // Resolved from the offered options first — those carry the phone's own
  // labels, which differ from the desktop scale's — then from the full scale,
  // so a step the phone does not offer still names itself instead of leaving
  // the row blank.
  const offered = control.options.find((option) => option.value === value) ?? null;
  const current = offered ?? control.scale.find((option) => option.value === value) ?? null;
  const offeredHere = offered !== null;

  const select = (next: string) => {
    setAppearancePreference(control.key, next);
    applyAppearancePreferencesToDocument();
    setOpen(false);
  };

  return (
    <>
      <MobileListRow
        label={control.label}
        secondaryText={
          overrideNote && current ? `${current.label} · ${overrideNote}` : (current?.label ?? null)
        }
        trailing={<ChevronRightIcon aria-hidden className="size-4 text-muted-foreground/60" />}
        onClick={() => setOpen(true)}
      />
      <MobileSheet open={open} onOpenChange={setOpen} label={control.label} detent="medium">
        <MobileSheetHeader>
          <MobileSheetTitle>{control.label}</MobileSheetTitle>
          <MobileSheetDescription>
            {control.description}
            {/* Neither of these is a warning: they explain why no row is
                checked, or why the checked row is not what renders. */}
            {!offeredHere && current ? ` Currently ${current.label}.` : null}
            {overrideNote ? ` ${overrideNote}.` : null}
          </MobileSheetDescription>
        </MobileSheetHeader>
        <MobileSheetPanel>
          <div role="group" aria-label={control.label} className="flex flex-col">
            {control.options.map((option) => (
              <MobileListRow
                key={option.value}
                label={option.label}
                secondaryText={option.description}
                selected={option.value === value}
                trailing={
                  option.value === value ? <CheckIcon aria-hidden className="size-4" /> : null
                }
                onClick={() => select(option.value)}
              />
            ))}
          </div>
        </MobileSheetPanel>
      </MobileSheet>
    </>
  );
}

/** The phone appearance group rendered inside the phone settings list. */
export function PhoneAppearanceSettings() {
  return (
    <div role="group" aria-label="Phone appearance" className="flex flex-col">
      {PHONE_APPEARANCE_CONTROLS.map((control) => (
        <PhoneAppearanceControlRow key={control.key} control={control} />
      ))}
    </div>
  );
}

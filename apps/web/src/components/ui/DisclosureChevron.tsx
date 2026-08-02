// FILE: DisclosureChevron.tsx
// Purpose: Shared rotating chevron for collapsible headers across the transcript.
// Layer: UI primitive
// Exports: DisclosureChevron

import { ChevronRightIcon } from "lucide-react";

import { disclosureChevronClassName } from "../../lib/disclosureMotion";

export function DisclosureChevron(props: { open: boolean; className?: string | undefined }) {
  const { open, className } = props;

  return (
    <ChevronRightIcon aria-hidden="true" className={disclosureChevronClassName(open, className)} />
  );
}

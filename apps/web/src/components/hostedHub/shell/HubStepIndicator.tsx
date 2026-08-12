/**
 * The progress line for a multi-step Hub ceremony — signup, password reset,
 * node enrollment.
 *
 * These flows are three to five steps long and currently give no indication
 * that a step is one of several, so a person entering an email code cannot tell
 * whether they are nearly finished or nearly starting.
 *
 * Announced once, as text, rather than as a list of decorative dots: the
 * position is the information, and a screen reader should hear "Step 2 of 4"
 * instead of counting bullets. The dots are `aria-hidden` and exist for the
 * sighted reading of the same fact.
 */
export function HubStepIndicator({
  step,
  total,
  label,
}: {
  /** The current step, 1-based. */
  readonly step: number;
  readonly total: number;
  /** The current step's own name, e.g. "Verify your email". */
  readonly label?: string;
}) {
  const clamped = Math.min(Math.max(step, 1), total);
  return (
    <div className="mb-6 flex items-center gap-3">
      <p className="font-medium text-muted-foreground text-xs">
        Step {clamped} of {total}
        {label === undefined ? null : <span className="sr-only">: {label}</span>}
      </p>
      <div aria-hidden className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span
            // The index IS the identity here: these are fixed positions in a
            // fixed-length track, not a reorderable list.
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index < clamped ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

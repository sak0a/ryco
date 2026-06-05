import { Cause, Effect } from "effect";

export const ignoreProviderBackgroundCause =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logError(message, { cause: Cause.pretty(cause) }),
      ),
      Effect.asVoid,
    );

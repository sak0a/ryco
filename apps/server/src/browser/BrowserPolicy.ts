import { normalizeBrowserNavigationUrl } from "@ryco/shared/browser";
import { Context, Effect, Layer } from "effect";

import { BrowserServiceError, type BrowserToolAccessDecision } from "@ryco/contracts";

export interface BrowserPolicyShape {
  readonly decideNavigation: (input: { readonly rawUrl: string }) => Effect.Effect<
    {
      readonly url: string;
      readonly origin: string | null;
      readonly decision: BrowserToolAccessDecision;
    },
    BrowserServiceError
  >;
}

export class BrowserPolicy extends Context.Service<BrowserPolicy, BrowserPolicyShape>()(
  "ryco/browser/BrowserPolicy",
) {}

export const BrowserPolicyLive = Layer.succeed(BrowserPolicy, {
  decideNavigation: ({ rawUrl }) =>
    Effect.sync(() => normalizeBrowserNavigationUrl(rawUrl)).pipe(
      Effect.flatMap((parsed) => {
        if (!parsed.ok) {
          return Effect.fail(
            new BrowserServiceError({
              code: parsed.reason === "blocked-scheme" ? "navigation_blocked" : "invalid_url",
              message: parsed.message,
              retryable: false,
            }),
          );
        }

        const { value } = parsed;
        const decision =
          value.kind === "loopback" || value.kind === "about" || value.kind === "file"
            ? "allow"
            : "ask";
        return Effect.succeed({
          url: value.url,
          origin: value.origin,
          decision: {
            decision,
            ...(decision === "ask"
              ? { reason: "Origin requires explicit approval for provider-driven browser use." }
              : {}),
          },
        });
      }),
    ),
} satisfies BrowserPolicyShape);

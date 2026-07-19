import { ShieldAlertIcon } from "lucide-react";

export const HOSTED_RELAY_TRUST_DISCLOSURE =
  "Hosted connections use WSS transport security, but they are not application-level end-to-end encrypted. The trusted relay can observe forwarded bytes in memory and must not log or persist payloads.";

export function HostedRelayTrustNotice({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex gap-2 text-xs leading-relaxed text-muted-foreground"
          : "flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
      }
      data-hosted-relay-trust-notice="true"
    >
      <ShieldAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p>{HOSTED_RELAY_TRUST_DISCLOSURE}</p>
    </div>
  );
}

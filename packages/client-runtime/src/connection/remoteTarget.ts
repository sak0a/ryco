export interface ResolvedRemotePairingTarget {
  readonly credential: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export interface RemotePairingTargetParsers {
  readonly readPairingToken: (url: URL) => string | null;
  readonly readHostedPairingRequest: (
    url: URL,
  ) => { readonly host: string; readonly token: string } | null;
}

function normalizeRemoteBaseUrl(rawValue: string, baseOrigin: string): URL {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error("Enter a backend URL.");
  const normalizedInput =
    /^[a-zA-Z][a-zA-Z\d+-]*:\/\//.test(trimmed) || trimmed.startsWith("//")
      ? trimmed
      : `https://${trimmed}`;
  const url = new URL(normalizedInput, baseOrigin);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function toHttpBaseUrl(url: URL): string {
  const next = new URL(url.toString());
  if (next.protocol === "ws:") next.protocol = "http:";
  else if (next.protocol === "wss:") next.protocol = "https:";
  next.pathname = "/";
  next.search = "";
  next.hash = "";
  return next.toString();
}

function toWsBaseUrl(url: URL): string {
  const next = new URL(url.toString());
  if (next.protocol === "http:") next.protocol = "ws:";
  else if (next.protocol === "https:") next.protocol = "wss:";
  next.pathname = "/";
  next.search = "";
  next.hash = "";
  return next.toString();
}

export function resolveRemotePairingTarget(
  input: { readonly pairingUrl?: string; readonly host?: string; readonly pairingCode?: string },
  baseOrigin: string,
  parsers: RemotePairingTargetParsers,
): ResolvedRemotePairingTarget {
  const pairingUrl = input.pairingUrl?.trim() ?? "";
  if (pairingUrl.length > 0) {
    const url = new URL(pairingUrl, baseOrigin);
    const hostedPairingRequest = parsers.readHostedPairingRequest(url);
    if (hostedPairingRequest) {
      const hostedBackendUrl = normalizeRemoteBaseUrl(hostedPairingRequest.host, baseOrigin);
      return {
        credential: hostedPairingRequest.token,
        httpBaseUrl: toHttpBaseUrl(hostedBackendUrl),
        wsBaseUrl: toWsBaseUrl(hostedBackendUrl),
      };
    }
    const credential = parsers.readPairingToken(url) ?? "";
    if (!credential) throw new Error("Pairing URL is missing its token.");
    return { credential, httpBaseUrl: toHttpBaseUrl(url), wsBaseUrl: toWsBaseUrl(url) };
  }
  const host = input.host?.trim() ?? "";
  const pairingCode = input.pairingCode?.trim() ?? "";
  if (!host) throw new Error("Enter a backend URL.");
  if (!pairingCode) throw new Error("Enter a pairing code.");
  const normalizedHost = normalizeRemoteBaseUrl(host, baseOrigin);
  return {
    credential: pairingCode,
    httpBaseUrl: toHttpBaseUrl(normalizedHost),
    wsBaseUrl: toWsBaseUrl(normalizedHost),
  };
}

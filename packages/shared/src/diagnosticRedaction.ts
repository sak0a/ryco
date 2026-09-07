export const DIAGNOSTIC_SECRET_KEY_PATTERN =
  /token|secret|password|passwd|credential|authorization|bearer|api[-_]?key|cookie|session|private[-_]?key|pairing[-_]?code|access[-_]?key|signature|email|proof|ticket/iu;

/** Free-text diagnostics can contain credentials even under harmless field names. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu,
      "[redacted]",
    )
    .replace(/\bBearer\s+[^\s,;"']+/giu, "Bearer [redacted]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]+)\b/gu,
      "[redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted]")
    .replace(
      /\b((?:access[-_]?token|refresh[-_]?token|token|secret|password|passwd|credential|authorization|api[-_]?key|cookie|pairing[-_]?code|proof|ticket)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s<>"']+/giu, (match) => {
      try {
        const url = new URL(match);
        url.username = "";
        url.password = "";
        url.hash = "";
        for (const key of url.searchParams.keys()) {
          if (
            /token|secret|password|credential|authorization|key|cookie|proof|ticket|signature|code/iu.test(
              key,
            )
          ) {
            url.searchParams.set(key, "[redacted]");
          }
        }
        return url.toString();
      } catch {
        return "[redacted URL]";
      }
    });
}

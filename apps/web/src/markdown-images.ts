const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;

function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function stripQueryAndFragment(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const boundary = [query, fragment]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);
  return value.slice(0, boundary);
}

function normalizeAbsolutePath(value: string): string | null {
  const slashPath = value.replaceAll("\\", "/");
  const drive = slashPath.match(/^([A-Za-z]:)\//)?.[1];
  const absolute = slashPath.startsWith("/") || drive !== undefined;
  if (!absolute || slashPath.startsWith("//")) return null;

  const segments: string[] = [];
  for (const segment of slashPath.slice(drive ? drive.length + 1 : 1).split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${drive ? `${drive}/` : "/"}${segments.join("/")}`;
}

function fileUrlPath(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) return null;
    const decoded = decodePath(url.pathname);
    if (!decoded) return null;
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

export function resolveMarkdownWorkspaceImagePath(
  source: string | undefined,
  cwd: string | undefined,
): string | null {
  if (!source || !cwd) return null;
  const trimmed = source.trim();
  if (!trimmed || trimmed.includes("\0")) return null;

  const scheme = WINDOWS_ABSOLUTE_PATTERN.test(trimmed)
    ? undefined
    : trimmed.match(SCHEME_PATTERN)?.[1]?.toLowerCase();
  if (scheme && scheme !== "file") return null;

  const decodedSource =
    scheme === "file" ? fileUrlPath(trimmed) : decodePath(stripQueryAndFragment(trimmed));
  if (!decodedSource) return null;

  const normalizedRoot = normalizeAbsolutePath(cwd);
  if (!normalizedRoot) return null;
  const sourceIsAbsolute =
    decodedSource.startsWith("/") || WINDOWS_ABSOLUTE_PATTERN.test(decodedSource);
  const candidate = normalizeAbsolutePath(
    sourceIsAbsolute ? decodedSource : `${normalizedRoot}/${decodedSource}`,
  );
  if (!candidate) return null;

  const windows = WINDOWS_ABSOLUTE_PATTERN.test(normalizedRoot);
  const comparableRoot = windows ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparableCandidate = windows ? candidate.toLowerCase() : candidate;
  if (
    comparableCandidate === comparableRoot ||
    !comparableCandidate.startsWith(`${comparableRoot}/`)
  ) {
    return null;
  }

  const relativePath = candidate.slice(normalizedRoot.length + 1);
  return relativePath.length > 0 ? relativePath : null;
}

export function isSafeRemoteMarkdownImageSource(source: string | undefined): boolean {
  if (!source) return false;
  const trimmed = source.trim();
  return (
    /^https:\/\//i.test(trimmed) ||
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)
  );
}

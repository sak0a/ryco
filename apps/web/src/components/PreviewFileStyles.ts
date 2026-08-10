export const PREVIEW_FILE_UNSAFE_CSS = `
[data-file] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  background-color: var(--diffs-bg) !important;
}

[data-code],
[data-content],
[data-line],
[data-column-number] {
  font-size: 11px;
  line-height: 1.25rem;
}

[data-line-number-content] {
  color: color-mix(in srgb, var(--muted-foreground) 85%, transparent);
}
`;

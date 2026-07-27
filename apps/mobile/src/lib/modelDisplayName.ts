/**
 * Strips the provider's own name off the front of a model name.
 *
 * Every surface that shows a model already says which provider it belongs to —
 * the picker groups by provider with its brand mark on the header, and the rail
 * pill carries the same mark right next to the name. "Claude Claude Opus 4.8"
 * is what the user effectively reads today, and the prefix costs width on a
 * pill that has little to spare.
 *
 * Only a leading whole word is removed, and only when something is left over:
 * a model literally named "Claude" keeps its name rather than becoming blank.
 */
export function shortModelName(modelName: string, providerLabel: string): string {
  const name = modelName.trim();
  const provider = providerLabel.trim();
  if (!provider || !name) return name;

  const lowerName = name.toLocaleLowerCase();
  const lowerProvider = provider.toLocaleLowerCase();
  if (!lowerName.startsWith(lowerProvider)) return name;

  const rest = name.slice(provider.length);
  // Require a real word boundary, so "Codexual" is not truncated to "ual".
  if (!/^[\s\-_:]/.test(rest)) return name;

  const trimmed = rest.replace(/^[\s\-_:]+/, "").trim();
  return trimmed.length > 0 ? trimmed : name;
}

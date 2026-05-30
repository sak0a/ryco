export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  return typeof value === "string" ? value : undefined;
}

export function parseOptInSourcemapEnv(value: string | undefined): boolean;
export function parseOptInSourcemapEnv(
  value: string | undefined,
  options: { allowHidden: true },
): boolean | "hidden";
export function parseOptInSourcemapEnv(
  value: string | undefined,
  options: { allowHidden?: boolean } = {},
): boolean | "hidden" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (options.allowHidden === true && normalized === "hidden") {
    return "hidden";
  }
  return false;
}

export function setEnv(env: NodeJS.ProcessEnv, name: string, value: string | undefined): void {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

export function deleteEnv(env: NodeJS.ProcessEnv, name: string): void {
  delete env[name];
}

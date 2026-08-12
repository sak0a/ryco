import type { KVService } from "@ryco/client-runtime/platform";

export const ONBOARDING_PROGRESS_STORAGE_KEY = "ryco.mobile.onboarding.progress.v1";

export type OnboardingProgressStatus = "in-progress" | "completed";

export interface OnboardingProgress {
  readonly version: 1;
  readonly status: OnboardingProgressStatus;
}

let cachedProgress: OnboardingProgress | null | undefined;
let hydration: Promise<OnboardingProgress | null> | undefined;
let revision = 0;

export function serializeOnboardingProgress(progress: OnboardingProgress): string {
  return JSON.stringify({ version: 1, status: progress.status });
}

export function deserializeOnboardingProgress(raw: string): OnboardingProgress | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 2 ||
    candidate.version !== 1 ||
    (candidate.status !== "in-progress" && candidate.status !== "completed")
  ) {
    return null;
  }
  return { version: 1, status: candidate.status };
}

export function readCachedOnboardingProgress(): OnboardingProgress | null | undefined {
  return cachedProgress;
}

export function hydrateOnboardingProgress(
  kv: Pick<KVService, "getItem">,
): Promise<OnboardingProgress | null> {
  hydration ??= (async () => {
    const startedAtRevision = revision;
    let hydrated: OnboardingProgress | null;
    try {
      const raw = await kv.getItem(ONBOARDING_PROGRESS_STORAGE_KEY);
      hydrated = raw === null ? null : deserializeOnboardingProgress(raw);
    } catch {
      hydrated = null;
    }
    if (revision === startedAtRevision) cachedProgress = hydrated;
    return cachedProgress ?? null;
  })();
  return hydration;
}

export async function saveOnboardingProgress(
  kv: Pick<KVService, "setItem">,
  progress: OnboardingProgress,
): Promise<void> {
  const serialized = serializeOnboardingProgress(progress);
  await kv.setItem(ONBOARDING_PROGRESS_STORAGE_KEY, serialized);
  revision += 1;
  cachedProgress = deserializeOnboardingProgress(serialized);
  hydration = Promise.resolve(cachedProgress);
}

export function resetOnboardingProgressForTests(): void {
  cachedProgress = undefined;
  hydration = undefined;
  revision = 0;
}

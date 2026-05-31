import type { EnvironmentId, SourceControlProviderKind } from "@ryco/contracts";
import { Schema } from "effect";
import { useEffect } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { PrCheckStatusView } from "./prCheckStatus";

const STORAGE_KEY = "ryco:pr-check-pass-notifications:v1";
const MAX_RECORDS = 250;

const NotificationRecord = Schema.Struct({
  key: Schema.String,
  status: Schema.String,
  updatedAt: Schema.String,
  notifiedAt: Schema.optional(Schema.String),
});
const NotificationRecords = Schema.Array(NotificationRecord);

type NotificationRecord = typeof NotificationRecord.Type;

export interface PrCheckNotificationTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly provider: SourceControlProviderKind;
  readonly number: number;
  readonly title: string;
  readonly url?: string | undefined;
  readonly status: PrCheckStatusView;
}

function storageKeyForTarget(target: PrCheckNotificationTarget): string | null {
  const headSha = target.status.headSha;
  if (!target.environmentId || !target.cwd || !headSha) return null;
  return [target.environmentId, target.cwd, target.provider, target.number, headSha].join("|");
}

function readRecords(): NotificationRecord[] {
  try {
    return [...(getLocalStorageItem(STORAGE_KEY, NotificationRecords) ?? [])];
  } catch {
    return [];
  }
}

function writeRecords(records: ReadonlyArray<NotificationRecord>) {
  try {
    setLocalStorageItem(
      STORAGE_KEY,
      records
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_RECORDS),
      NotificationRecords,
    );
  } catch {
    // Local storage is best-effort; losing it only means a future duplicate is possible.
  }
}

function shouldPersistStatus(status: PrCheckStatusView): boolean {
  return ["cancelled", "failed", "passed", "pending", "running"].includes(status.kind);
}

function notifyChecksPassed(target: PrCheckNotificationTarget) {
  const shortSha = target.status.headSha?.slice(0, 12);
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title: `Checks passed for PR #${target.number}`,
      description: shortSha ? `${target.title} · ${shortSha}` : target.title,
      timeout: 6_000,
      ...(target.url
        ? {
            actionProps: {
              children: "Open PR",
              onClick: () => window.open(target.url, "_blank", "noopener,noreferrer"),
            },
            actionVariant: "outline" as const,
          }
        : {}),
    }),
  );
}

export function usePrCheckPassNotifications(
  targets: ReadonlyArray<PrCheckNotificationTarget>,
): void {
  useEffect(() => {
    if (targets.length === 0) return;

    const records = readRecords();
    const byKey = new Map(records.map((record) => [record.key, record]));
    let changed = false;

    for (const target of targets) {
      if (!shouldPersistStatus(target.status)) continue;
      const key = storageKeyForTarget(target);
      if (!key) continue;

      const now = new Date().toISOString();
      const existing = byKey.get(key);
      if (target.status.kind === "passed") {
        if (existing?.status === "passed") {
          continue;
        }
        const shouldNotify =
          existing !== undefined &&
          existing.status !== "passed" &&
          existing.notifiedAt === undefined;
        const next: NotificationRecord = {
          key,
          status: "passed",
          updatedAt: now,
          ...(existing?.notifiedAt ? { notifiedAt: existing.notifiedAt } : {}),
          ...(shouldNotify ? { notifiedAt: now } : {}),
        };
        byKey.set(key, next);
        changed = true;
        if (shouldNotify) {
          notifyChecksPassed(target);
        }
        continue;
      }

      if (existing?.status === target.status.kind) {
        continue;
      }
      byKey.set(key, {
        key,
        status: target.status.kind,
        updatedAt: now,
        ...(existing?.notifiedAt ? { notifiedAt: existing.notifiedAt } : {}),
      });
      changed = true;
    }

    if (changed) {
      writeRecords(Array.from(byKey.values()));
    }
  }, [targets]);
}

import {
  DesktopNativeSecurityError,
  type DesktopNativeSecretStore,
} from "./nativeSecurityHelper.ts";
import {
  createDesktopProtectedRecordStore,
  DesktopProtectedRecordError,
  type DesktopSecretProtection,
} from "./protectedRecordStore.ts";

export type { DesktopSecretProtection } from "./protectedRecordStore.ts";

function failed(): never {
  throw new DesktopNativeSecurityError("operation_failed");
}

export function createDesktopNativeSecretStore(input: {
  readonly directory: string;
  readonly namespace: string;
  readonly protection: DesktopSecretProtection;
}): DesktopNativeSecretStore {
  let records;
  try {
    records = createDesktopProtectedRecordStore(input);
  } catch {
    return failed();
  }

  const collapse = async <A>(operation: Promise<A>): Promise<A> => {
    try {
      return await operation;
    } catch (cause) {
      if (cause instanceof DesktopProtectedRecordError) return failed();
      throw cause;
    }
  };

  return {
    read: (kind) => collapse(records.read(kind)),
    create: (kind, keyRecord) => collapse(records.create(kind, keyRecord)),
    delete: (kind) => collapse(records.delete(kind)),
  };
}

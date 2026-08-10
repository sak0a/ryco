import type {
  ProjectFileEncoding,
  ProjectFileLineEnding,
  ProjectReadFileResult,
  ProjectWriteFileFailureReason,
} from "@ryco/contracts";

export type PreviewFileDocument = Pick<
  ProjectReadFileResult,
  "relativePath" | "contents" | "version" | "encoding" | "lineEnding"
> & {
  readonly key: string;
};

export type PreviewFileSaveStatus = "idle" | "saving" | "error" | "conflict";

export interface PreviewFileEditSession {
  readonly key: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly savedContents: string;
  readonly version: string;
  readonly encoding: ProjectFileEncoding;
  readonly lineEnding: ProjectFileLineEnding;
  readonly saveStatus: PreviewFileSaveStatus;
  readonly errorReason: ProjectWriteFileFailureReason | null;
  readonly errorMessage: string | null;
}

export function createPreviewFileDocument(
  scope: { readonly environmentId: string; readonly cwd: string },
  file: ProjectReadFileResult,
): PreviewFileDocument {
  return {
    key: `${scope.environmentId}\u0000${scope.cwd}\u0000${file.relativePath}`,
    relativePath: file.relativePath,
    contents: file.contents,
    version: file.version,
    encoding: file.encoding,
    lineEnding: file.lineEnding,
  };
}

export function createPreviewFileEditSession(
  document: PreviewFileDocument,
): PreviewFileEditSession {
  return {
    ...document,
    savedContents: document.contents,
    saveStatus: "idle",
    errorReason: null,
    errorMessage: null,
  };
}

export function isPreviewFileSessionDirty(session: PreviewFileEditSession | null): boolean {
  return session !== null && session.contents !== session.savedContents;
}

export function updatePreviewFileSessionContents(
  session: PreviewFileEditSession,
  contents: string,
): PreviewFileEditSession {
  if (contents === session.contents) return session;
  return {
    ...session,
    contents,
    saveStatus: session.saveStatus === "error" ? "idle" : session.saveStatus,
    errorReason: session.saveStatus === "error" ? null : session.errorReason,
    errorMessage: session.saveStatus === "error" ? null : session.errorMessage,
  };
}

export function beginPreviewFileSave(session: PreviewFileEditSession): PreviewFileEditSession {
  return {
    ...session,
    saveStatus: "saving",
    errorReason: null,
    errorMessage: null,
  };
}

export function finishPreviewFileSave(
  session: PreviewFileEditSession,
  savedContents: string,
  version: string,
): PreviewFileEditSession {
  return {
    ...session,
    savedContents,
    version,
    saveStatus: "idle",
    errorReason: null,
    errorMessage: null,
  };
}

export function failPreviewFileSave(
  session: PreviewFileEditSession,
  failure: {
    readonly reason: ProjectWriteFileFailureReason;
    readonly message: string;
  },
): PreviewFileEditSession {
  return {
    ...session,
    saveStatus:
      failure.reason === "conflict" || failure.reason === "deleted" ? "conflict" : "error",
    errorReason: failure.reason,
    errorMessage: failure.message,
  };
}

export function discardPreviewFileChanges(session: PreviewFileEditSession): PreviewFileEditSession {
  return {
    ...session,
    contents: session.savedContents,
    saveStatus: "idle",
    errorReason: null,
    errorMessage: null,
  };
}

export function reconcilePreviewFileSession(
  session: PreviewFileEditSession | null,
  document: PreviewFileDocument,
): PreviewFileEditSession {
  if (session === null || session.key !== document.key) {
    return createPreviewFileEditSession(document);
  }
  if (session.saveStatus === "saving" || session.version === document.version) {
    return session;
  }
  if (isPreviewFileSessionDirty(session)) {
    return failPreviewFileSave(session, {
      reason: "conflict",
      message: "This file changed on disk after it was opened. Reload it before saving.",
    });
  }
  return createPreviewFileEditSession(document);
}

export function readPreviewFileSaveFailure(error: unknown): {
  readonly reason: ProjectWriteFileFailureReason;
  readonly message: string;
} {
  const candidate = error as { readonly reason?: unknown; readonly message?: unknown } | null;
  const reason = candidate?.reason;
  return {
    reason:
      reason === "conflict" ||
      reason === "deleted" ||
      reason === "unsupported" ||
      reason === "failed"
        ? reason
        : "failed",
    message:
      typeof candidate?.message === "string" && candidate.message.trim().length > 0
        ? candidate.message
        : "Failed to save this file.",
  };
}

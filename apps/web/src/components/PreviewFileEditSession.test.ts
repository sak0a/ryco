import { describe, expect, it } from "vite-plus/test";

import {
  beginPreviewFileSave,
  createPreviewFileEditSession,
  discardPreviewFileChanges,
  failPreviewFileSave,
  finishPreviewFileSave,
  isPreviewFileSessionDirty,
  reconcilePreviewFileSession,
  updatePreviewFileSessionContents,
  type PreviewFileDocument,
} from "./PreviewFileEditSession";

function document(overrides: Partial<PreviewFileDocument> = {}): PreviewFileDocument {
  return {
    key: "environment-local\u0000/repo\u0000src/app.ts",
    relativePath: "src/app.ts",
    contents: "const answer = 41;\n",
    version: "sha256:old",
    encoding: "utf8",
    lineEnding: "lf",
    ...overrides,
  };
}

describe("PreviewFileEditSession", () => {
  it("tracks edits and discards back to the saved contents", () => {
    const initial = createPreviewFileEditSession(document());
    const edited = updatePreviewFileSessionContents(initial, "const answer = 42;\n");

    expect(isPreviewFileSessionDirty(edited)).toBe(true);
    expect(discardPreviewFileChanges(edited)).toMatchObject({
      contents: "const answer = 41;\n",
      saveStatus: "idle",
    });
  });

  it("keeps edits made during a save dirty after the captured contents succeed", () => {
    const edited = updatePreviewFileSessionContents(
      createPreviewFileEditSession(document()),
      "const answer = 42;\n",
    );
    const saving = beginPreviewFileSave(edited);
    const editedAgain = updatePreviewFileSessionContents(saving, "const answer = 43;\n");
    const saved = finishPreviewFileSave(editedAgain, "const answer = 42;\n", "sha256:new");

    expect(saved.savedContents).toBe("const answer = 42;\n");
    expect(saved.contents).toBe("const answer = 43;\n");
    expect(isPreviewFileSessionDirty(saved)).toBe(true);
  });

  it("marks a dirty session conflicted when a different disk version arrives", () => {
    const edited = updatePreviewFileSessionContents(
      createPreviewFileEditSession(document()),
      "const answer = 42;\n",
    );
    const reconciled = reconcilePreviewFileSession(
      edited,
      document({ contents: "const answer = 99;\n", version: "sha256:external" }),
    );

    expect(reconciled).toMatchObject({
      contents: "const answer = 42;\n",
      saveStatus: "conflict",
      errorReason: "conflict",
    });
  });

  it("adopts a different disk version when the session is clean", () => {
    const initial = createPreviewFileEditSession(document());
    const reconciled = reconcilePreviewFileSession(
      initial,
      document({ contents: "const answer = 99;\n", version: "sha256:external" }),
    );

    expect(reconciled).toMatchObject({
      contents: "const answer = 99;\n",
      savedContents: "const answer = 99;\n",
      version: "sha256:external",
      saveStatus: "idle",
    });
  });

  it("does not overwrite a saving session during a background refresh", () => {
    const saving = beginPreviewFileSave(
      updatePreviewFileSessionContents(
        createPreviewFileEditSession(document()),
        "const answer = 42;\n",
      ),
    );

    expect(
      reconcilePreviewFileSession(
        saving,
        document({ contents: "const answer = 99;\n", version: "sha256:external" }),
      ),
    ).toBe(saving);
  });

  it("keeps typed contents and exposes a typed conflict after a failed save", () => {
    const edited = updatePreviewFileSessionContents(
      createPreviewFileEditSession(document()),
      "const answer = 42;\n",
    );
    const failed = failPreviewFileSave(edited, {
      reason: "conflict",
      message: "Reload before saving.",
    });

    expect(failed).toMatchObject({
      contents: "const answer = 42;\n",
      saveStatus: "conflict",
      errorMessage: "Reload before saving.",
    });
  });
});

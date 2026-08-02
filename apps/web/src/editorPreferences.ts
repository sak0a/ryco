import { EDITORS, EditorId, LocalApi } from "@ryco/contracts";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { useMemo } from "react";
import { getClientSettings } from "./hooks/useSettings";
import { useSettings } from "./hooks/useSettings";

const LAST_EDITOR_KEY = "ryco:last-editor";

export function isEditorPreferenceEligible(editorId: EditorId): boolean {
  const editor = EDITORS.find((candidate) => candidate.id === editorId);
  return Boolean(editor && (!("workspaceOnly" in editor) || !editor.workspaceOnly));
}

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);
  const pinnedEditor = useSettings((s) => s.preferredEditor);

  const effectiveEditor = useMemo(() => {
    if (
      pinnedEditor &&
      availableEditors.includes(pinnedEditor) &&
      isEditorPreferenceEligible(pinnedEditor)
    ) {
      return pinnedEditor;
    }
    if (
      lastEditor &&
      availableEditors.includes(lastEditor) &&
      isEditorPreferenceEligible(lastEditor)
    ) {
      return lastEditor;
    }
    return (
      EDITORS.find(
        (editor) => availableEditors.includes(editor.id) && isEditorPreferenceEligible(editor.id),
      )?.id ?? null
    );
  }, [pinnedEditor, lastEditor, availableEditors]);

  return [effectiveEditor, setLastEditor] as const;
}

export function resolveAndPersistPreferredEditor(
  availableEditors: readonly EditorId[],
): EditorId | null {
  const availableEditorIds = new Set(availableEditors);
  const pinned = getClientSettings().preferredEditor;
  if (pinned && availableEditorIds.has(pinned) && isEditorPreferenceEligible(pinned)) return pinned;
  const stored = getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
  if (stored && availableEditorIds.has(stored) && isEditorPreferenceEligible(stored)) return stored;
  const editor =
    EDITORS.find(
      (candidate) =>
        availableEditorIds.has(candidate.id) && isEditorPreferenceEligible(candidate.id),
    )?.id ?? null;
  if (editor) setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
  return editor ?? null;
}

export async function openInPreferredEditor(api: LocalApi, targetPath: string): Promise<EditorId> {
  const { availableEditors } = await api.server.getConfig();
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) throw new Error("No available editors found.");
  await api.shell.openInEditor(targetPath, editor);
  return editor;
}

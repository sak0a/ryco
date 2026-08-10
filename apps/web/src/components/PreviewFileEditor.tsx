import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import { EditProvider, File, type FileOptions, Virtualizer } from "@pierre/diffs/react";
import { useCallback, useMemo } from "react";

interface PreviewFileEditorProps {
  readonly cacheKey: string;
  readonly className: string;
  readonly contents: string;
  readonly filePath: string;
  readonly language: string;
  readonly onChange: (contents: string) => void;
  readonly options: FileOptions<undefined>;
}

export function PreviewFileEditor(props: PreviewFileEditorProps) {
  const { cacheKey, className, contents, filePath, language, onChange, options } = props;
  const createEditor = useCallback(
    (options: EditorOptions<undefined>) => new Editor<undefined>(options),
    [],
  );
  const editorOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onChange: (file) => onChange(file.contents),
    }),
    [onChange],
  );
  const file = useMemo(
    () => ({
      name: filePath,
      contents,
      lang: language,
      cacheKey,
    }),
    [cacheKey, contents, filePath, language],
  );

  return (
    <EditProvider createEditor={createEditor}>
      <Virtualizer
        className="min-h-0 flex-1 overflow-auto"
        contentClassName="min-h-full"
        config={{ overscrollSize: 400, intersectionObserverMargin: 800 }}
      >
        <File<undefined>
          edit
          file={file}
          className={className}
          editorOptions={editorOptions}
          options={options}
        />
      </Virtualizer>
    </EditProvider>
  );
}

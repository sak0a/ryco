import { HeaderHeightContext } from "@react-navigation/elements";
import {
  NavigationContext,
  NavigationRouteContext,
  useFocusEffect,
} from "@react-navigation/native";
import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

import {
  deriveFileInspectorPaneLayout,
  deriveLayout,
  type FileInspectorPaneLayout,
} from "../../lib/layout";

interface FileWorkspaceContextValue {
  readonly inspector: FileInspectorPaneLayout;
  readonly registerInspector: (render: () => ReactNode) => () => void;
}

const compactLayout = deriveLayout({ width: 0, height: 0 });
const compactInspector = deriveFileInspectorPaneLayout({
  layout: compactLayout,
  viewportWidth: 0,
});

const FileWorkspaceContext = createContext<FileWorkspaceContextValue>({
  inspector: compactInspector,
  registerInspector: () => () => undefined,
});

export function useFileWorkspaceLayout(): FileWorkspaceContextValue {
  return use(FileWorkspaceContext);
}

/**
 * Hand a focused file route's browser to the root workspace column.
 *
 * The pane is a sibling of the native navigator so the file preview keeps its
 * own correctly sized native header. Navigation and header contexts are
 * captured here and restored around the pane because React contexts belong to
 * where a render function is invoked, not where it was created.
 */
export function useRegisterFileWorkspaceInspector(render: (() => ReactNode) | undefined) {
  const { registerInspector } = useFileWorkspaceLayout();
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const headerHeight = use(HeaderHeightContext);

  const wrappedRender = useMemo(() => {
    if (render === undefined) return undefined;
    return () => (
      <NavigationContext.Provider value={navigation}>
        <NavigationRouteContext.Provider value={route}>
          <HeaderHeightContext.Provider value={headerHeight}>
            {render()}
          </HeaderHeightContext.Provider>
        </NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    );
  }, [headerHeight, navigation, render, route]);

  // Focus owns the registration. Native screens can freeze after blur, but
  // navigation still delivers focus cleanup, so a sheet or another route can
  // never inherit a stale workspace browser.
  useFocusEffect(
    useCallback(() => {
      if (wrappedRender === undefined) return undefined;
      return registerInspector(wrappedRender);
    }, [registerInspector, wrappedRender]),
  );
}

/**
 * Responsive host for the regular-width file browser.
 *
 * It deliberately owns presentation only. The registered browser continues to
 * use the same WS RPC queries and shared thread/workspace state as the phone
 * route, so resizing cannot create a second file-runtime boundary.
 */
export function FileWorkspaceLayout(props: { readonly children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const layout = useMemo(() => deriveLayout({ width, height }), [height, width]);
  const inspector = useMemo(
    () => deriveFileInspectorPaneLayout({ layout, viewportWidth: width }),
    [layout, width],
  );
  const [inspectorRender, setInspectorRender] = useState<(() => ReactNode) | null>(null);
  const inspectorOwnerRef = useRef<symbol | null>(null);

  const registerInspector = useCallback((render: () => ReactNode) => {
    const owner = Symbol("file-workspace-inspector");
    inspectorOwnerRef.current = owner;
    setInspectorRender(() => render);

    return () => {
      if (inspectorOwnerRef.current !== owner) return;
      inspectorOwnerRef.current = null;
      setInspectorRender(null);
    };
  }, []);

  const contextValue = useMemo(
    () => ({ inspector, registerInspector }),
    [inspector, registerInspector],
  );
  const inspectorVisible =
    inspector.supported && inspector.width !== null && inspectorRender !== null;

  return (
    <FileWorkspaceContext.Provider value={contextValue}>
      <View testID="file-workspace-layout" className="flex-1 flex-row bg-screen">
        <View className="min-w-0 flex-1">{props.children}</View>
        {inspectorVisible ? (
          <View
            accessibilityLabel="Workspace files"
            className="shrink-0 border-l border-border bg-screen"
            style={{ width: inspector.width ?? 0 }}
          >
            {inspectorRender()}
          </View>
        ) : null}
      </View>
    </FileWorkspaceContext.Provider>
  );
}

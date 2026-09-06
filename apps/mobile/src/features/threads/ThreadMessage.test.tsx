import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The thread message renderer, invoked as a plain function with react-native
// mocked (same shape as SettingsHubRouteScreen.test.tsx — no React renderer
// exists in this suite). What it proves: file attachments render a tappable
// row that hands the preview URL to the platform share sheet, while unknown
// attachments stay inert.

const hoisted = vi.hoisted(() => ({
  share: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("react-native", () => ({
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Share: { share: hoisted.share },
  View: "View",
}));
vi.mock("expo-linking", () => ({ openURL: async () => undefined }));
vi.mock("../../components/AppText", () => ({ AppText: "AppText" }));
vi.mock("../../lib/appearancePreferences", () => ({
  resolveNativeMarkdownTypography: () => ({
    fontSize: 16,
    lineHeight: 22,
    headingFontSizes: {},
  }),
}));
vi.mock("../../lib/useFontFamily", () => ({ useFontFamily: () => "DMSans-Regular" }));
vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "#ffffff" }));
vi.mock("../settings/appearance/useScaledTextRole", () => ({
  useScaledTextRole: () => ({ fontSize: 16 }),
}));
vi.mock("../../native/SelectableMarkdownText", () => ({
  hasNativeSelectableMarkdownText: () => false,
  SelectableMarkdownText: "SelectableMarkdownText",
}));

import { ThreadMessage } from "./ThreadMessage";
import type { ChatAttachment, ChatMessage } from "@ryco/client-runtime/state/threads";

function isElement(value: unknown): value is ReactElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value &&
    !Array.isArray(value)
  );
}

function findPressables(element: ReactElement | null): ReactElement[] {
  const found: ReactElement[] = [];
  const walk = (node: unknown): void => {
    if (!isElement(node)) return;
    if (node.type === "Pressable") found.push(node);
    const children = (node.props as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    } else {
      walk(children);
    }
  };
  walk(element);
  return found;
}

function pressableLabel(pressable: ReactElement): string | undefined {
  return (pressable.props as { accessibilityLabel?: string }).accessibilityLabel;
}

function renderMessage(attachments: ChatAttachment[]): ReactElement {
  return ThreadMessage({
    message: {
      id: "m-1",
      role: "user",
      text: "here",
      attachments,
      streaming: false,
    } as unknown as ChatMessage,
  });
}

describe("ThreadMessage attachment rows", () => {
  beforeEach(() => {
    hoisted.share.mockClear();
  });

  it("renders a tappable row for a file attachment that shares its preview URL", async () => {
    const previewUrl = "http://node.local/attachments/att-1";
    const tree = renderMessage([
      {
        type: "file",
        id: "att-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        previewUrl,
      },
    ]);

    const pressables = findPressables(tree);
    const openRow = pressables.find((p) => pressableLabel(p) === "Open report.pdf");
    expect(openRow).toBeDefined();

    const onPress = (openRow!.props as { onPress: () => Promise<void> }).onPress;
    await onPress();
    expect(hoisted.share).toHaveBeenCalledWith({ url: previewUrl });
  });

  it("renders an inert row when a file attachment has no preview URL", () => {
    const tree = renderMessage([
      {
        type: "file",
        id: "att-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      },
    ]);
    expect(
      findPressables(tree).find((p) => pressableLabel(p) === "Open report.pdf"),
    ).toBeUndefined();
  });

  it("renders an unknown attachment without a tappable row", () => {
    const tree = renderMessage([
      {
        type: "future-kind",
        name: "mystery",
        mimeType: "application/x-mystery",
        sizeBytes: 12,
      },
    ]);
    expect(findPressables(tree)).toHaveLength(0);
  });

  it("renders an image attachment without a pressable row", () => {
    const tree = renderMessage([
      {
        type: "image",
        id: "att-2",
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        previewUrl: "http://node.local/attachments/att-2",
      },
    ]);
    expect(findPressables(tree)).toHaveLength(0);
  });
});

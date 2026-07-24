import {
  SelectableMarkdownText as NativeSelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@ryco/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@ryco/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText(props: MobileSelectableMarkdownTextProps) {
  return <NativeSelectableMarkdownText {...props} highlightCode={highlightCodeSnippet} />;
}

# Upstream Attribution

This native module is a vendored copy of the markdown-text module from
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) at commit `67a7b1a1`,
originally at `apps/mobile/modules/t3-markdown-text`.

The Fabric attributed-text component in this module originated from
[`bluesky-social/react-native-uitextview`](https://github.com/bluesky-social/react-native-uitextview),
version `2.2.0`, commit `addc08fea303608f070fe1eeba4bc075f181c4af`. That upstream
project is Copyright (c) 2024-25 Bluesky PBC and licensed under the MIT License,
retained verbatim at the top of the `LICENSE` file in this directory.

`pingdotgg/t3code` substantially modified and renamed that Bluesky original and
integrated its markdown renderer; those modifications are Copyright (c) 2026
T3 Tools Inc. and licensed under the MIT License, retained in the `LICENSE` file
in this directory below the Bluesky notice.

Ryco vendors this MIT-licensed module and re-namespaces every `T3MarkdownText`
identifier to `RycoMarkdownText` (the ObjC++/Swift sources, the
`RycoMarkdownText.podspec`, the `RycoMarkdownTextSpec` codegen config and its
component providers, and the `@ryco/mobile-markdown-text` package name). This is
a vendored copy, not a package dependency or a compatibility fork; both the
Bluesky PBC and T3 Tools Inc. copyright notices are retained as required.

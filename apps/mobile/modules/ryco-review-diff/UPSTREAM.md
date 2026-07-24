# Upstream Attribution

This native module is a vendored copy of the review-diff module from
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) at commit `67a7b1a1`,
originally at `apps/mobile/modules/t3-review-diff`.

The upstream project is Copyright (c) 2026 T3 Tools Inc. and licensed under the
MIT License, retained verbatim in the `LICENSE` file in this directory
(upstream shipped no module-level license file; this is the `pingdotgg/t3code`
repository-root MIT notice, which covers the module).

Ryco vendors this MIT-licensed module and re-namespaces every `T3ReviewDiff`
identifier to `RycoReviewDiff` (the Swift/Kotlin sources, the
`RycoReviewDiffNative.podspec`, `expo-module.config.json`, the
`expo.modules.rycoreviewdiff` Kotlin package, and the module names), stripping
T3-proprietary details for the Ryco MVP. This is a vendored copy, not a package
dependency or a compatibility fork.

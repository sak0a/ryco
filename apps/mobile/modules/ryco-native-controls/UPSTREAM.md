# Upstream Attribution

This native module is a vendored copy of the native-controls module from
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) at commit `67a7b1a1`,
originally at `apps/mobile/modules/t3-native-controls`.

The upstream project is Copyright (c) 2026 T3 Tools Inc. and licensed under the
MIT License, retained verbatim in the `LICENSE` file in this directory
(upstream shipped no module-level license file; this is the `pingdotgg/t3code`
repository-root MIT notice, which covers the module).

Ryco vendors this MIT-licensed module and re-namespaces every `T3NativeControls`,
`T3HeaderButton`, and `T3KeyboardCommands` identifier to their `Ryco*`
equivalents (the Swift/Kotlin sources, the `RycoNativeControls.podspec`,
`expo-module.config.json`, and the `expo.modules.ryconativecontrols` Kotlin
package). The upstream screenshot/showcase-rig native functions
(`getShowcaseScene`, `markShowcaseReady`, `prepareShowcaseCapture`,
`getShowcasePairingUrl`) are dropped for the Ryco MVP. This is a vendored copy,
not a package dependency or a compatibility fork.

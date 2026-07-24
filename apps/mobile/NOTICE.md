# Third-party notices — @ryco/mobile

The `apps/mobile` scaffold — the Expo/React Native app shell and its build
configuration (`app.config.ts`, `metro.config.js`, `babel.config.js`,
`index.ts`, `global.css`, `eas.json`, the `plugins/*` config plugins, and the
platform/runtime wiring modeled on them) — was copied and stripped from
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) at commit `67a7b1a1`
(originally `apps/mobile`). It was re-namespaced from T3 to Ryco identifiers,
re-themed, and had the T3-proprietary planes (the hosted-auth vendor and managed
cloud, EAS project/owner, brand assets, telemetry endpoint, widgets, share
extension, quick actions, and the camera-showcase rig) removed for the Ryco MVP.

`pingdotgg/t3code` is Copyright (c) 2026 T3 Tools Inc. and licensed under the MIT
License; that notice is retained below as required. The four vendored native
modules under `modules/*` carry their own `LICENSE` / `UPSTREAM.md` notices
(including the react-native-uitextview / Bluesky PBC origin of the markdown
module and the Expo template origin of the composer module).

## pingdotgg/t3code MIT notice

MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

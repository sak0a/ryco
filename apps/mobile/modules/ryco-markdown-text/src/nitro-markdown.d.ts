// The vendored react-native-nitro-markdown tarball's published `ParserOptions`
// type declares only `gfm` and `math`, but the native C++ parser also accepts
// an `html` flag (the copied renderer passes `html: true`). Declare the option
// here so callers typecheck against the parser's real surface. This is a
// type-only shim for an upstream published-types gap — it does not change the
// copied module's runtime behavior.

// The empty import makes this file a module so the `declare module` below is
// treated as an augmentation (merging into the existing exports) rather than a
// replacement of the module's type surface.
import type {} from "react-native-nitro-markdown/headless";

declare module "react-native-nitro-markdown/headless" {
  interface ParserOptions {
    readonly html?: boolean;
  }
}

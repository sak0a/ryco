import type { ExpectPollOptions } from "vite-plus/test";

declare module "vite-plus/test" {
  interface ExpectStatic {
    element: (element: unknown, options?: ExpectPollOptions) => any;
  }
}

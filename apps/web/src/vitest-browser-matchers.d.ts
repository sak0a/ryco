import type { ExpectPollOptions } from "vitest";

declare module "vitest" {
  interface ExpectStatic {
    element: (element: unknown, options?: ExpectPollOptions) => any;
  }
}

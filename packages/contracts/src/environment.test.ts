import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

function descriptor(capabilities: Record<string, unknown>) {
  return {
    environmentId: "environment-1",
    label: "Local",
    platform: {
      os: "darwin",
      arch: "arm64",
    },
    serverVersion: "0.1.8",
    capabilities,
  };
}

describe("ExecutionEnvironmentCapabilities.threadSettlement", () => {
  it("decodes missing support as false for older servers", () => {
    expect(decodeDescriptor(descriptor({ repositoryIdentity: true })).capabilities).toEqual({
      repositoryIdentity: true,
      threadSettlement: false,
    });
  });

  it("preserves advertised settlement support", () => {
    expect(
      decodeDescriptor(descriptor({ repositoryIdentity: true, threadSettlement: true }))
        .capabilities.threadSettlement,
    ).toBe(true);
  });
});

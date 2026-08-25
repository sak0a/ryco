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
      threadPriorityRanking: false,
    });
  });

  it("preserves advertised settlement support", () => {
    expect(
      decodeDescriptor(descriptor({ repositoryIdentity: true, threadSettlement: true }))
        .capabilities.threadSettlement,
    ).toBe(true);
  });

  it("decodes missing ranking support as false and preserves explicit support", () => {
    expect(decodeDescriptor(descriptor({})).capabilities.threadPriorityRanking).toBe(false);
    expect(
      decodeDescriptor(descriptor({ threadPriorityRanking: true })).capabilities
        .threadPriorityRanking,
    ).toBe(true);
  });
});

import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  LocalIntroductionCompleteRequest,
  LocalIntroductionCompleteResponse,
  LocalIntroductionDescriptorResponse,
} from "./localIntroduction.ts";

describe("Local Trusted Introduction control contracts", () => {
  it("accepts the exact descriptor and complete messages", () => {
    const digest = "A".repeat(43);
    expect(
      Schema.decodeUnknownSync(LocalIntroductionDescriptorResponse)({
        protocolVersion: 1,
        hubOrigin: "https://hub.example.test",
        environmentId: `env_${"B".repeat(22)}`,
        nodeId: `node_${"C".repeat(22)}`,
        nodeIdentityPublicKey: digest,
        nodeIdentityFingerprint: digest,
        nodeContinuityId: `nct_${"D".repeat(22)}`,
        nodePolicyGeneration: 7,
      }),
    ).toBeTruthy();
    expect(
      Schema.decodeUnknownSync(LocalIntroductionCompleteRequest)({
        requestTbs: "E".repeat(256),
        requestSignature: `${"F".repeat(85)}A`,
      }),
    ).toBeTruthy();
    expect(
      Schema.decodeUnknownSync(LocalIntroductionCompleteResponse)({
        protocolVersion: 1,
        disposition: "created",
        approvalTbs: "G".repeat(256),
        approvalSignature: `${"H".repeat(85)}Q`,
      }),
    ).toBeTruthy();
  });

  it("rejects excess members and malformed binary encodings", () => {
    expect(() =>
      Schema.decodeUnknownSync(LocalIntroductionCompleteRequest)({
        requestTbs: "!",
        requestSignature: `${"A".repeat(85)}A`,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(LocalIntroductionCompleteRequest)({
        requestTbs: "A",
        requestSignature: `${"A".repeat(85)}A`,
        ignored: true,
      }),
    ).toThrow();
  });
});

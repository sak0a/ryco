import {
  AGENT_CONTROL_CAPABILITIES,
  AgentControlCapability,
  ProviderInstanceId,
  ThreadId,
  type AgentControlPrincipal,
} from "@ryco/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { AgentControlPolicy } from "../Services/AgentControlPolicy.ts";
import { AgentControlPolicyLive } from "./AgentControlPolicy.ts";

const principal: AgentControlPrincipal = {
  kind: "provider-session",
  threadId: ThreadId.make("thread-1"),
  providerInstanceId: ProviderInstanceId.make("codex"),
};

const disabledLayer = it.layer(
  AgentControlPolicyLive.pipe(Layer.provideMerge(ServerSettingsService.layerTest())),
);
const enabledLayer = it.layer(
  AgentControlPolicyLive.pipe(
    Layer.provideMerge(ServerSettingsService.layerTest({ agentControl: { enabled: true } })),
  ),
);

disabledLayer("AgentControlPolicy (default settings)", (it) => {
  it.effect("fails closed while the feature is disabled, even with every grant", () =>
    Effect.gen(function* () {
      const policy = yield* AgentControlPolicy;
      assert.isFalse(yield* policy.isEnabled);

      const requireError = yield* Effect.flip(policy.requireEnabled("test.operation"));
      assert.strictEqual(requireError._tag, "AgentControlDisabledError");

      const authorizeError = yield* Effect.flip(
        policy.authorize({
          principal,
          grantedCapabilities: Object.values(AGENT_CONTROL_CAPABILITIES),
          requiredCapability: AGENT_CONTROL_CAPABILITIES.read,
          operation: "test.operation",
        }),
      );
      assert.strictEqual(authorizeError._tag, "AgentControlDisabledError");
    }),
  );
});

enabledLayer("AgentControlPolicy (enabled)", (it) => {
  it.effect("authorizes only capabilities present in the grant set", () =>
    Effect.gen(function* () {
      const policy = yield* AgentControlPolicy;
      assert.isTrue(yield* policy.isEnabled);
      yield* policy.requireEnabled("test.operation");

      yield* policy.authorize({
        principal,
        grantedCapabilities: [AGENT_CONTROL_CAPABILITIES.createThreads],
        requiredCapability: AGENT_CONTROL_CAPABILITIES.createThreads,
        operation: "test.operation",
      });

      const denied = yield* Effect.flip(
        policy.authorize({
          principal,
          grantedCapabilities: [AGENT_CONTROL_CAPABILITIES.read],
          requiredCapability: AGENT_CONTROL_CAPABILITIES.interruptThread,
          operation: "test.operation",
        }),
      );
      assert.strictEqual(denied._tag, "AgentControlCapabilityDeniedError");

      // A capability slug this build has never granted is denied, not
      // treated as implicitly harmless.
      const unknown = yield* Effect.flip(
        policy.authorize({
          principal,
          grantedCapabilities: [AGENT_CONTROL_CAPABILITIES.read],
          requiredCapability: AgentControlCapability.make("future.capability"),
          operation: "test.operation",
        }),
      );
      assert.strictEqual(unknown._tag, "AgentControlCapabilityDeniedError");
    }),
  );

  it.effect("maps every mutation action kind to its capability", () =>
    Effect.gen(function* () {
      const policy = yield* AgentControlPolicy;
      assert.strictEqual(
        policy.requiredCapabilityForAction("createThreads"),
        AGENT_CONTROL_CAPABILITIES.createThreads,
      );
      assert.strictEqual(
        policy.requiredCapabilityForAction("sendMessage"),
        AGENT_CONTROL_CAPABILITIES.sendMessage,
      );
      assert.strictEqual(
        policy.requiredCapabilityForAction("interruptThread"),
        AGENT_CONTROL_CAPABILITIES.interruptThread,
      );
      assert.strictEqual(
        policy.requiredCapabilityForAction("updateThread"),
        AGENT_CONTROL_CAPABILITIES.updateThread,
      );
    }),
  );
});

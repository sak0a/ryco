import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import type { CopilotClient, SessionConfig } from "@github/copilot-sdk";
import { CopilotSettings, ProviderInstanceId } from "@ryco/contracts";
import { createModelSelection } from "@ryco/shared/model";
import { Effect, Layer, Schema } from "effect";
import { expect } from "vite-plus/test";

import { ServerConfig } from "../config.ts";
import { makeThreadPriorityTestInput } from "../threadPriority/threadPriorityTestFixtures.ts";
import { makeCopilotTextGeneration } from "./CopilotTextGeneration.ts";

const CopilotTextGenerationTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "ryco-copilot-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(CopilotTextGenerationTestLayer)("CopilotTextGeneration", (it) => {
  it.effect("ranks natively with the configured model and no tools or fallback", () =>
    Effect.gen(function* () {
      const sessionConfigs: SessionConfig[] = [];
      const prompts: string[] = [];
      const clientFactory = () =>
        ({
          createSession: async (config: SessionConfig) => {
            sessionConfigs.push(config);
            return {
              sendAndWait: async ({ prompt }: { prompt: string }) => {
                prompts.push(prompt);
                return {
                  data: {
                    content: JSON.stringify({
                      rankings: [
                        {
                          candidateId: "candidate-0001",
                          tier: "soon",
                          confidence: "high",
                          reason: "The requested repair is actionable",
                        },
                      ],
                    }),
                  },
                };
              },
              disconnect: async () => undefined,
            };
          },
          stop: async () => undefined,
        }) as unknown as CopilotClient;

      const settings = Schema.decodeSync(CopilotSettings)({});
      const textGeneration = yield* makeCopilotTextGeneration(settings, {}, clientFactory);
      const input = makeThreadPriorityTestInput(
        ProviderInstanceId.make("githubCopilot"),
        "gpt-5.4",
      );
      const result = yield* textGeneration.rankInboxThreads({
        ...input,
        modelSelection: createModelSelection(input.modelSelection.instanceId, "gpt-5.4", [
          { id: "reasoningEffort", value: "high" },
        ]),
      });

      expect(result.rankings).toMatchObject([
        { threadId: "thread-priority-test", tier: "soon", confidence: "high" },
      ]);
      expect(sessionConfigs).toHaveLength(1);
      expect(sessionConfigs[0]).toMatchObject({
        model: "gpt-5.4",
        reasoningEffort: "high",
        streaming: false,
        availableTools: [],
      });
      expect(prompts[0]).toContain("Untrusted candidate data (JSON)");
    }),
  );
});

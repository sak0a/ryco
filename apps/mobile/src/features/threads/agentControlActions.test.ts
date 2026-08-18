import { describe, expect, it } from "vite-plus/test";
import { AgentControlProposalId, type EnvironmentApi } from "@ryco/contracts";

import { acceptAgentControlProposal, rejectAgentControlProposal } from "./agentControlActions";

const proposalId = AgentControlProposalId.make("proposal-1");

function makeApi() {
  const calls: Array<{ method: string; proposalId: string }> = [];
  const receipt = { proposalId, status: "approved" } as never;
  const api = {
    agentControl: {
      acceptProposal: async (input: { proposalId: string }) => {
        calls.push({ method: "accept", proposalId: input.proposalId });
        return receipt;
      },
      rejectProposal: async (input: { proposalId: string }) => {
        calls.push({ method: "reject", proposalId: input.proposalId });
        return receipt;
      },
    },
  } as unknown as EnvironmentApi;
  return { api, calls };
}

describe("agentControlActions", () => {
  it("sends explicit accept and reject decisions through the EnvironmentApi seam", async () => {
    const { api, calls } = makeApi();
    await acceptAgentControlProposal({ api, proposalId });
    await rejectAgentControlProposal({ api, proposalId });
    expect(calls).toEqual([
      { method: "accept", proposalId },
      { method: "reject", proposalId },
    ]);
  });

  it("fails closed against environments without the Agent Control surface", async () => {
    const api = {} as EnvironmentApi;
    await expect(acceptAgentControlProposal({ api, proposalId })).rejects.toThrow(
      "Agent Control is not available",
    );
    await expect(rejectAgentControlProposal({ api, proposalId })).rejects.toThrow(
      "Agent Control is not available",
    );
  });
});

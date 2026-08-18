import { createInterface } from "node:readline";

import {
  AGENT_CONTROL_BOOTSTRAP_ENV,
  AGENT_CONTROL_BOOTSTRAP_URL_ENV,
} from "./ProviderInjection.ts";

interface BootstrapExchange {
  readonly endpointUrl: string;
  readonly authorization: string;
}

export interface AgentControlStdioProxyDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly errorOutput: NodeJS.WritableStream;
  readonly fetch: typeof globalThis.fetch;
}

export const exchangeAgentControlBootstrap = async (
  fetchImpl: typeof globalThis.fetch,
  url: string,
  token: string,
): Promise<BootstrapExchange> => {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("Agent Control bootstrap exchange refused");
  const value = (await response.json()) as Partial<BootstrapExchange>;
  if (
    typeof value.endpointUrl !== "string" ||
    typeof value.authorization !== "string" ||
    !value.authorization.startsWith("Bearer rycoac_")
  ) {
    throw new Error("Agent Control bootstrap exchange returned an invalid response");
  }
  return { endpointUrl: value.endpointUrl, authorization: value.authorization };
};

export const runAgentControlStdioProxy = async (
  deps: AgentControlStdioProxyDeps,
): Promise<void> => {
  const token = deps.env[AGENT_CONTROL_BOOTSTRAP_ENV];
  const bootstrapUrl = deps.env[AGENT_CONTROL_BOOTSTRAP_URL_ENV];
  // Remove bootstrap material before any provider request is handled. This
  // process never spawns shell children, so neither secret can be inherited.
  delete deps.env[AGENT_CONTROL_BOOTSTRAP_ENV];
  delete deps.env[AGENT_CONTROL_BOOTSTRAP_URL_ENV];
  if (!token || !bootstrapUrl) throw new Error("Agent Control bootstrap is unavailable");

  const connection = await exchangeAgentControlBootstrap(deps.fetch, bootstrapUrl, token);
  const lines = createInterface({ input: deps.input });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const response = await deps.fetch(connection.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: connection.authorization,
      },
      body: line,
    });
    if (response.status === 202) continue;
    if (!response.ok) throw new Error("Agent Control MCP request failed");
    deps.output.write(`${await response.text()}\n`);
  }
};

export const runAgentControlStdioProxyFromProcess = (): void => {
  void runAgentControlStdioProxy({
    env: process.env,
    input: process.stdin,
    output: process.stdout,
    errorOutput: process.stderr,
    fetch: globalThis.fetch,
  }).catch(() => {
    // Never print the caught error: fetch errors can embed request material.
    process.stderr.write("Agent Control stdio proxy stopped.\n");
    process.exitCode = 1;
  });
};

import { PassThrough, Readable } from "node:stream";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  AGENT_CONTROL_BOOTSTRAP_ENV,
  AGENT_CONTROL_BOOTSTRAP_URL_ENV,
} from "./ProviderInjection.ts";
import { runAgentControlStdioProxy } from "./stdioProxy.ts";

describe("Agent Control stdio proxy", () => {
  it("exchanges once, deletes bootstrap env, and forwards MCP without spawning children", async () => {
    const bootstrap = `rycoacb_${"b".repeat(43)}`;
    const bearer = `rycoac_${"a".repeat(43)}`;
    const env: NodeJS.ProcessEnv = {
      [AGENT_CONTROL_BOOTSTRAP_ENV]: bootstrap,
      [AGENT_CONTROL_BOOTSTRAP_URL_ENV]: "http://127.0.0.1:45000/_agent-control/bootstrap",
    };
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk) => (written += chunk.toString()));
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(env[AGENT_CONTROL_BOOTSTRAP_ENV]).toBeUndefined();
      expect(env[AGENT_CONTROL_BOOTSTRAP_URL_ENV]).toBeUndefined();
      if (String(url).endsWith("/bootstrap")) {
        expect(init?.body).toBe(JSON.stringify({ token: bootstrap }));
        return Response.json({
          endpointUrl: "http://127.0.0.1:45000/mcp",
          authorization: `Bearer ${bearer}`,
        });
      }
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${bearer}` });
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    });

    await runAgentControlStdioProxy({
      env,
      input: Readable.from(['{"jsonrpc":"2.0","id":1,"method":"ping"}\n']),
      output,
      errorOutput: new PassThrough(),
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(written).toContain('"id":1');
    expect(JSON.stringify(env)).not.toContain("rycoac_");
  });
});

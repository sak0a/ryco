import { createInterface as createPromptInterface } from "node:readline/promises";

import {
  discoverExternalRuntimeWithRetries,
  readExternalCredentialFile,
  writeExternalCredentialFile,
} from "./runtimeFiles.ts";

const BRIDGE_REQUEST_TIMEOUT_MS = 60_000;
const BRIDGE_PAIR_TIMEOUT_MS = 5_000;
const BRIDGE_MAX_STDIO_BYTES = 128 * 1024;

const readBoundedLines = async function* (
  input: NodeJS.ReadableStream,
): AsyncGenerator<string, void> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of input as NodeJS.ReadableStream & AsyncIterable<string | Uint8Array>) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      if (Buffer.byteLength(line, "utf8") > BRIDGE_MAX_STDIO_BYTES) {
        throw new Error("External MCP stdio request exceeded the payload limit");
      }
      yield line;
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
    if (Buffer.byteLength(pending, "utf8") > BRIDGE_MAX_STDIO_BYTES) {
      throw new Error("External MCP stdio request exceeded the payload limit");
    }
  }
  pending += decoder.decode();
  if (pending.length > 0) {
    if (Buffer.byteLength(pending, "utf8") > BRIDGE_MAX_STDIO_BYTES) {
      throw new Error("External MCP stdio request exceeded the payload limit");
    }
    yield pending.replace(/\r$/, "");
  }
};

export interface ExternalMcpBridgeDeps {
  readonly integrationId: string;
  readonly stateDirs: ReadonlyArray<string>;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly errorOutput: NodeJS.WritableStream;
  readonly fetch: typeof globalThis.fetch;
}

export const pairExternalMcpBridge = async (
  deps: Pick<ExternalMcpBridgeDeps, "integrationId" | "stateDirs" | "fetch"> & {
    readonly pairingCode: string;
  },
): Promise<void> => {
  const runtime = await discoverExternalRuntimeWithRetries(deps.stateDirs);
  const response = await deps.fetch(runtime.pairingUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      integrationId: deps.integrationId,
      pairingCode: deps.pairingCode.trim(),
    }),
    signal: AbortSignal.timeout(BRIDGE_PAIR_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Ryco pairing was refused");
  const value = (await response.json()) as Record<string, unknown>;
  if (
    value.integrationId !== deps.integrationId ||
    value.audience !== "external-mcp" ||
    typeof value.credential !== "string" ||
    !value.credential.startsWith("rycoext_")
  ) {
    throw new Error("Ryco pairing returned invalid credential material");
  }
  await writeExternalCredentialFile(deps.stateDirs[0]!, {
    version: 1,
    integrationId: deps.integrationId,
    audience: "external-mcp",
    credential: value.credential,
    pairedAt: new Date().toISOString(),
  });
};

export const runExternalMcpBridge = async (deps: ExternalMcpBridgeDeps): Promise<void> => {
  const runtime = await discoverExternalRuntimeWithRetries(deps.stateDirs);
  const credential = await readExternalCredentialFile(deps.stateDirs[0]!, deps.integrationId);
  const inFlight = new Set<Promise<void>>();

  const forward = async (line: string) => {
    if (Buffer.byteLength(line, "utf8") > BRIDGE_MAX_STDIO_BYTES) {
      throw new Error("External MCP stdio request exceeded the payload limit");
    }
    const response = await deps.fetch(runtime.mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.credential}`,
      },
      body: line,
      signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 202) return;
    if (!response.ok) throw new Error("External MCP request was refused");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > BRIDGE_MAX_STDIO_BYTES * 4) {
      throw new Error("External MCP response exceeded the payload limit");
    }
    deps.output.write(`${body}\n`);
  };

  for await (const line of readBoundedLines(deps.input)) {
    if (line.trim().length === 0) continue;
    // Deliberately do not await here: a bounded long wait must not block ping,
    // read, or another request on the same stdio connection.
    const request = forward(line)
      .catch(() => {
        // Never print fetch errors: platform errors can contain URLs or headers.
        deps.errorOutput.write("External Ryco MCP request failed.\n");
      })
      .finally(() => inFlight.delete(request));
    inFlight.add(request);
  }
  await Promise.allSettled(inFlight);
};

export const promptAndPairExternalMcpBridge = async (input: {
  readonly integrationId: string;
  readonly stateDirs: ReadonlyArray<string>;
  readonly fetch: typeof globalThis.fetch;
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}) => {
  const prompt = createPromptInterface({ input: input.input, output: input.output });
  try {
    const code = await prompt.question("Ryco pairing code: ");
    await pairExternalMcpBridge({
      integrationId: input.integrationId,
      stateDirs: input.stateDirs,
      fetch: input.fetch,
      pairingCode: code,
    });
  } finally {
    prompt.close();
  }
};

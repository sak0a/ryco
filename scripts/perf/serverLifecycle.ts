import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";

const MAX_OUTPUT_CHARS = 128 * 1024;

export interface LaunchedServer {
  readonly child: ChildProcess;
  readonly pairingUrl: string;
  readonly serverReadyMs: number;
  readonly output: () => string;
}

export function parsePairingUrl(output: string): string | null {
  const match = /(?:^|\n)Pairing URL:\s+(https?:\/\/[^\s]+)/u.exec(output);
  if (!match?.[1]) return null;
  try {
    return new URL(match[1]).toString();
  } catch {
    return null;
  }
}

export async function reserveLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to reserve a loopback port.")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export function prepareIterationHome(input: {
  readonly destination: string;
  readonly fixtureHome: string | null;
}): void {
  if (input.fixtureHome) {
    if (!existsSync(input.fixtureHome)) {
      throw new Error("The configured fixture home does not exist.");
    }
    cpSync(input.fixtureHome, input.destination, {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
    });
    return;
  }
  mkdirSync(input.destination, { recursive: true });
}

export async function launchProductionServer(input: {
  readonly repoRoot: string;
  readonly baseDir: string;
  readonly port: number;
  readonly timeoutMs?: number;
  readonly onSpawn?: (child: ChildProcess) => void;
}): Promise<LaunchedServer> {
  const serverBin = path.join(input.repoRoot, "apps/server/dist/bin.mjs");
  if (!existsSync(serverBin)) {
    throw new Error(`Missing production server build: ${serverBin}`);
  }
  const startedAt = performance.now();
  const child = spawn(
    process.env.RYCO_PERF_NODE_BINARY || "node",
    [
      serverBin,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(input.port),
      "--base-dir",
      input.baseDir,
      "--no-browser",
    ],
    {
      cwd: input.repoRoot,
      env: {
        ...process.env,
        RYCO_HOME: input.baseDir,
        RYCO_NO_BROWSER: "true",
        RYCO_TELEMETRY_ENABLED: "false",
        RYCO_HUB_CONNECTOR_ENABLED: "false",
        RYCO_PERF_PROFILE: "0",
        VITE_RYCO_PERF_PROFILE: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  input.onSpawn?.(child);
  let output = "";
  const append = (chunk: Buffer | string) => {
    output = `${output}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  const pairingUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Ryco server readiness.\n${output}`));
    }, input.timeoutMs ?? 45_000);
    const interval = setInterval(() => {
      const parsed = parsePairingUrl(output);
      if (!parsed) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve(parsed);
    }, 50);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(
        new Error(
          `Ryco server exited before readiness (code=${String(code)}, signal=${String(signal)}).\n${output}`,
        ),
      );
    });
  }).catch(async (error: unknown) => {
    await stopProcess(child);
    throw error;
  });

  return {
    child,
    pairingUrl,
    serverReadyMs: performance.now() - startedAt,
    output: () => output,
  };
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  if (await waitForExit(child, 3_000)) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 2_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 1_000);
}

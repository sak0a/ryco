import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import type { BuildMeasurement } from "./model.ts";
import { ProcessTreeSampler } from "./processSampler.ts";

const MAX_OUTPUT_CHARS = 128 * 1024;

export interface CommandResult {
  readonly measurement: BuildMeasurement;
  readonly outputTail: string;
}

export async function runMeasuredCommand(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}): Promise<CommandResult> {
  const startedAt = performance.now();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.pid) throw new Error(`Failed to obtain a PID for ${input.command}.`);
  const sampler = new ProcessTreeSampler(child.pid, 250);
  sampler.start();
  let outputTail = "";
  const append = (chunk: Buffer | string) => {
    outputTail = `${outputTail}${chunk.toString()}`.slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let exitCode: number;
  let processSummary: Awaited<ReturnType<ProcessTreeSampler["stop"]>>;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(
            `Command timed out after ${input.timeoutMs}ms: ${input.command} ${input.args.join(" ")}\n${outputTail}`,
          ),
        );
      }, input.timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (signal) {
          reject(new Error(`Command exited via ${signal}.\n${outputTail}`));
          return;
        }
        resolve(code ?? 1);
      });
    });
  } finally {
    processSummary = await sampler.stop();
  }
  return {
    measurement: {
      durationMs: performance.now() - startedAt,
      peakRssBytes: processSummary.peakRssBytes,
      exitCode,
    },
    outputTail,
  };
}

import { assert, describe, it } from "@effect/vitest";
import { spawn } from "node:child_process";

import { parsePairingUrl, stopProcess } from "./serverLifecycle.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

describe("external server lifecycle output", () => {
  it("extracts the headless pairing URL without exposing surrounding output", () => {
    assert.equal(
      parsePairingUrl(
        "Ryco server is ready.\nConnection string: http://127.0.0.1:3773\nPairing URL: http://127.0.0.1:3773/pair#token=secret\n",
      ),
      "http://127.0.0.1:3773/pair#token=secret",
    );
  });

  it("rejects absent and invalid URLs", () => {
    assert.equal(parsePairingUrl("Ryco server is ready."), null);
    assert.equal(parsePairingUrl("\nPairing URL: not-a-url\n"), null);
  });

  it("stops every descendant in an owned process group", async () => {
    if (process.platform === "win32") return;
    const nodeBinary = process.env.RYCO_PERF_NODE_BINARY || "node";
    const child = spawn(
      nodeBinary,
      [
        "-e",
        `const { spawn } = require("node:child_process");
         const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
           stdio: "ignore"
         });
         console.log(grandchild.pid);
         setInterval(() => {}, 1000);`,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const grandchildPid = await new Promise<number>((resolve, reject) => {
      let output = "";
      child.once("error", reject);
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const parsed = Number(output.trim());
        if (Number.isSafeInteger(parsed) && parsed > 0) resolve(parsed);
      });
    });

    try {
      assert.isTrue(isAlive(grandchildPid));
    } finally {
      await stopProcess(child, { ownsProcessGroup: true });
    }
    assert.isFalse(isAlive(grandchildPid));
  });
});

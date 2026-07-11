#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const SMOKE_TIMEOUT_MS = 30_000;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    ...options,
  });
}

function resolveBin(installDir, name) {
  const binPath = path.join(installDir, "node_modules", ".bin", name);
  if (!existsSync(binPath)) {
    throw new Error(`Missing installed binary: ${binPath}`);
  }
  return binPath;
}

function readInstalledVersion(installDir) {
  const packageJsonPath = path.join(installDir, "node_modules", "ryco-cli", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error(`Installed package.json is missing a string version: ${packageJsonPath}`);
  }
  return packageJson.version;
}

function parseVersionOutput(output, binName) {
  const trimmed = output.trim();
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/u.exec(trimmed);
  if (!match) {
    throw new Error(`Unable to parse ${binName} --version output: ${trimmed}`);
  }
  return match[1];
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port.")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServeReady(binPath, installDir, baseDir, port) {
  const child = spawn(
    binPath,
    ["serve", "--host", "127.0.0.1", "--port", String(port), "--base-dir", baseDir],
    {
      cwd: installDir,
      env: {
        ...process.env,
        RYCO_NO_BROWSER: "true",
        RYCO_TELEMETRY_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";

  const append = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  await new Promise((resolve, reject) => {
    let ready = false;
    let shutdownTimeout = null;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for packaged ryco serve readiness.\n${output}`));
    }, SMOKE_TIMEOUT_MS);

    const interval = setInterval(() => {
      if (!ready && output.includes("Ryco server is ready.")) {
        ready = true;
        clearTimeout(timeout);
        clearInterval(interval);
        child.kill("SIGINT");
        shutdownTimeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000);
      }
    }, 100);

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(interval);
      if (shutdownTimeout) {
        clearTimeout(shutdownTimeout);
      }
      if (output.includes("Ryco server is ready.")) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Packaged ryco serve exited before readiness (code=${String(code)}, signal=${String(
            signal,
          )}).\n${output}`,
        ),
      );
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      clearInterval(interval);
      reject(error);
    });
  });
}

async function main() {
  const packageDir = process.cwd();
  const tempRoot = mkdtempSync(path.join(tmpdir(), "ryco-cli-package-smoke-"));
  const packDir = path.join(tempRoot, "pack");
  const installDir = path.join(tempRoot, "install");
  const dataDir = path.join(tempRoot, "data");

  try {
    mkdirSync(packDir, { recursive: true });
    mkdirSync(installDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    const packed = run("npm", ["pack", packageDir, "--pack-destination", packDir], {
      stdio: "pipe",
    })
      .trim()
      .split(/\r?\n/u)
      .at(-1);
    if (!packed) {
      throw new Error("npm pack did not report a tarball name.");
    }
    const tarball = path.join(packDir, packed);

    run("npm", ["init", "-y"], { cwd: installDir, stdio: "ignore" });
    run("npm", ["install", tarball], { cwd: installDir, stdio: "ignore" });

    const rycoBin = resolveBin(installDir, "ryco");
    const rycoCliBin = resolveBin(installDir, "ryco-cli");
    const rycoVersionOutput = run(rycoBin, ["--version"]).trim();
    const rycoCliVersionOutput = run(rycoCliBin, ["--version"]).trim();
    const rycoVersion = parseVersionOutput(rycoVersionOutput, "ryco");
    const rycoCliVersion = parseVersionOutput(rycoCliVersionOutput, "ryco-cli");
    const packageVersion = readInstalledVersion(installDir);
    if (rycoVersion !== rycoCliVersion) {
      throw new Error(
        `Binary version mismatch: ryco=${rycoVersionOutput}, ryco-cli=${rycoCliVersionOutput}`,
      );
    }
    if (rycoVersion !== packageVersion) {
      throw new Error(`Package version mismatch: package=${packageVersion}, binary=${rycoVersion}`);
    }

    const port = await reservePort();
    await waitForServeReady(rycoBin, installDir, dataDir, port);
    console.log(`[package-smoke] ${rycoVersion} packaged CLI smoke passed.`);
  } finally {
    if (process.env.RYCO_KEEP_PACKAGE_SMOKE_TEMP !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`[package-smoke] kept temp directory: ${tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

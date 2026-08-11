// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import type { UsageProviderKind } from "@ryco/contracts";

import { parseClaudeTranscriptLine } from "./claudeTranscript.ts";
import { initialCodexTranscriptState, parseCodexTranscriptLine } from "./codexTranscript.ts";
import { mightCarryUsage, type UsageRecord } from "./usageRecord.ts";

export interface UsageTranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface UsageTranscriptListing {
  readonly files: readonly UsageTranscriptFile[];
  readonly skippedEntryCount: number;
  readonly errorCount: number;
}

export async function listUsageTranscriptFiles(
  root: string,
  modifiedAfterMs: number,
): Promise<UsageTranscriptListing> {
  const files: UsageTranscriptFile[] = [];
  let skippedEntryCount = 0;
  let errorCount = 0;

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch {
      errorCount += 1;
      return;
    }
    for (const entry of entries) {
      const child = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) {
        skippedEntryCount += 1;
        continue;
      }
      try {
        const stat = await NodeFSP.stat(child);
        if (stat.mtimeMs >= modifiedAfterMs) {
          files.push({ path: child, size: stat.size, mtimeMs: stat.mtimeMs });
        } else {
          skippedEntryCount += 1;
        }
      } catch {
        errorCount += 1;
      }
    }
  };

  await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, skippedEntryCount, errorCount };
}

export interface UsageTranscriptReadResult {
  readonly records: readonly UsageRecord[];
  readonly skippedLineCount: number;
  readonly malformedLineCount: number;
}

function isJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

export async function readUsageTranscript(
  filePath: string,
  provider: UsageProviderKind,
): Promise<UsageTranscriptReadResult | null> {
  const records: UsageRecord[] = [];
  const codexState = initialCodexTranscriptState();
  let skippedLineCount = 0;
  let malformedLineCount = 0;

  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      const carriesUsage = mightCarryUsage(line, provider);
      if (provider === "claude") {
        if (!carriesUsage) {
          skippedLineCount += 1;
          continue;
        }
        const record = parseClaudeTranscriptLine(line);
        if (record === null) {
          if (isJson(line)) skippedLineCount += 1;
          else malformedLineCount += 1;
        } else records.push(record);
        continue;
      }

      const carriesContext = line.includes('"turn_context"') || line.includes('"session_meta"');
      if (!carriesUsage && !carriesContext) {
        skippedLineCount += 1;
        continue;
      }
      const record = parseCodexTranscriptLine(line, codexState);
      if (record !== null) records.push(record);
      else if (carriesUsage) {
        if (isJson(line)) skippedLineCount += 1;
        else malformedLineCount += 1;
      }
    }
  } catch {
    return null;
  }

  return { records, skippedLineCount, malformedLineCount };
}

#!/usr/bin/env bun
// scripts/typecheck.ts
// Runs Next route type generation and TypeScript checking with heartbeat output so
// long silent tsc phases are not mistaken for a hung or failed command by agent harnesses.

import { spawn, spawnSync } from "child_process";

interface RunOptions {
  heartbeat?: string;
  heartbeatMs?: number;
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    if (options.heartbeat) {
      heartbeatTimer = setInterval(() => {
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        console.error(`[typecheck] ${options.heartbeat} still running (${elapsedSeconds}s elapsed)…`);
      }, options.heartbeatMs ?? 15_000);
      heartbeatTimer.unref();
    }

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      resolve({ code, signal });
    });
  });
}

function recentOomEvidence(): string {
  const journal = spawnSync("journalctl", ["-k", "--since", "15 minutes ago", "-o", "short-iso", "--no-pager"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  const output = journal.status === 0 ? journal.stdout : journal.stderr;
  const lines = output
    .split("\n")
    .filter((line) => /oom|killed process|out of memory/i.test(line))
    .slice(-20);
  return lines.join("\n");
}

function explainFailure(label: string, result: RunResult): void {
  const exitText = result.signal ? `signal ${result.signal}` : `exit code ${result.code ?? "unknown"}`;
  console.error(`[typecheck] ${label} failed with ${exitText}.`);

  if (result.signal === "SIGKILL" || result.code === 137) {
    const oom = recentOomEvidence();
    if (oom) {
      console.error("[typecheck] Recent kernel OOM evidence:");
      console.error(oom);
    } else {
      console.error("[typecheck] No recent kernel OOM-killer messages were found in journalctl.");
    }
  }
}

async function main(): Promise<void> {
  const typegen = await run("bun", ["--bun", "./node_modules/next/dist/bin/next", "typegen"]);
  if (typegen.code !== 0 || typegen.signal) {
    explainFailure("Next type generation", typegen);
    process.exit(typegen.code ?? 1);
  }

  console.error("[typecheck] TypeScript check starting…");
  const tsc = await run("tsc", ["--noEmit"], { heartbeat: "TypeScript check", heartbeatMs: 10_000 });
  if (tsc.code !== 0 || tsc.signal) {
    explainFailure("TypeScript check", tsc);
    process.exit(tsc.code ?? 1);
  }
  console.error("[typecheck] TypeScript check passed.");
}

main().catch((err) => {
  console.error(`[typecheck] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});

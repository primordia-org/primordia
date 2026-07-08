// lib/leak-diagnostics.ts
// Lightweight CPU/memory leak detection and disk diagnostics capture.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DIAGNOSTICS_DIR = "leak-diagnostics";
const LATEST_FILE = "latest.md";
const CPU_RATIO_THRESHOLD = 0.8;
const MEMORY_USED_THRESHOLD = 90;
const CONSECUTIVE_SAMPLES_REQUIRED = 2;

export interface LeakDiagnosticsSummary {
  exists: boolean;
  path: string;
  capturedAt: number | null;
  sizeBytes: number | null;
  reason: string | null;
}

interface SystemSample {
  checkedAt: number;
  load1: number;
  load5: number;
  load15: number;
  cpuCount: number;
  memoryUsedPercent: number;
  memoryTotalMB: number;
  memoryAvailableMB: number;
  primordiaCpuPercent: number;
  topPrimordiaProcess: string | null;
  reasons: string[];
}

let consecutiveLeakSamples = 0;
let lastCaptureAt = 0;

function primordiaRoot(repoRoot: string): string {
  return process.env.PRIMORDIA_DIR || repoRoot;
}

export function getLeakDiagnosticsDir(repoRoot: string): string {
  return path.join(primordiaRoot(repoRoot), DIAGNOSTICS_DIR);
}

export function getLatestLeakDiagnosticsPath(repoRoot: string): string {
  return path.join(getLeakDiagnosticsDir(repoRoot), LATEST_FILE);
}

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  if (result.status !== 0 && stderr) return `${stdout}\n[exit ${result.status}] ${stderr}`.trim();
  return stdout || stderr;
}

function readMemory(): { totalMB: number; availableMB: number; usedPercent: number } {
  const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
  const get = (key: string): number => {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return match ? Number(match[1]) : 0;
  };
  const totalKB = get("MemTotal");
  const availableKB = get("MemAvailable");
  const totalMB = Math.round(totalKB / 1024);
  const availableMB = Math.round(availableKB / 1024);
  const usedPercent = totalMB > 0 ? Math.round(((totalMB - availableMB) / totalMB) * 100) : 0;
  return { totalMB, availableMB, usedPercent };
}

function sampleSystem(): SystemSample | null {
  try {
    const checkedAt = Date.now();
    const [load1, load5, load15] = os.loadavg();
    const cpuCount = Math.max(1, os.cpus().length);
    const memory = readMemory();
    const ps = run("ps", ["-eo", "pid,pcpu,pmem,rss,args", "--no-headers"]);
    let primordiaCpuPercent = 0;
    let topCpu = -1;
    let topPrimordiaProcess: string | null = null;
    for (const line of ps.split("\n")) {
      if (!line.includes("primordia")) continue;
      const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const cpu = Number(match[2]);
      if (!Number.isFinite(cpu)) continue;
      primordiaCpuPercent += cpu;
      if (cpu > topCpu) {
        topCpu = cpu;
        topPrimordiaProcess = line.trim();
      }
    }

    const reasons: string[] = [];
    if (memory.usedPercent >= MEMORY_USED_THRESHOLD) {
      reasons.push(`memory ${memory.usedPercent}% used (threshold ${MEMORY_USED_THRESHOLD}%)`);
    }
    if (load1 >= cpuCount * CPU_RATIO_THRESHOLD) {
      reasons.push(`load average ${load1.toFixed(2)} on ${cpuCount} CPU(s) (threshold ${(cpuCount * CPU_RATIO_THRESHOLD).toFixed(2)})`);
    }
    if (primordiaCpuPercent >= cpuCount * 75) {
      reasons.push(`Primordia processes using ${primordiaCpuPercent.toFixed(1)}% CPU across ${cpuCount} CPU(s)`);
    }

    return {
      checkedAt,
      load1,
      load5,
      load15,
      cpuCount,
      memoryUsedPercent: memory.usedPercent,
      memoryTotalMB: memory.totalMB,
      memoryAvailableMB: memory.availableMB,
      primordiaCpuPercent,
      topPrimordiaProcess,
      reasons,
    };
  } catch (err) {
    console.error("[leak-diagnostics] sample failed", err);
    return null;
  }
}

export function readLeakDiagnosticsSummary(repoRoot: string): LeakDiagnosticsSummary {
  const latestPath = getLatestLeakDiagnosticsPath(repoRoot);
  try {
    const stat = fs.statSync(latestPath);
    const text = fs.readFileSync(latestPath, "utf8");
    const reasonMatch = text.match(/^Reason: (.+)$/m);
    return {
      exists: true,
      path: latestPath,
      capturedAt: stat.mtimeMs,
      sizeBytes: stat.size,
      reason: reasonMatch?.[1] ?? null,
    };
  } catch {
    return { exists: false, path: latestPath, capturedAt: null, sizeBytes: null, reason: null };
  }
}

export function readLatestLeakDiagnostics(repoRoot: string): string | null {
  try {
    return fs.readFileSync(getLatestLeakDiagnosticsPath(repoRoot), "utf8");
  } catch {
    return null;
  }
}

function writeDiagnostics(repoRoot: string, sample: SystemSample): string {
  const dir = getLeakDiagnosticsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const iso = new Date(sample.checkedAt).toISOString();
  const safeStamp = iso.replace(/[:.]/g, "-");
  const latestPath = getLatestLeakDiagnosticsPath(repoRoot);
  const timestampPath = path.join(dir, `${safeStamp}.md`);
  const reason = sample.reasons.join("; ");
  const sections: Array<[string, string]> = [
    ["System", run("uname", ["-a"])],
    ["Uptime", run("uptime", [])],
    ["Memory (/proc/meminfo)", fs.existsSync("/proc/meminfo") ? fs.readFileSync("/proc/meminfo", "utf8").trim() : "unavailable"],
    ["Top processes by CPU", run("ps", ["-eo", "pid,ppid,user,stat,pcpu,pmem,rss,vsz,etime,time,args", "--sort=-pcpu"])],
    ["Top processes by memory", run("ps", ["-eo", "pid,ppid,user,stat,pcpu,pmem,rss,vsz,etime,time,args", "--sort=-rss"])],
    ["Primordia process manager status", run("bun", ["run", "primordia", "status", "--json"], repoRoot)],
    ["Git worktrees", run("git", ["worktree", "list", "--porcelain"], repoRoot)],
  ];

  const body = `# Primordia CPU / memory leak diagnostics\n\n` +
    `Captured at: ${iso}\n\n` +
    `Reason: ${reason}\n\n` +
    `Summary:\n` +
    `- Load average: ${sample.load1.toFixed(2)} ${sample.load5.toFixed(2)} ${sample.load15.toFixed(2)} on ${sample.cpuCount} CPU(s)\n` +
    `- Memory: ${sample.memoryUsedPercent}% used, ${sample.memoryAvailableMB.toLocaleString()} MB available of ${sample.memoryTotalMB.toLocaleString()} MB\n` +
    `- Primordia CPU total: ${sample.primordiaCpuPercent.toFixed(1)}%\n` +
    `- Top Primordia process: ${sample.topPrimordiaProcess ?? "none found"}\n\n` +
    sections.map(([title, content]) => `## ${title}\n\n\`\`\`\n${content || "(empty)"}\n\`\`\``).join("\n\n") +
    "\n";

  fs.writeFileSync(timestampPath, body, "utf8");
  fs.writeFileSync(latestPath, body, "utf8");
  return latestPath;
}

export function checkAndCaptureLeakDiagnostics(repoRoot: string): { captured: boolean; path?: string; reason?: string } {
  const sample = sampleSystem();
  if (!sample || sample.reasons.length === 0) {
    consecutiveLeakSamples = 0;
    return { captured: false };
  }

  consecutiveLeakSamples += 1;
  if (consecutiveLeakSamples < CONSECUTIVE_SAMPLES_REQUIRED) {
    return { captured: false, reason: sample.reasons.join("; ") };
  }

  // Avoid overwriting diagnostics continuously during a sustained incident.
  if (Date.now() - lastCaptureAt < 30 * 60 * 1000 && fs.existsSync(getLatestLeakDiagnosticsPath(repoRoot))) {
    return { captured: false, reason: sample.reasons.join("; ") };
  }

  const diagnosticsPath = writeDiagnostics(repoRoot, sample);
  lastCaptureAt = Date.now();
  console.warn(`[leak-diagnostics] Captured diagnostics at ${diagnosticsPath}: ${sample.reasons.join("; ")}`);
  return { captured: true, path: diagnosticsPath, reason: sample.reasons.join("; ") };
}

export function readLeakDiagnosticsNotificationState(repoRoot: string): number {
  const result = spawnSync("git", ["config", "--get", "primordia.leakDiagnosticsLastNotifiedMtime"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return Number(result.stdout.trim()) || 0;
}

export function writeLeakDiagnosticsNotificationState(repoRoot: string, mtimeMs: number): void {
  spawnSync("git", ["config", "primordia.leakDiagnosticsLastNotifiedMtime", String(Math.round(mtimeMs))], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

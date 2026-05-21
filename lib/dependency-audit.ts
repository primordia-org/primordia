// lib/dependency-audit.ts
// Helpers for running `bun audit` and storing the daily severe-vulnerability
// notification state in git config.

import { execFileSync, spawnSync } from "child_process";

export type AuditSeverity = "low" | "moderate" | "high" | "critical";

export interface AuditFinding {
  id: string;
  packageName: string;
  severity: AuditSeverity | string;
  title: string;
  url?: string;
}

export interface BunAuditResult {
  ok: boolean;
  rawOutput: string;
  jsonText: string;
  findings: AuditFinding[];
  severeFindings: AuditFinding[];
  error: string | null;
  checkedAt: number;
}

const SEVERE = new Set(["high", "critical"]);

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function extractJson(text: string): string {
  const clean = stripAnsi(text).trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return "{}";
  return clean.slice(first, last + 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function collectFindings(value: unknown, out: AuditFinding[], seen: Set<string>, inheritedPackage = ""): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFindings(item, out, seen, inheritedPackage);
    return;
  }

  const obj = asRecord(value);
  if (!obj) return;

  const packageName =
    findString(obj, ["package", "packageName", "name", "module_name", "dependency"])
    ?? inheritedPackage;
  const severity = findString(obj, ["severity"]);
  const title = findString(obj, ["title", "summary", "overview", "cwe"]);
  const id = findString(obj, ["id", "cve", "cve_id", "ghsaId", "ghsa_id", "url"]);
  const url = findString(obj, ["url", "more_info", "advisory"]);

  if (severity) {
    const normalizedId = id ?? `${packageName}:${severity}:${title ?? JSON.stringify(obj).slice(0, 80)}`;
    const key = `${packageName}|${normalizedId}|${severity}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        id: normalizedId,
        packageName: packageName || "unknown package",
        severity,
        title: title ?? normalizedId,
        url,
      });
    }
  }

  for (const [key, child] of Object.entries(obj)) {
    const childPackage = key && typeof child === "object" ? key : packageName;
    collectFindings(child, out, seen, childPackage || inheritedPackage);
  }
}

function parseFindings(jsonText: string): AuditFinding[] {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const findings: AuditFinding[] = [];
    collectFindings(parsed, findings, new Set());
    return findings;
  } catch {
    return [];
  }
}

export function runBunAudit(auditLevel?: AuditSeverity): BunAuditResult {
  const args = ["audit", "--json"];
  if (auditLevel) args.push(`--audit-level=${auditLevel}`);

  const result = spawnSync("bun", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const jsonText = extractJson(combined);
  const findings = parseFindings(jsonText);
  const severeFindings = findings.filter((f) => SEVERE.has(f.severity.toLowerCase()));
  const error = result.error
    ? result.error.message
    : result.status !== 0 && !combined
      ? `bun audit exited with status ${result.status}`
      : null;

  return {
    ok: !error,
    rawOutput: stripAnsi(combined || jsonText),
    jsonText,
    findings,
    severeFindings,
    error,
    checkedAt: Date.now(),
  };
}

function gitConfig(args: string[], cwd: string): string {
  return execFileSync("git", ["config", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function gitConfigSafe(args: string[], cwd: string): string | null {
  try {
    return gitConfig(args, cwd);
  } catch {
    return null;
  }
}

export function readDependencyAuditNotification(repoRoot: string): {
  lastCheckedAt: number | null;
  severeCount: number;
} {
  const ts = gitConfigSafe(["--get", "primordia.bunAuditLastCheckedAt"], repoRoot);
  const count = gitConfigSafe(["--get", "primordia.bunAuditSevereCount"], repoRoot);
  return {
    lastCheckedAt: ts ? Number(ts) || null : null,
    severeCount: count ? Number(count) || 0 : 0,
  };
}

export function writeDependencyAuditNotification(repoRoot: string, result: BunAuditResult): void {
  gitConfig(["primordia.bunAuditLastCheckedAt", String(result.checkedAt)], repoRoot);
  gitConfig(["primordia.bunAuditSevereCount", String(result.severeFindings.length)], repoRoot);
}

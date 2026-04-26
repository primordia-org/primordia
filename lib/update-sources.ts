// lib/update-sources.ts
// Manages the list of git-based update sources for the "Fetch Updates" admin panel.
//
// ─── Storage: git config (primordia-update-source subsections) ───────────────
//
// Each source is stored as a subsection of `primordia-update-source` in the
// local .git/config file, mirroring exactly how git itself stores remotes:
//
//   [primordia-update-source "primordia-updates"]
//       name    = Primordia Official
//       url     = https://primordia.exe.xyz/api/git
//       enabled = true
//       builtin = true
//
// Keys are read with:
//   git config --get primordia-update-source.{id}.{field}
//
// The full list of sources is enumerated with:
//   git config --get-regexp 'primordia-update-source\..*\.url'
//   (outputs "primordia-update-source.{id}.url {value}" per line)
//
// A whole source is removed with:
//   git config --remove-section primordia-update-source.{id}
//
// This keeps all non-sensitive runtime state in git config alongside branch
// ports (branch.{name}.port), production branch (primordia.productionBranch),
// and proxy settings (primordia.previewInactivityMin, etc.).
// See CLAUDE.md §"Git config as key-value store" for the full pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "child_process";

export interface UpdateSource {
  /** Unique identifier — subsection name in git config (no spaces, no slashes). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Git remote URL (read-only HTTP git endpoint). */
  url: string;
  /** Local tracking branch, always `${id}-main`. */
  trackingBranch: string;
  /** Whether this source is included in fetch operations. */
  enabled: boolean;
  /**
   * True for the built-in Primordia Official source. Built-in sources cannot
   * be deleted, only disabled.
   */
  builtin: boolean;
}

// ─── Built-in source definition ───────────────────────────────────────────────

const BUILTIN_ID = "primordia-updates";
const BUILTIN_SOURCE: UpdateSource = {
  id: BUILTIN_ID,
  name: "Primordia Official",
  url: "https://primordia.exe.xyz/api/git",
  trackingBranch: "primordia-updates-main",
  enabled: true,
  builtin: true,
};

// ─── Low-level git config helpers ─────────────────────────────────────────────

function gitGet(key: string, repoRoot: string): string | null {
  const r = spawnSync("git", ["config", "--get", key], { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function gitGetRegexp(pattern: string, repoRoot: string): Array<{ key: string; value: string }> {
  const r = spawnSync("git", ["config", "--get-regexp", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout.trim()) return [];
  return r.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      return spaceIdx === -1
        ? { key: line, value: "" }
        : { key: line.slice(0, spaceIdx), value: line.slice(spaceIdx + 1) };
    });
}

function gitSet(key: string, value: string, repoRoot: string): void {
  const r = spawnSync("git", ["config", key, value], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git config ${key} failed: ${r.stderr?.trim()}`);
}

function gitRemoveSection(section: string, repoRoot: string): void {
  const r = spawnSync("git", ["config", "--remove-section", section], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git config --remove-section ${section} failed: ${r.stderr?.trim()}`);
}

// ─── Source section helpers ────────────────────────────────────────────────────

function sectionName(id: string): string {
  return `primordia-update-source.${id}`;
}

/** Write all fields of a source into git config. Idempotent. */
function writeSource(source: UpdateSource, repoRoot: string): void {
  const sec = sectionName(source.id);
  gitSet(`${sec}.name`, source.name, repoRoot);
  gitSet(`${sec}.url`, source.url, repoRoot);
  gitSet(`${sec}.enabled`, String(source.enabled), repoRoot);
  gitSet(`${sec}.builtin`, String(source.builtin), repoRoot);
}

/** Read a single source from git config by ID. Returns null if not found. */
function readSourceById(id: string, repoRoot: string): UpdateSource | null {
  const sec = sectionName(id);
  const url = gitGet(`${sec}.url`, repoRoot);
  if (!url) return null;
  const name = gitGet(`${sec}.name`, repoRoot) ?? id;
  const enabled = gitGet(`${sec}.enabled`, repoRoot) !== "false";
  const builtin = gitGet(`${sec}.builtin`, repoRoot) === "true";
  return { id, name, url, trackingBranch: `${id}-main`, enabled, builtin };
}

/** Ensure the built-in source is present in git config (idempotent). */
function ensureBuiltin(repoRoot: string): UpdateSource {
  const existing = readSourceById(BUILTIN_ID, repoRoot);
  if (existing) {
    // Always keep url + builtin flag correct (in case someone edited config manually)
    if (existing.url !== BUILTIN_SOURCE.url || !existing.builtin) {
      gitSet(`${sectionName(BUILTIN_ID)}.url`, BUILTIN_SOURCE.url, repoRoot);
      gitSet(`${sectionName(BUILTIN_ID)}.builtin`, "true", repoRoot);
    }
    return { ...existing, url: BUILTIN_SOURCE.url, builtin: true };
  }
  writeSource(BUILTIN_SOURCE, repoRoot);
  return BUILTIN_SOURCE;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read all update sources from git config.
 * Always includes the built-in source (initialising it if absent).
 * Returns sources with the built-in first, then user-added in insertion order.
 */
export function readSources(repoRoot: string): UpdateSource[] {
  const builtin = ensureBuiltin(repoRoot);

  // Enumerate all source IDs by looking for *.url keys.
  // Key format (git lowercases section + field names but NOT subsection names):
  //   primordia-update-source.{id}.url {value}
  const entries = gitGetRegexp("primordia-update-source\\..*\\.url", repoRoot);
  const seenIds = new Set<string>();
  const sources: UpdateSource[] = [builtin];
  seenIds.add(BUILTIN_ID);

  for (const { key } of entries) {
    // key = "primordia-update-source.{id}.url"
    // Section name is lowercased by git; subsection (id) is NOT.
    const match = key.match(/^primordia-update-source\.([^.]+)\.url$/);
    if (!match) continue;
    const id = match[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const source = readSourceById(id, repoRoot);
    if (source) sources.push(source);
  }

  return sources;
}

/**
 * Add a new user-defined update source.
 * The source ID is derived from the name (kebab-case, unique).
 * Returns the newly created source.
 */
export function addSource(repoRoot: string, name: string, url: string): UpdateSource {
  const existing = readSources(repoRoot);
  const baseId = slugify(name);
  const id = uniqueId(baseId, existing.map((s) => s.id));
  const source: UpdateSource = {
    id,
    name,
    url,
    trackingBranch: `${id}-main`,
    enabled: true,
    builtin: false,
  };
  writeSource(source, repoRoot);
  return source;
}

/**
 * Remove a non-built-in update source from git config.
 * Throws if the source is built-in or not found.
 */
export function removeSource(repoRoot: string, id: string): void {
  const source = readSourceById(id, repoRoot);
  if (!source) throw new Error(`Source not found: ${id}`);
  if (source.builtin) throw new Error(`Cannot delete the built-in source "${id}".`);
  gitRemoveSection(sectionName(id), repoRoot);
}

/**
 * Set the enabled flag for a source.
 * Works for both built-in and user-defined sources.
 */
export function setSourceEnabled(repoRoot: string, id: string, enabled: boolean): void {
  const source = readSourceById(id, repoRoot);
  if (!source) throw new Error(`Source not found: ${id}`);
  gitSet(`${sectionName(id)}.enabled`, String(enabled), repoRoot);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "source"
  );
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

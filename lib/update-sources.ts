// lib/update-sources.ts
// Manages the list of git-based update sources for the "Fetch Updates" admin panel.
//
// Sources are persisted to `.primordia-update-sources.json` in the repo root.
// The built-in "primordia-updates" source (primordia.exe.xyz) cannot be deleted,
// but it can be disabled.

import * as fs from "fs";
import * as path from "path";

export interface UpdateSource {
  /** Unique identifier — also used as the git remote name (no spaces, no slashes). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Git remote URL (must be accessible without auth for read-only HTTP clone). */
  url: string;
  /** Local tracking branch, derived as `${id}-main`. */
  trackingBranch: string;
  /** Whether this source is included in fetch operations. */
  enabled: boolean;
  /**
   * True for the built-in Primordia source. Built-in sources cannot be deleted,
   * only disabled.
   */
  builtin: boolean;
}

interface SourcesFile {
  sources: UpdateSource[];
}

const BUILTIN_SOURCE: UpdateSource = {
  id: "primordia-updates",
  name: "Primordia Official",
  url: "https://primordia.exe.xyz/api/git",
  trackingBranch: "primordia-updates-main",
  enabled: true,
  builtin: true,
};

/** Returns the path to the JSON sources file given the repo root. */
function sourcesFilePath(repoRoot: string): string {
  return path.join(repoRoot, ".primordia-update-sources.json");
}

/** Read sources from disk. Missing file → returns default (built-in only). */
export function readSources(repoRoot: string): UpdateSource[] {
  const filePath = sourcesFilePath(repoRoot);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as SourcesFile;
    if (!Array.isArray(data.sources)) return [BUILTIN_SOURCE];

    // Always ensure the built-in source is present (merge with persisted enabled state).
    const builtinPersisted = data.sources.find((s) => s.id === BUILTIN_SOURCE.id);
    const builtinSource: UpdateSource = {
      ...BUILTIN_SOURCE,
      enabled: builtinPersisted?.enabled ?? true,
    };

    const userSources = data.sources.filter((s) => s.id !== BUILTIN_SOURCE.id);
    return [builtinSource, ...userSources];
  } catch {
    return [BUILTIN_SOURCE];
  }
}

/** Persist the sources list to disk. Always writes the built-in source first. */
export function writeSources(repoRoot: string, sources: UpdateSource[]): void {
  const filePath = sourcesFilePath(repoRoot);
  const data: SourcesFile = { sources };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Add a new user-defined source. Throws if the ID already exists.
 * The ID is derived from the name (kebab-case, unique across current sources).
 */
export function addSource(
  repoRoot: string,
  name: string,
  url: string,
): UpdateSource {
  const sources = readSources(repoRoot);
  const baseId = slugify(name);
  const id = uniqueId(baseId, sources.map((s) => s.id));
  const source: UpdateSource = {
    id,
    name,
    url,
    trackingBranch: `${id}-main`,
    enabled: true,
    builtin: false,
  };
  writeSources(repoRoot, [...sources, source]);
  return source;
}

/** Remove a non-built-in source. Throws if the source is built-in or not found. */
export function removeSource(repoRoot: string, id: string): void {
  const sources = readSources(repoRoot);
  const source = sources.find((s) => s.id === id);
  if (!source) throw new Error(`Source not found: ${id}`);
  if (source.builtin) throw new Error(`Cannot delete built-in source: ${id}`);
  writeSources(
    repoRoot,
    sources.filter((s) => s.id !== id),
  );
}

/** Toggle the enabled state of a source (built-in sources can be disabled but not deleted). */
export function setSourceEnabled(repoRoot: string, id: string, enabled: boolean): void {
  const sources = readSources(repoRoot);
  const idx = sources.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error(`Source not found: ${id}`);
  sources[idx] = { ...sources[idx], enabled };
  writeSources(repoRoot, sources);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "source";
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

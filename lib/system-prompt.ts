// lib/system-prompt.ts
//
// Builds the chat system prompt at runtime by reading PRIMORDIA.md and the
// last 30 changelog filenames from the changelog/ directory.
// No prebuild or file-generation step required.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const repoRoot = join(process.cwd());
const changelogDir = join(repoRoot, "changelog");

// Matches: YYYY-MM-DD-HH-MM-SS Description of change.md
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2}) (.+)\.md$/;

export function buildSystemPrompt(): string {
  let primordiaContent = "";
  try {
    primordiaContent = readFileSync(join(repoRoot, "PRIMORDIA.md"), "utf-8").trim();
  } catch {
    // Non-fatal: assistant will work without architecture context
  }

  let filenames: string[] = [];
  try {
    filenames = readdirSync(changelogDir)
      .filter((f) => FILENAME_RE.test(f))
      .sort()
      .reverse(); // newest first
  } catch {
    // Non-fatal: no changelog directory yet
  }

  const last30 = filenames.slice(0, 30);
  const changelogSection =
    last30.length > 0
      ? "## Changelog Entries (filename = short description)\n" +
        last30.map((f) => `- ${f.replace(/\.md$/, "")}`).join("\n")
      : "";

  const primordiaContext = [primordiaContent, changelogSection]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return `You are the AI assistant embedded in Primordia, a self-modifying web application.
You help users accomplish tasks and answer questions. Be concise and helpful.
When users seem interested in changing the app itself, remind them they can switch to "evolve mode" to propose changes.

You have access to two tools that let you read the live project files:
- list_directory(path): list files/subdirectories inside a project directory (dotfiles excluded)
- read_file(path): read the contents of a file (dotfiles blocked for security)
Use these tools when a user asks about specific files, current code, or project structure beyond what PRIMORDIA.md covers.

Below is the full architecture document and changelog for Primordia. Use this as the source of truth when answering questions about how the app works, what technologies it uses, or what has changed.

${primordiaContext}`;
}

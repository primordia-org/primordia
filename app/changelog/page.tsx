// app/changelog/page.tsx
//
// Server Component — reads changelog/*.md filenames at runtime (no pre-build
// step required) and renders a list of <details> disclosure widgets.
// File contents are NOT read here; they are lazy-loaded by the
// ChangelogEntryDetails client component when the user expands an entry.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { Metadata } from "next";
import { ChangelogEntryDetails } from "./ChangelogEntryDetails";
import { changelogEntrySlug } from "@/app/ChangelogNewsticker";
import { PageNavBar } from "@/components/PageNavBar";
import { buildPageTitle } from "@/lib/page-title";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Changelog"),
    description: "What changed and why — one entry per change.",
  };
}

// Matches: YYYY-MM-DD-HH-MM-SS Description of change.md
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2}) (.+)\.md$/;

interface ChangelogSummary {
  filename: string;
  date: string;   // ISO 8601, e.g. "2026-03-16T00:03:00"
  title: string;
}

// Returns a map of changelog filename → unix timestamp of the commit that first added it.
// Used to sort entries correctly even when filenames use a placeholder 00-00-00 time.
function getGitAddedTimestamps(changelogDir: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const output = execSync(
      "git log --diff-filter=A --format=COMMIT:%ct --name-only -- changelog/",
      { cwd: path.dirname(changelogDir), encoding: "utf8" }
    );
    let currentTs = 0;
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("COMMIT:")) {
        currentTs = parseInt(trimmed.slice(7), 10);
      } else if (trimmed.startsWith("changelog/")) {
        const filename = trimmed.slice("changelog/".length);
        if (filename && !map.has(filename)) {
          map.set(filename, currentTs);
        }
      }
    }
  } catch {
    // git not available or not a git repo — callers fall back to filename order
  }
  return map;
}

function loadSummaries(): ChangelogSummary[] {
  try {
    const changelogDir = path.join(process.cwd(), "changelog");
    const commitTimes = getGitAddedTimestamps(changelogDir);
    const files = fs
      .readdirSync(changelogDir)
      .filter((f) => FILENAME_RE.test(f))
      .sort((a, b) => {
        const tsA = commitTimes.get(a) ?? 0;
        const tsB = commitTimes.get(b) ?? 0;
        if (tsB !== tsA) return tsB - tsA; // newer commit first
        return a < b ? 1 : a > b ? -1 : 0; // same commit: reverse filename order
      });

    return files.map((file) => {
      const m = file.match(FILENAME_RE)!;
      const [, datePart, timePart, title] = m;
      const date = `${datePart}T${timePart.replace(/-/g, ":")}`;
      return { filename: file, date, title };
    });
  } catch {
    return [];
  }
}

export default async function ChangelogPage() {
  const [entries, user] = await Promise.all([
    Promise.resolve(loadSummaries()),
    getSessionUser(),
  ]);
  const [sessionUser, evolvePrefs] = user
    ? await Promise.all([
        isAdmin(user.id).then((admin) => ({ id: user.id, username: user.username, isAdmin: admin })),
        getEvolvePrefs(user.id),
      ])
    : [null, null];

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
      {/* Header — session resolved server-side so the hamburger is instant */}
      <PageNavBar subtitle="Changelog" currentPage="changelog" initialSession={sessionUser} initialHarness={evolvePrefs?.initialHarness} initialModel={evolvePrefs?.initialModel} initialCavemanMode={evolvePrefs?.initialCavemanMode} initialCavemanIntensity={evolvePrefs?.initialCavemanIntensity} />

      {/* Entry list */}
      {entries.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No changelog entries found. Add{" "}
          <code className="bg-gray-800 px-1 rounded text-xs">
            changelog/YYYY-MM-DD-HH-MM-SS Description.md
          </code>{" "}
          files to populate this page.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-6">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} — click to expand
          </p>
          <ol className="space-y-2">
            {entries.map((entry) => {
              const dateLabel = new Date(entry.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });

              return (
                <li key={entry.filename} id={changelogEntrySlug(entry.filename)}>
                  <ChangelogEntryDetails
                    filename={entry.filename}
                    date={entry.date}
                    title={entry.title}
                    dateLabel={dateLabel}
                  />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}

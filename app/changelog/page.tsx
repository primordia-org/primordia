// app/changelog/page.tsx
//
// Server Component — reads changelog/*.md filenames at runtime (no pre-build
// step required) and renders a list of <details> disclosure widgets.
// File contents are NOT read here; they are lazy-loaded by the
// ChangelogEntryDetails client component when the user expands an entry.

import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { ChangelogEntryDetails } from "@/components/ChangelogEntryDetails";
import { PageNavBar } from "@/components/PageNavBar";
import { buildPageTitle } from "@/lib/page-title";
import { getSessionUser } from "@/lib/auth";

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

function loadSummaries(): ChangelogSummary[] {
  try {
    const changelogDir = path.join(process.cwd(), "changelog");
    const files = fs
      .readdirSync(changelogDir)
      .filter((f) => FILENAME_RE.test(f))
      .sort()
      .reverse(); // newest first

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
  const [entries, sessionUser] = await Promise.all([
    Promise.resolve(loadSummaries()),
    getSessionUser(),
  ]);

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
      {/* Header — session resolved server-side so the hamburger is instant */}
      <PageNavBar subtitle="Changelog" currentPage="changelog" initialSession={sessionUser} />

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
                <li key={entry.filename}>
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

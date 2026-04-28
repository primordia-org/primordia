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
import { ChevronLeft, ChevronRight } from "lucide-react";

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

const PAGE_SIZE = 100;

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

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

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageEntries = entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
            {totalPages > 1 && (
              <span className="ml-2">
                (page {safePage} of {totalPages})
              </span>
            )}
          </p>
          <ol className="space-y-0">
            {pageEntries.map((entry, i) => {
              const dateLabel = new Date(entry.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              });
              const prevDateLabel = i > 0
                ? new Date(pageEntries[i - 1].date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : null;
              const showSeparator = dateLabel !== prevDateLabel;

              return (
                <li key={entry.filename}>
                  {showSeparator && (
                    <div className={`flex items-center gap-3 ${i > 0 ? "mt-6" : ""} mb-2`}>
                      <div className="flex-1 h-px bg-gray-700" />
                      <span className="text-xs text-gray-500 whitespace-nowrap">{dateLabel}</span>
                      <div className="flex-1 h-px bg-gray-700" />
                    </div>
                  )}
                  <div id={changelogEntrySlug(entry.filename)} className={i > 0 && !showSeparator ? "mt-2" : ""}>
                    <ChangelogEntryDetails
                      filename={entry.filename}
                      date={entry.date}
                      title={entry.title}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          {totalPages > 1 && (
            <nav className="flex items-center justify-between mt-8 pt-4 border-t border-gray-700">
              <a
                href={safePage > 1 ? `?page=${safePage - 1}` : undefined}
                aria-disabled={safePage <= 1}
                className={
                  safePage <= 1
                    ? "inline-flex items-center gap-1 px-4 py-2 rounded text-sm bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "inline-flex items-center gap-1 px-4 py-2 rounded text-sm bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                }
              >
                <ChevronLeft size={14} /> Newer
              </a>
              <span className="text-xs text-gray-500">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, entries.length)} of {entries.length}
              </span>
              <a
                href={safePage < totalPages ? `?page=${safePage + 1}` : undefined}
                aria-disabled={safePage >= totalPages}
                className={
                  safePage >= totalPages
                    ? "inline-flex items-center gap-1 px-4 py-2 rounded text-sm bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "inline-flex items-center gap-1 px-4 py-2 rounded text-sm bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                }
              >
                Older <ChevronRight size={14} />
              </a>
            </nav>
          )}
        </>
      )}
    </main>
  );
}

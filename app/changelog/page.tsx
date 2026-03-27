// app/changelog/page.tsx
//
// Server Component — reads public/changelog.json (generated at build time by
// scripts/generate-changelog.mjs) and renders a list of changelog entries as
// <details>/<summary> disclosure widgets.
// No client-side JS needed.

import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { MarkdownContent } from "@/components/SimpleMarkdown";
import { PageNavBar } from "@/components/PageNavBar";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Changelog"),
    description: "What changed and why — one entry per change.",
  };
}

interface ChangelogEntry {
  filename: string;
  date: string;  // ISO 8601
  title: string;
  content: string;
}

function loadEntries(): ChangelogEntry[] {
  try {
    const filePath = path.join(process.cwd(), "public", "changelog.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ChangelogEntry[];
  } catch {
    return [];
  }
}

export default function ChangelogPage() {
  const entries = loadEntries();

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
      {/* Header — uses the shared navbar (hamburger menu shown only when logged in) */}
      <PageNavBar subtitle="Changelog" currentPage="changelog" />

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
              const dateLabel = new Date(entry.date).toLocaleDateString(
                "en-US",
                { year: "numeric", month: "short", day: "numeric" }
              );

              return (
                <li key={entry.filename}>
                  <details className="group border border-gray-800 rounded-lg overflow-hidden">
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-800/50 transition-colors list-none">
                      {/* Expand indicator */}
                      <span className="text-gray-500 group-open:rotate-90 transition-transform flex-shrink-0 text-xs">
                        ▶
                      </span>
                      {/* Date */}
                      <time
                        dateTime={entry.date}
                        className="text-xs text-gray-500 w-24 flex-shrink-0"
                      >
                        {dateLabel}
                      </time>
                      {/* Title */}
                      <span className="text-sm text-gray-100 leading-snug">
                        {entry.title}
                      </span>
                    </summary>

                    {/* Full content */}
                    {entry.content && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-800">
                        <MarkdownContent text={entry.content} />
                      </div>
                    )}
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}

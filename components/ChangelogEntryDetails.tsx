"use client";

// components/ChangelogEntryDetails.tsx
//
// Client component for a single changelog <details> entry.
// Renders the summary (date + title) immediately from props.
// Fetches the file body from /api/changelog?filename=... only when the
// <details> element is first opened — keeping the initial page render cheap.

import { useState, useRef } from "react";
import { MarkdownContent } from "@/components/SimpleMarkdown";
import { withBasePath } from "@/lib/base-path";

interface Props {
  filename: string;
  date: string;    // ISO 8601, e.g. "2026-03-16T00:03:00"
  title: string;
  dateLabel: string;
}

export function ChangelogEntryDetails({ filename, date, title, dateLabel }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    fetch(withBasePath(`/api/changelog?filename=${encodeURIComponent(filename)}`))
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => setContent(text.trim()))
      .catch(() => setContent("*(Failed to load content.)*"))
      .finally(() => setLoading(false));
  }

  return (
    <details
      data-id="changelog/entry-details"
      className="group border border-gray-800 rounded-lg overflow-hidden"
      onToggle={handleToggle}
    >
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-gray-800/50 transition-colors list-none">
        {/* Expand indicator */}
        {loading ? (
          <span className="flex-shrink-0 w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-gray-500 group-open:rotate-90 transition-transform flex-shrink-0 text-xs">
            ▶
          </span>
        )}
        {/* Date */}
        <time dateTime={date} className="text-xs text-gray-500 w-24 flex-shrink-0">
          {dateLabel}
        </time>
        {/* Title */}
        <span className="text-sm text-gray-100 leading-snug">{title}</span>
      </summary>

      {/* Body — rendered only after the first expand */}
      {content !== null && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-800">
          <MarkdownContent text={content} />
        </div>
      )}
    </details>
  );
}

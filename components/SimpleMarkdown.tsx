// components/SimpleMarkdown.tsx
//
// Minimal markdown renderer shared across the app.
//
// SimpleMarkdown   — inline renderer: bold, links, inline code, within a
//                    single line of text.
// MarkdownContent  — block renderer: splits content into lines, handles
//                    bullet lists and paragraphs, renders each line with
//                    SimpleMarkdown for inline formatting.

import React from "react";

// ─── SimpleMarkdown ──────────────────────────────────────────────────────────
// Renders a single line of text with inline markdown: bold, links, inline code.

export function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null;

  // Split on links [text](url), bold **text**, and inline `code`.
  // Use non-capturing inner groups so split() only puts the full token in the
  // array — not each inner capture group — which would otherwise cause bold
  // text to be rendered twice (once as <strong>, once as a plain <span>).
  const parts = text.split(/(\[(?:[^\]]+)\]\((?:[^)]+)\)|\*\*(?:[^*]+)\*\*|`(?:[^`]+)`)/g);

  const rendered: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (!part) { i++; continue; }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    const codeMatch = part.match(/^`([^`]+)`$/);

    if (linkMatch) {
      rendered.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-blue-300 hover:text-blue-200"
        >
          {linkMatch[1]}
        </a>
      );
    } else if (boldMatch) {
      rendered.push(<strong key={key++}>{boldMatch[1]}</strong>);
    } else if (codeMatch) {
      rendered.push(
        <code key={key++} className="bg-gray-700 px-1 rounded text-xs">
          {codeMatch[1]}
        </code>
      );
    } else {
      // suppressHydrationWarning: emojis can encode differently between Node.js
      // (server) and the browser, causing a spurious hydration mismatch error.
      // The content is always correct on the client, so we suppress the warning
      // and let React use the client-rendered text.
      rendered.push(<span key={key++} suppressHydrationWarning>{part}</span>);
    }
    i++;
  }

  return <>{rendered}</>;
}

// ─── MarkdownContent ─────────────────────────────────────────────────────────
// Renders multi-line markdown content.
// Splits on blank lines into paragraphs; within each paragraph handles bullet
// list items (lines starting with "- ") and plain lines.

export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  if (!text) return null;

  // Split into paragraph groups by blank lines.
  const paragraphs = text.split(/\n\n+/);

  return (
    <div className={className}>
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;

        // Check if all (non-empty) lines are bullet items.
        const allBullets = lines.every((l) => l.match(/^[-*] /));

        if (allBullets) {
          return (
            <ul key={pi} className="list-disc list-inside space-y-0.5 mb-3 text-xs text-gray-300 leading-relaxed">
              {lines.map((line, li) => (
                <li key={li}>
                  <SimpleMarkdown text={line.replace(/^[-*] /, "")} />
                </li>
              ))}
            </ul>
          );
        }

        // Mixed or plain paragraph — render each line, joining with spaces
        // unless a line ends with a colon (treat as a label line).
        return (
          <p key={pi} className="text-xs text-gray-300 leading-relaxed mb-3">
            {lines.map((line, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                <SimpleMarkdown text={line} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

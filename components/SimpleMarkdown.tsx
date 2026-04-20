"use client";

// components/SimpleMarkdown.tsx
//
// Chat-bubble markdown renderer backed by streamdown.  Inherits parent
// text colour/size so it works inside any coloured bubble.
// For block-prose styling see components/MarkdownContent.tsx.

import { Streamdown, type Components } from "streamdown";

// ─── Shared inline elements ───────────────────────────────────────────────────
// Link and inline-code styling is the same in all contexts.

function Anchor({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline text-blue-300 hover:text-blue-200"
    >
      {children}
    </a>
  );
}

function InlineCode({ children, className }: { children?: React.ReactNode; className?: string }) {
  if (className?.startsWith("language-")) {
    return <code className={className}>{children}</code>;
  }
  return <code className="bg-gray-700 px-1 rounded text-xs">{children}</code>;
}

// ─── Components for chat bubbles (SimpleMarkdown) ────────────────────────────
// Minimal overrides — paragraph spacing only; text colour/size come from the
// parent container so the component works inside any coloured bubble.

const chatComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  code: ({ children, className }) => <InlineCode className={className}>{children}</InlineCode>,
  pre: ({ children }) => (
    <pre className="bg-gray-800 rounded p-3 overflow-x-auto mb-3 text-xs">{children}</pre>
  ),
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 mb-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 mb-2">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
};

// ─── SimpleMarkdown ──────────────────────────────────────────────────────────

export function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Streamdown mode="static" components={chatComponents}>
      {text}
    </Streamdown>
  );
}


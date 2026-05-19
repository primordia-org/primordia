"use client";

// components/MarkdownContent.tsx
//
// Block-prose markdown renderer with the app's dark styling (text-xs,
// text-gray-300, etc.).  Used on the evolve session page and in changelog
// entries.  For the lighter chat-bubble variant see SimpleMarkdown.tsx.

import { useMemo, useSyncExternalStore } from "react";
import { Streamdown, type Components } from "streamdown";
import { withBasePath } from "@/lib/base-path";

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

function attachmentImageUrl(src: string | undefined, attachmentSessionId: string | undefined, origin?: string | null): string | undefined {
  if (!src || !attachmentSessionId) return src;
  const normalized = src.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith("attachments/")) return src;
  const filename = normalized.slice("attachments/".length);
  if (!filename || filename.includes("/")) return src;
  const apiPath = withBasePath(`/api/evolve/attachment/${encodeURIComponent(attachmentSessionId)}?file=${encodeURIComponent(filename)}`);
  return origin ? new URL(apiPath, origin).toString() : apiPath;
}

function resolveAttachmentImageMarkdown(text: string, attachmentSessionId: string | undefined, origin: string | null): string {
  if (!attachmentSessionId || !origin) return text;
  return text.replace(/(!\[[^\]]*\]\()((?:\.\/)?attachments\/[^\s)]+)([^)]*\))/g, (_match, prefix: string, src: string, suffix: string) => {
    const resolved = attachmentImageUrl(src, attachmentSessionId, origin);
    return `${prefix}${resolved ?? src}${suffix}`;
  });
}

function createProseComponents(attachmentSessionId?: string): Components {
  return {
    p: ({ children }) => (
      <p className="text-xs text-gray-300 leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside space-y-0.5 mb-3 text-xs text-gray-300 leading-relaxed">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside space-y-0.5 mb-3 text-xs text-gray-300 leading-relaxed">
        {children}
      </ol>
    ),
    li: ({ children }) => <li>{children}</li>,
    a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
    code: ({ children, className }) => <InlineCode className={className}>{children}</InlineCode>,
    pre: ({ children }) => (
      <pre className="bg-gray-800 rounded p-3 overflow-x-auto mb-3 text-xs">{children}</pre>
    ),
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    h1: ({ children }) => (
      <h1 className="text-sm font-bold text-gray-100 mb-2 mt-3">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-sm font-semibold text-gray-100 mb-2 mt-3">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-xs font-semibold text-gray-200 mb-1 mt-2">{children}</h3>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-gray-600 pl-3 text-xs text-gray-400 mb-3">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-gray-700 mb-3" />,
    img: ({ src, alt, title }) => {
      const resolvedSrc = attachmentImageUrl(typeof src === "string" ? src : undefined, attachmentSessionId);
      const caption = typeof title === "string" && title.trim() ? title : typeof alt === "string" ? alt : "";
      return (
        <figure className="my-3 max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedSrc}
            alt={typeof alt === "string" ? alt : ""}
            className="max-h-[28rem] w-auto max-w-full rounded border border-gray-800 object-contain"
          />
          {caption && (
            <figcaption className="mt-2 text-xs text-gray-500 font-mono break-words">
              {caption}
            </figcaption>
          )}
        </figure>
      );
    },
  };
}

function subscribeToOriginStore() {
  return () => {};
}

function getOriginSnapshot() {
  return window.location.origin;
}

function getServerOriginSnapshot() {
  return null;
}

export function MarkdownContent({ text, className, attachmentSessionId }: { text: string; className?: string; attachmentSessionId?: string }) {
  const browserOrigin = useSyncExternalStore(subscribeToOriginStore, getOriginSnapshot, getServerOriginSnapshot);
  const origin = attachmentSessionId ? browserOrigin : null;

  const resolvedText = useMemo(
    () => resolveAttachmentImageMarkdown(text, attachmentSessionId, origin),
    [text, attachmentSessionId, origin],
  );

  if (!text) return null;
  return (
    <Streamdown
      mode="static"
      className={className}
      components={createProseComponents(attachmentSessionId)}
      urlTransform={(url) => attachmentImageUrl(url, attachmentSessionId, origin)}
    >
      {resolvedText}
    </Streamdown>
  );
}

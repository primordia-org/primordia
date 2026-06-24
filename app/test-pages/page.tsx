// app/test-pages/page.tsx
// Index of all developer / component test pages.

import Link from "next/link";

const TEST_PAGES = [
  {
    href: "/test-pages/claude-auth-test",
    emoji: "🔑",
    title: "Claude Auth",
    description:
      "Obtain a .credentials.json for Claude Code via a temporary OAuth session. Spawns `claude auth login`, shows you the URL, accepts the code, and returns the credentials JSON.",
  },
  {
    href: "/test-pages/ansi-test",
    emoji: "🎨",
    title: "ANSI Renderer",
    description:
      "Interactive playground for AnsiRenderer. Includes pre-baked samples (spinner, install flow, errors) and a live streaming simulation.",
  },
  {
    href: "/test-pages/markdown-test",
    emoji: "📝",
    title: "Markdown Streaming",
    description:
      "Streams a full markdown sample through MarkdownContent — the same component used on session pages — with adjustable speed and chunk-size controls.",
  },
  {
    href: "/test-pages/nested-suspense-stream",
    emoji: "🌊",
    title: "Nested Suspense Streaming",
    description:
      "Streams delayed text lines from async Server Components using nested Suspense boundaries instead of SSE.",
  },
  {
    href: "/test-pages/sound-test",
    emoji: "🔊",
    title: "Sound Effects",
    description:
      "Soundboard for all Web Audio API sound effects with a live oscilloscope, per-sound diagnostics, and browser AudioContext info.",
  },
  {
    href: "/test-pages/web-push-test",
    emoji: "🔔",
    title: "Web Push",
    description:
      "Registers a browser PushSubscription, stores it in SQLite, and sends a VAPID-authenticated test notification through the service worker.",
  },
];

export default function TestPagesIndex() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-100">🧪 Test Pages</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Developer and component test pages — not part of the production UI.
        </p>
      </header>

      <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
        <ul className="space-y-3">
          {TEST_PAGES.map(({ href, emoji, title, description }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-start gap-4 rounded-xl border border-gray-700 bg-gray-900 px-5 py-4 hover:border-gray-500 hover:bg-gray-800 transition-colors group"
              >
                <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{emoji}</span>
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-semibold text-sm text-white group-hover:text-violet-300 transition-colors">
                    {title}
                  </span>
                  <span className="text-xs text-gray-400 leading-snug">{description}</span>
                  <span className="text-xs font-mono text-gray-600 mt-0.5">{href}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

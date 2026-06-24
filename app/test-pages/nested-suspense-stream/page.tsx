// app/test-pages/nested-suspense-stream/page.tsx
// Demonstrates server-rendered streaming with nested React Suspense boundaries.

import Link from "next/link";
import { Suspense } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StreamLine = {
  text: string;
  delayMs: number;
  tone?: "plain" | "success" | "info" | "warning";
};

type StreamSection = {
  title: string;
  delayMs: number;
  lines: StreamLine[];
};

const SECTIONS: StreamSection[] = [
  {
    title: "Boot sequence",
    delayMs: 350,
    lines: [
      { text: "Opening a fresh HTTP response from a Server Component.", delayMs: 500, tone: "info" },
      { text: "The shell rendered first, before these lines existed.", delayMs: 900 },
      { text: "No EventSource, polling, route handler, or client fetch is involved.", delayMs: 1300, tone: "success" },
    ],
  },
  {
    title: "Nested boundary A",
    delayMs: 900,
    lines: [
      { text: "This section is inside its own Suspense boundary.", delayMs: 700 },
      { text: "Each row below also suspends independently.", delayMs: 1200, tone: "info" },
      { text: "The browser receives HTML chunks as promises resolve.", delayMs: 1800, tone: "success" },
    ],
  },
  {
    title: "Nested boundary B",
    delayMs: 1500,
    lines: [
      { text: "A slower sibling section can finish after a faster one.", delayMs: 600, tone: "warning" },
      { text: "React coordinates the reveal order without custom streaming code.", delayMs: 1500 },
      { text: "Done: nested Suspense streamed text lines into the page.", delayMs: 2400, tone: "success" },
    ],
  },
];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function DelayedLine({ line, index }: { line: StreamLine; index: number }) {
  await wait(line.delayMs);

  const toneClass =
    line.tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : line.tone === "info"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
        : line.tone === "warning"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
          : "border-gray-700 bg-gray-900 text-gray-200";

  return (
    <li className={`rounded-lg border px-4 py-3 font-mono text-sm shadow-sm ${toneClass}`}>
      <span className="mr-3 text-gray-500">{String(index + 1).padStart(2, "0")}</span>
      {line.text}
    </li>
  );
}

function LineFallback({ index }: { index: number }) {
  return (
    <li className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 font-mono text-sm text-gray-500">
      <span className="mr-3 text-gray-700">{String(index + 1).padStart(2, "0")}</span>
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
        waiting for nested Suspense chunk…
      </span>
    </li>
  );
}

async function StreamSectionCard({ section }: { section: StreamSection }) {
  await wait(section.delayMs);

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-950/80 p-5 shadow-2xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-white">{section.title}</h2>
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
          streamed section
        </span>
      </div>
      <ul className="space-y-3">
        {section.lines.map((line, index) => (
          <Suspense key={line.text} fallback={<LineFallback index={index} />}>
            <DelayedLine line={line} index={index} />
          </Suspense>
        ))}
      </ul>
    </section>
  );
}

function SectionFallback({ title }: { title: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/40 p-5">
      <h2 className="text-base font-semibold text-gray-400">{title}</h2>
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((index) => (
          <LineFallback key={index} index={index} />
        ))}
      </div>
    </section>
  );
}

export default function NestedSuspenseStreamPage() {
  return (
    <main className="min-h-screen bg-gray-950 px-6 py-8 text-gray-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Link href="/test-pages" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to test pages
        </Link>

        <header className="rounded-3xl border border-gray-800 bg-gray-900 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-300">
            React Server Components
          </p>
          <h1 className="mt-3 text-3xl font-bold text-white">Nested Suspense text streaming</h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            This page intentionally delays async Server Components behind nested Suspense boundaries. The initial shell
            appears immediately, then sections and individual text lines stream in as HTML. It demonstrates a streaming UI
            without Server-Sent Events or a client-side fetch loop.
          </p>
        </header>

        <div className="space-y-5">
          {SECTIONS.map((section) => (
            <Suspense key={section.title} fallback={<SectionFallback title={section.title} />}>
              <StreamSectionCard section={section} />
            </Suspense>
          ))}
        </div>
      </div>
    </main>
  );
}

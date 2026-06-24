// app/test-pages/nested-suspense-stream/page.tsx
// Test page that streams customizable text with recursive React Suspense boundaries.

import { Suspense } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_TEXT = `Booting preview server…
Compiling /test-pages/nested-suspense-stream
Rendering Suspense line {n}
Flushing streamed HTML chunk {n}
Ready for the next log line…`;
const DEFAULT_DELAY_MS = 60;
const DEFAULT_SAFETY_CAP = 200;
const MAX_SAFETY_CAP = 2000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampNumber(value: string | string[] | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(firstValue(value) ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function getSourceLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : ["Streaming Suspense line {n}…"];
}

function formatLine(sourceLines: string[], lineNumber: number): string {
  const template = sourceLines[(lineNumber - 1) % sourceLines.length];
  return template
    .replaceAll("{n}", String(lineNumber))
    .replaceAll("{000}", String(lineNumber).padStart(3, "0"));
}

function EmptyLineFallback() {
  return <div className="h-5" aria-hidden="true" />;
}

async function SuspenseLogTail({
  sourceLines,
  lineNumber,
  delay,
  safetyCap,
}: {
  sourceLines: string[];
  lineNumber: number;
  delay: number;
  safetyCap: number;
}) {
  await wait(delay);

  return (
    <>
      <div className="whitespace-pre-wrap break-words text-gray-400">
        <span className="text-gray-600">{String(lineNumber).padStart(4, "0")} </span>
        {formatLine(sourceLines, lineNumber)}
      </div>
      {lineNumber < safetyCap ? (
        <Suspense fallback={<EmptyLineFallback />}>
          <SuspenseLogTail
            sourceLines={sourceLines}
            lineNumber={lineNumber + 1}
            delay={delay}
            safetyCap={safetyCap}
          />
        </Suspense>
      ) : (
        <div className="pt-2 text-gray-600 italic">
          stream paused at safety cap; raise the cap to continue the indefinite-stream simulation
        </div>
      )}
    </>
  );
}

type PageProps = {
  searchParams?: Promise<{
    text?: string | string[];
    delay?: string | string[];
    cap?: string | string[];
  }>;
};

export default async function NestedSuspenseStreamPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const text = firstValue(params?.text) ?? DEFAULT_TEXT;
  const delay = clampNumber(params?.delay, DEFAULT_DELAY_MS, 0, 500);
  const safetyCap = clampNumber(params?.cap, DEFAULT_SAFETY_CAP, 1, MAX_SAFETY_CAP);
  const sourceLines = getSourceLines(text);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <form className="flex flex-col gap-3 lg:flex-row lg:items-end" method="GET">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-gray-100">Nested Suspense Stream Test Page</h1>
            <p className="mt-1 text-xs text-gray-500">
              Customize log text and delay. Each resolved Suspense boundary renders one line plus the next Suspense
              boundary, simulating an unknown-length stream without SSE.
            </p>
            <textarea
              name="text"
              defaultValue={text}
              rows={5}
              className="mt-3 w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-violet-500"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              <span>Safety cap</span>
              <input
                name="cap"
                type="number"
                min={1}
                max={MAX_SAFETY_CAP}
                defaultValue={safetyCap}
                className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-gray-400">
              <span>Delay</span>
              <select
                name="delay"
                defaultValue={delay}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
              >
                {[0, 20, 40, 60, 100, 200, 500].map((value) => (
                  <option key={value} value={value}>
                    {value}ms / boundary
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              Start stream
            </button>
          </div>
        </form>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-gray-500">
        <span>
          Status: <span className="font-medium text-yellow-400">streaming recursive Suspense tail…</span>
        </span>
        <span>
          Source lines: <span className="font-mono text-gray-300">{sourceLines.length}</span>
        </span>
        <span>
          Transport: <span className="font-mono text-gray-300">HTML, no SSE</span>
        </span>
      </div>

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="flex flex-col overflow-hidden rounded-lg border border-emerald-700/50 bg-gray-900 text-sm">
          <details className="group flex-shrink-0" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs transition-colors hover:bg-gray-800/40">
              <span className="text-gray-600 transition-transform group-open:rotate-90">▶</span>
              <span className="text-gray-500">🪵 Suspense stream logs</span>
              <span className="ml-auto flex animate-pulse items-center gap-1.5 text-xs text-gray-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                streaming
              </span>
            </summary>
            <div className="border-t border-gray-800 px-4 py-3">
              <div className="max-h-[70vh] overflow-y-auto overflow-x-auto font-mono text-xs leading-5">
                <Suspense fallback={<EmptyLineFallback />}>
                  <SuspenseLogTail sourceLines={sourceLines} lineNumber={1} delay={delay} safetyCap={safetyCap} />
                </Suspense>
              </div>
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}

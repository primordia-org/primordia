// app/test-pages/nested-suspense-stream/page.tsx
// Test page that streams customizable text with a recursive React Suspense tail.

import { Suspense } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESC = "\x1b[";
const GREEN = `${ESC}32m`;
const CYAN = `${ESC}36m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;
const RESET = `${ESC}0m`;

const DEFAULT_TEXT = [
  `${DIM}▲ Next.js 16.2.6 (Turbopack)${RESET}`,
  `${DIM}- Local:        http://localhost:3002${RESET}`,
  `${DIM}- Network:      http://192.168.1.24:3002${RESET}`,
  `${GREEN}✓${RESET} Starting...`,
  `${GREEN}✓${RESET} Ready in 1248ms`,
  `${CYAN}○${RESET} Compiling /test-pages/nested-suspense-stream ...`,
  `${GREEN}✓${RESET} Compiled /test-pages/nested-suspense-stream in 932ms`,
  `${BOLD}GET${RESET} /test-pages/nested-suspense-stream 200 in 1187ms`,
  `${CYAN}○${RESET} Compiling /_not-found ...`,
  `${GREEN}✓${RESET} Compiled /_not-found in 410ms`,
  `${YELLOW}⚠${RESET} Fast Refresh had to perform a full reload because a Server Component changed.`,
  `${BOLD}GET${RESET} /favicon.ico 200 in 36ms`,
  `${CYAN}○${RESET} Compiling /test-pages ...`,
  `${GREEN}✓${RESET} Compiled /test-pages in 288ms`,
  `${BOLD}GET${RESET} /test-pages 200 in 352ms`,
  `${CYAN}○${RESET} Compiling /api/evolve/stream ...`,
  `${GREEN}✓${RESET} Compiled /api/evolve/stream in 517ms`,
  `${BOLD}GET${RESET} /api/evolve/stream?sessionId=nested-suspense-stream-test 200 in 42ms`,
  `${YELLOW}⚠${RESET} The requested page uses force-dynamic and will not be statically cached.`,
  `${RED}⨯${RESET} Example recoverable log: preview socket disconnected, retrying...`,
  `${GREEN}✓${RESET} Preview socket reconnected`,
].join("\n");
const DEFAULT_DELAY_MS = 80;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampDelay(value: string | string[] | undefined): number {
  const parsed = Number(firstValue(value) ?? DEFAULT_DELAY_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_DELAY_MS;
  return Math.max(0, Math.min(500, Math.round(parsed)));
}

function getSourceLines(text: string): string[] {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [""];
}

function EmptyLineFallback() {
  return <div className="h-5" aria-hidden="true" />;
}

async function SuspenseLogTail({
  lines,
  index,
  delay,
}: {
  lines: string[];
  index: number;
  delay: number;
}) {
  const line = lines[index];
  if (line === undefined) return null;

  await wait(delay);

  return (
    <>
      <AnsiRenderer text={line} className="text-gray-400" />
      <Suspense fallback={<EmptyLineFallback />}>
        <SuspenseLogTail lines={lines} index={index + 1} delay={delay} />
      </Suspense>
    </>
  );
}

type PageProps = {
  searchParams?: Promise<{
    text?: string | string[];
    delay?: string | string[];
  }>;
};

export default async function NestedSuspenseStreamPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const text = firstValue(params?.text) ?? DEFAULT_TEXT;
  const delay = clampDelay(params?.delay);
  const lines = getSourceLines(text);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <form className="flex flex-col gap-3 lg:flex-row lg:items-end" method="GET">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-gray-100">Recursive Suspense Tail Test Page</h1>
            <p className="mt-1 text-xs text-gray-500">
              Customize the server-log text and delay. Each Suspense boundary resolves to one ANSI-rendered line plus the
              next Suspense boundary, then stops when the text ends.
            </p>
            <textarea
              name="text"
              defaultValue={text}
              rows={8}
              className="mt-3 w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-violet-500"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              <span>Delay</span>
              <select
                name="delay"
                defaultValue={delay}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200"
              >
                {[0, 20, 40, 80, 120, 200, 500].map((value) => (
                  <option key={value} value={value}>
                    {value}ms / line
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
          Renderer: <span className="font-mono text-gray-300">ANSI per line</span>
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
              <span className="text-gray-500">🪵 Server logs</span>
              <span className="ml-auto flex animate-pulse items-center gap-1.5 text-xs text-gray-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                streaming
              </span>
            </summary>
            <div className="border-t border-gray-800 px-4 py-3">
              <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
                <Suspense fallback={<EmptyLineFallback />}>
                  <SuspenseLogTail lines={lines} index={0} delay={delay} />
                </Suspense>
              </div>
            </div>
          </details>
        </div>
      </main>
    </div>
  );
}

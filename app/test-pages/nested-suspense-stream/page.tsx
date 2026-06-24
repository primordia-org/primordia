// app/test-pages/nested-suspense-stream/page.tsx
// Test page that streams customizable text with a recursive React Suspense tail.

import { Suspense } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { NestedSuspenseStreamControls } from "./NestedSuspenseStreamControls";

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

const DEMOS = [
  {
    label: "Next.js dev server",
    text: [
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
    ].join("\n"),
  },
  {
    label: "Preview restart",
    text: [
      `${YELLOW}⚠${RESET} Preview server exited unexpectedly`,
      `${CYAN}○${RESET} Restart requested for branch nested-suspense-stream-test`,
      `${DIM}Killing stale preview process on port 3002${RESET}`,
      `${GREEN}✓${RESET} Port released`,
      `${CYAN}○${RESET} Spawning bun run dev with NEXT_BASE_PATH=/preview/nested-suspense-stream-test`,
      `${DIM}$ bun run --bun next dev --turbopack${RESET}`,
      `${DIM}▲ Next.js 16.2.6 (Turbopack)${RESET}`,
      `${GREEN}✓${RESET} Starting...`,
      `${GREEN}✓${RESET} Ready in 1395ms`,
      `${BOLD}GET${RESET} /preview/nested-suspense-stream-test 200 in 64ms`,
    ].join("\n"),
  },
  {
    label: "Compile error",
    text: [
      `${CYAN}○${RESET} Compiling /test-pages/nested-suspense-stream ...`,
      `${RED}⨯${RESET} ./app/test-pages/nested-suspense-stream/page.tsx:84:13`,
      `${RED}⨯${RESET} Type error: Property 'delay' is missing in type '{ lines: string[]; }'`,
      `${DIM}  82 |       <Suspense fallback={<EmptyLineFallback />}>${RESET}`,
      `${DIM}  83 |         <SuspenseLogTail${RESET}`,
      `${RED}     |             ^${RESET}`,
      `${DIM}  84 |           lines={lines}${RESET}`,
      `${DIM}  85 |         />${RESET}`,
      `${YELLOW}⚠${RESET} Waiting for file changes before recompiling...`,
      `${CYAN}○${RESET} Compiling /test-pages/nested-suspense-stream ...`,
      `${GREEN}✓${RESET} Compiled /test-pages/nested-suspense-stream in 746ms`,
    ].join("\n"),
  },
];
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
  const text = firstValue(params?.text) ?? DEMOS[0].text;
  const delay = clampDelay(params?.delay);
  const lines = getSourceLines(text);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <NestedSuspenseStreamControls demos={DEMOS} initialText={text} initialDelay={delay} />
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

// app/test-pages/nested-suspense-stream/page.tsx
// Test page that streams 100 text lines with nested React Suspense boundaries.

import { Suspense } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LINE_COUNT = 100;
const GROUP_SIZE = 10;
const DEFAULT_DELAY_MS = 80;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampDelay(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue ?? DEFAULT_DELAY_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_DELAY_MS;
  return Math.max(0, Math.min(250, parsed));
}

function buildHref(delay: number): string {
  return `/test-pages/nested-suspense-stream?delay=${delay}`;
}

function getLineText(lineNumber: number): string {
  const phase = Math.ceil(lineNumber / GROUP_SIZE);
  const lineInPhase = ((lineNumber - 1) % GROUP_SIZE) + 1;
  return `Line ${String(lineNumber).padStart(3, "0")} streamed from nested Suspense group ${phase}, row ${lineInPhase}.`;
}

async function SuspenseLine({ lineNumber, delay }: { lineNumber: number; delay: number }) {
  await wait(lineNumber * delay);

  return (
    <div className="border-b border-gray-800 px-4 py-2.5 font-mono text-xs text-gray-200 last:border-b-0">
      <span className="mr-3 text-emerald-400">✓</span>
      {getLineText(lineNumber)}
    </div>
  );
}

function LineFallback({ lineNumber }: { lineNumber: number }) {
  return (
    <div className="border-b border-gray-800 px-4 py-2.5 font-mono text-xs text-gray-600 last:border-b-0">
      <span className="mr-3 inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
      Waiting for line {String(lineNumber).padStart(3, "0")}…
    </div>
  );
}

async function SuspenseLineGroup({
  groupIndex,
  delay,
}: {
  groupIndex: number;
  delay: number;
}) {
  await wait(groupIndex * Math.max(20, delay));

  const firstLine = groupIndex * GROUP_SIZE + 1;
  const lineNumbers = Array.from({ length: GROUP_SIZE }, (_, index) => firstLine + index).filter(
    (lineNumber) => lineNumber <= LINE_COUNT,
  );

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <div className="bg-gray-950 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Nested Suspense group {groupIndex + 1}
      </div>
      {lineNumbers.map((lineNumber) => (
        <Suspense key={lineNumber} fallback={<LineFallback lineNumber={lineNumber} />}>
          <SuspenseLine lineNumber={lineNumber} delay={delay} />
        </Suspense>
      ))}
    </div>
  );
}

function GroupFallback({ groupIndex }: { groupIndex: number }) {
  const firstLine = groupIndex * GROUP_SIZE + 1;
  const lineNumbers = Array.from({ length: GROUP_SIZE }, (_, index) => firstLine + index).filter(
    (lineNumber) => lineNumber <= LINE_COUNT,
  );

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <div className="bg-gray-950 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
        Preparing nested Suspense group {groupIndex + 1}…
      </div>
      {lineNumbers.map((lineNumber) => (
        <LineFallback key={lineNumber} lineNumber={lineNumber} />
      ))}
    </div>
  );
}

type PageProps = {
  searchParams?: Promise<{ delay?: string | string[] }>;
};

export default async function NestedSuspenseStreamPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const delay = clampDelay(params?.delay);
  const groupCount = Math.ceil(LINE_COUNT / GROUP_SIZE);

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <h1 className="mr-auto text-sm font-semibold text-gray-100">Nested Suspense Stream Test Page</h1>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Speed</span>
          {[20, 50, 80, 120, 180].map((value) => (
            <a
              key={value}
              href={buildHref(value)}
              className={`rounded border px-2 py-1 transition-colors ${
                delay === value
                  ? "border-violet-500 bg-violet-600 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
              }`}
            >
              {value}ms
            </a>
          ))}
        </div>

        <a
          href={buildHref(delay)}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-violet-500"
        >
          Restart
        </a>
      </header>

      <div className="flex items-center gap-3 border-b border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-gray-500">
        <span>
          Status: <span className="font-medium text-yellow-400">streaming HTML through Suspense…</span>
        </span>
        <span>
          Lines: <span className="font-mono text-gray-300">{LINE_COUNT}</span>
        </span>
        <span>
          Transport: <span className="font-mono text-gray-300">no SSE</span>
        </span>
      </div>

      <main className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="overflow-hidden rounded-lg border border-blue-700/50 bg-gray-900 text-sm">
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2.5">
            <span className="text-xs font-semibold text-blue-300">🤖 Streaming 100 Suspense-rendered lines…</span>
            <span className="ml-auto flex animate-pulse items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          </div>

          <div>
            {Array.from({ length: groupCount }, (_, groupIndex) => (
              <Suspense key={groupIndex} fallback={<GroupFallback groupIndex={groupIndex} />}>
                <SuspenseLineGroup groupIndex={groupIndex} delay={delay} />
              </Suspense>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

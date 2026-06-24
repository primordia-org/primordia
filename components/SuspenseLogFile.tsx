// components/SuspenseLogFile.tsx
// Server Component: streams appended log-file lines through a recursive Suspense tail.

import { watch } from "node:fs";
import { dirname, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { Suspense } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";

function EmptyLineFallback() {
  return <div className="h-5" aria-hidden="true" />;
}

async function readLogLines(logFilename: string): Promise<string[]> {
  try {
    const raw = await readFile(logFilename, "utf8");
    const normalized = raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const lines = normalized.split("\n");
    if (normalized.endsWith("\n")) lines.pop();
    return lines;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function readLine(logFilename: string, index: number): Promise<string | undefined> {
  const lines = await readLogLines(logFilename);
  return lines[index];
}

async function waitForLine(logFilename: string, index: number): Promise<void> {
  if ((await readLine(logFilename, index)) !== undefined) return;

  const watchedDir = dirname(logFilename);
  const watchedFile = basename(logFilename);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearInterval(interval);
      watcher.close();
    };

    const check = () => {
      readLine(logFilename, index)
        .then((line) => {
          if (settled || line === undefined) return;
          cleanup();
          resolve();
        })
        .catch((error: unknown) => {
          if (settled) return;
          cleanup();
          reject(error);
        });
    };

    const watcher = watch(watchedDir, (eventType, changedFilename) => {
      if (eventType !== "change" && eventType !== "rename") return;
      if (changedFilename && changedFilename.toString() !== watchedFile) return;
      check();
    });

    const interval = setInterval(check, 1000);
    interval.unref?.();
    check();
  });
}

async function SuspenseLogFileTail({
  logFilename,
  index,
}: {
  logFilename: string;
  index: number;
}) {
  await waitForLine(logFilename, index);
  const line = await readLine(logFilename, index);
  if (line === undefined) return null;

  return (
    <>
      <AnsiRenderer text={line} className="text-gray-400" />
      <Suspense fallback={<EmptyLineFallback />}>
        <SuspenseLogFileTail logFilename={logFilename} index={index + 1} />
      </Suspense>
    </>
  );
}

export function SuspenseLogFile({ logFilename }: { logFilename: string }) {
  return (
    <Suspense fallback={<EmptyLineFallback />}>
      <SuspenseLogFileTail logFilename={logFilename} index={0} />
    </Suspense>
  );
}

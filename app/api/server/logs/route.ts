// app/api/server/logs/route.ts
// Streams an evolve preview server log file as SSE.

import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { type NextRequest } from "next/server";
import * as fs from "fs";
import { getSessionFromFilesystem } from "@/lib/session-events";
import { getWorktreeLogPath } from "@/lib/process-manager";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

const INITIAL_TAIL_BYTES = 50 * 1024;
const encoder = new TextEncoder();

function sse(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function readTail(logPath: string): { exists: boolean; text: string; offset: number } {
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - INITIAL_TAIL_BYTES);
    const length = stat.size - start;
    if (length <= 0) return { exists: true, text: "", offset: stat.size };

    const fd = fs.openSync(logPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return { exists: true, text: buffer.toString("utf8"), offset: stat.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false, text: "", offset: 0 };
    }
    return { exists: true, text: "", offset: 0 };
  }
}

function readFromOffset(logPath: string, offset: number): { exists: boolean; text: string; offset: number } {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < offset) offset = 0;
    if (stat.size <= offset) return { exists: true, text: "", offset };

    const length = stat.size - offset;
    const fd = fs.openSync(logPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, offset);
      return { exists: true, text: buffer.toString("utf8"), offset: stat.size };
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false, text: "", offset: 0 };
    }
    return { exists: true, text: "", offset };
  }
}

/**
 * Stream evolve preview server logs
 * @description SSE stream of a thread preview server's `.primordia-next-server.log`. Pass `threadId` as the thread id; add `n=0` to skip the initial tail and only follow newly appended bytes. Emits a missing status while the log file does not exist yet.
 * @tag Server
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("threadId");
  if (!sessionId) return new Response("Missing thread id", { status: 400 });

  const session = getSessionFromFilesystem(sessionId, process.cwd());
  if (!session) return new Response("Thread not found", { status: 404 });

  let logPath: string;
  try {
    logPath = getWorktreeLogPath(session.branch, process.cwd());
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Log not found", { status: 404 });
  }

  const skipInitial = url.searchParams.get("n") === "0";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let offset = 0;
      let watcher: FSWatcher | null = null;
      let interval: NodeJS.Timeout | null = null;
      let lastExists: boolean | null = null;

      const enqueue = (data: unknown) => {
        if (closed) return;
        try { controller.enqueue(sse(data)); } catch { /* client disconnected */ }
      };

      const emitFileStatus = (exists: boolean) => {
        if (lastExists === exists) return;
        lastExists = exists;
        if (exists) {
          enqueue({ status: "ready" });
        } else {
          enqueue({
            status: "missing",
            message: `Preview server log file does not exist yet: ${logPath}`,
          });
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        watcher?.close();
        try { controller.close(); } catch { /* already closed */ }
      };

      const emitAppended = () => {
        if (closed) return;
        const next = readFromOffset(logPath, offset);
        emitFileStatus(next.exists);
        offset = next.offset;
        if (next.text) enqueue({ text: next.text });
      };

      if (skipInitial) {
        const initial = readTail(logPath);
        emitFileStatus(initial.exists);
        offset = initial.offset;
      } else {
        const initial = readTail(logPath);
        emitFileStatus(initial.exists);
        offset = initial.offset;
        if (initial.text) enqueue({ text: initial.text });
      }

      const watchedDir = dirname(logPath);
      const watchedFile = basename(logPath);
      try {
        watcher = watch(watchedDir, (_eventType, changedFilename) => {
          if (changedFilename && changedFilename.toString() !== watchedFile) return;
          emitAppended();
        });
      } catch {
        // The worktree directory may not exist yet; polling below still handles it.
      }

      interval = setInterval(emitAppended, 1000);
      interval.unref?.();
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

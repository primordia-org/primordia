// app/api/git/[...path]/route.ts
// Serves the Primordia git repository over HTTP (read-only) via git http-backend.
// Supports git clone, fetch, and pull. Push is permanently blocked.
//
// Clone URL: http[s]://<host>/api/git
//
// Internally the route proxies to the system `git http-backend` CGI process,
// forwarding request headers and body from stdin and parsing CGI headers from
// stdout before streaming the pack data back to the caller.
//
// Readonly enforcement:
//   • GET  /api/git/info/refs?service=git-receive-pack → 403
//   • POST /api/git/git-receive-pack                  → 403
//   All git-upload-pack operations (fetch/clone) are allowed.

import { execSync, spawn } from "child_process";
import { resolve } from "path";
import { type NextRequest } from "next/server";

// ─── Git dir resolution ────────────────────────────────────────────────────────

// Resolve the real git object store once at module load time.
// In a linked worktree, .git is a file; --git-common-dir gives the shared dir.
// Always returns an absolute path so git http-backend can find the repo
// regardless of its working directory.
function resolveGitDir(): string {
  try {
    const result = execSync("git rev-parse --git-common-dir", {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    return resolve(process.cwd(), result);
  } catch {
    return resolve(process.cwd(), ".git");
  }
}

const GIT_DIR = resolveGitDir();

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Find the byte offset of the \r\n\r\n CGI header/body separator. */
function findSeparator(buf: Buffer): number {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i;
    }
  }
  return -1;
}

/** Parse CGI response headers into a Headers object and HTTP status code. */
function parseCgiHeaders(raw: string): { status: number; headers: Headers } {
  const headers = new Headers();
  let status = 200;
  for (const line of raw.split("\r\n")) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") {
      status = parseInt(value, 10) || 200;
    } else {
      headers.set(name, value);
    }
  }
  return { status, headers };
}

/** True if the request targets a push (receive-pack) operation. */
function isPushRequest(pathInfo: string, service: string | null): boolean {
  const path = pathInfo.replace(/^\//, "");
  return path === "git-receive-pack" || service === "git-receive-pack";
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleGitRequest(req: NextRequest, pathInfo: string): Promise<Response> {
  const url = new URL(req.url);
  const service = url.searchParams.get("service");

  if (isPushRequest(pathInfo, service)) {
    return new Response("Forbidden: this repository is read-only", { status: 403 });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_DIR,
    GIT_HTTP_EXPORT_ALL: "1",
    // git http-backend requires PATH_TRANSLATED or GIT_PROJECT_ROOT (CGI interface).
    // We synthesise PATH_TRANSLATED by appending PATH_INFO to GIT_DIR; http-backend
    // strips the PATH_INFO suffix to derive the repo root (GIT_DIR itself).
    PATH_INFO: pathInfo,
    PATH_TRANSLATED: GIT_DIR + pathInfo,
    REQUEST_METHOD: req.method,
    QUERY_STRING: url.search.replace(/^\?/, ""),
    CONTENT_TYPE: req.headers.get("content-type") ?? "",
    CONTENT_LENGTH: req.headers.get("content-length") ?? "",
    HTTP_CONTENT_ENCODING: req.headers.get("content-encoding") ?? "",
    HTTP_GIT_PROTOCOL: req.headers.get("git-protocol") ?? "",
  };

  return new Promise<Response>((resolve) => {
    const proc = spawn("git", ["http-backend"], { env });

    // Pipe the request body into git http-backend's stdin.
    if (req.body) {
      req.body
        .pipeTo(
          new WritableStream({
            write(chunk) { proc.stdin.write(chunk); },
            close()      { proc.stdin.end(); },
            abort()      { proc.stdin.end(); },
          }),
        )
        .catch(() => proc.stdin.end());
    } else {
      proc.stdin.end();
    }

    // Buffer stdout until we have parsed the CGI headers, then stream the body.
    const headerChunks: Buffer[] = [];
    let resolved = false;

    // Body stream setup: controller is captured after construction.
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const bodyStream = new ReadableStream<Uint8Array>({
      start(ctrl) { bodyController = ctrl; },
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      if (resolved) {
        // Headers already parsed — forward body bytes directly.
        bodyController.enqueue(chunk);
        return;
      }

      headerChunks.push(chunk);
      const combined = Buffer.concat(headerChunks);
      const sep = findSeparator(combined);

      if (sep === -1) return; // Haven't seen the separator yet; keep buffering.

      resolved = true;
      const headerText = combined.slice(0, sep).toString("utf-8");
      const remaining = combined.slice(sep + 4); // bytes after \r\n\r\n

      const { status, headers } = parseCgiHeaders(headerText);

      if (remaining.length > 0) bodyController.enqueue(remaining);

      resolve(new Response(bodyStream, { status, headers }));
    });

    proc.stdout.on("end", () => {
      if (!resolved) {
        // git http-backend wrote nothing useful (e.g. repo not found).
        resolve(new Response("git http-backend produced no response", { status: 500 }));
        return;
      }
      bodyController.close();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      console.error("[git-http-backend]", chunk.toString().trimEnd());
    });

    proc.on("error", (err) => {
      console.error("[git-http-backend] spawn error:", err.message);
      if (!resolved) {
        resolve(new Response("Failed to start git http-backend", { status: 500 }));
      } else {
        bodyController.error(err);
      }
    });

    // Clean up if the client disconnects early.
    req.signal.addEventListener("abort", () => proc.kill());
  });
}

// ─── Route exports ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return handleGitRequest(req, "/" + path.join("/"));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  return handleGitRequest(req, "/" + path.join("/"));
}

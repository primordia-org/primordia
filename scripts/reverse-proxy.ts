// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// Listens on REVERSE_PROXY_PORT (default 3000) and forwards all traffic to
// the upstream port stored in git config as branch.{currentBranch}.port for
// the branch stored in git config as primordia.productionBranch.
//
// On startup, if the production Next.js server is not already running, the
// proxy spawns it automatically (bun run start in the production worktree).
// This makes the proxy the sole systemd service needed — no separate
// primordia.service required.
//
// Preview server management: the proxy owns the lifecycle of all preview dev
// servers. When a request arrives for /preview/{sessionId} and no server is
// running for that session, the proxy starts one lazily (bun run dev in the
// session's worktree), queuing the first request until it is ready. Preview
// servers are automatically stopped after 30 minutes of inactivity.
//
// Proxy management API (all under /_proxy/):
//   GET  /_proxy/preview/:id/status  — { devServerStatus }
//   POST /_proxy/preview/:id/restart — kill + restart
//   DELETE /_proxy/preview/:id       — kill
//   GET  /_proxy/preview/:id/logs    — SSE stream of server logs
//
// Session routing: requests to /preview/{sessionId}/... are routed to the
// port associated with that session. The mapping is derived from git config:
// each branch has branch.{name}.sessionId and branch.{name}.port entries,
// combined into a sessionId → port lookup table.
//
// This approach eliminates the need for proxy-upstream.json and
// proxy-previews.json entirely — the single source of truth is git config,
// which is updated atomically during blue/green accepts.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import { execFileSync, spawn, ChildProcess } from 'child_process';

// Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailers',
]);

function forwardHeaders(
  incoming: http.IncomingMessage,
  extra: Record<string, string>,
): http.OutgoingHttpHeaders {
  const raw = incoming.headers;
  const connVal = raw['connection'];
  const perConn = new Set(
    typeof connVal === 'string'
      ? connVal.split(',').map((s) => s.trim().toLowerCase())
      : [],
  );
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, val] of Object.entries(raw)) {
    const lc = key.toLowerCase();
    if (!HOP_BY_HOP.has(lc) && !perConn.has(lc)) {
      out[key] = val;
    }
  }
  const host = raw['host'];
  if (host && !out['x-forwarded-host']) {
    out['x-forwarded-host'] = host;
  }
  return { ...out, ...extra };
}

const LISTEN_PORT = parseInt(process.env.REVERSE_PROXY_PORT ?? '3000', 10);
const WORKTREES_DIR =
  process.env.PRIMORDIA_WORKTREES_DIR ?? '/home/exedev/primordia-worktrees';

/**
 * Discover the main git repo by inspecting any worktree in WORKTREES_DIR.
 * Falls back to process.cwd() (which is set to the main repo by the systemd
 * WorkingDirectory directive in primordia-proxy.service).
 */
function discoverMainRepo(): string {
  try {
    const entries = fs.readdirSync(WORKTREES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(WORKTREES_DIR, entry.name);
      try {
        const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd: candidate,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        // commonDir is an absolute path like /home/exedev/primordia/.git
        return path.dirname(path.resolve(candidate, commonDir));
      } catch {
        continue;
      }
    }
  } catch {
    // WORKTREES_DIR doesn't exist yet
  }
  return process.cwd();
}

/** Stable path to the main git repo — used as cwd for all git commands. */
const MAIN_REPO = discoverMainRepo();

let upstreamPort = 3001;
/** The branch name currently set as primordia.productionBranch. */
let currentProdBranch: string | null = null;
/** Cache of session ID → port for fast preview lookups. */
let sessionPortCache: Record<string, number> = {};
/** Cache of session ID → { worktreePath, port } for preview server spawning. */
let sessionWorktreeCache: Record<string, { worktreePath: string; port: number }> = {};
/** Path to the git config file being watched. */
let watchedConfigPath: string | null = null;

// ─── Preview server registry ─────────────────────────────────────────────────

/** Rolling log buffer size per preview server (50 KB). */
const MAX_LOG_BYTES = 50 * 1024;
/** Inactivity timeout before a preview server is stopped (30 minutes). */
const PREVIEW_INACTIVITY_MS = 30 * 60 * 1000;
/** How long to wait for a preview server to become ready before giving up (2 min). */
const PREVIEW_START_TIMEOUT_MS = 2 * 60 * 1000;

interface LogSubscriber {
  write: (text: string) => void;
  close: () => void;
}

interface StartWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

interface PreviewEntry {
  process: ChildProcess;
  port: number;
  worktreePath: string;
  logBuffer: string;
  lastActivityMs: number;
  status: 'starting' | 'running' | 'stopped';
  startWaiters: StartWaiter[];
  logSubscribers: Set<LogSubscriber>;
}

/** Active preview server processes keyed by session ID. */
const previewProcesses = new Map<string, PreviewEntry>();

/**
 * Returns the path to the shared git config file for the repo.
 * Works whether cwd is the main repo or a worktree.
 */
function findGitConfigPath(cwd: string): string | null {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.resolve(cwd, commonDir, 'config');
  } catch {
    return null;
  }
}

/**
 * Re-reads all branch ports from git config and updates the caches.
 * Also updates the upstream port based on the current production branch,
 * and rebuilds sessionWorktreeCache for preview server spawning.
 */
function readAllPorts(): void {
  // Start watching the git config file if not already doing so.
  if (!watchedConfigPath) {
    const cfgPath = findGitConfigPath(MAIN_REPO);
    if (cfgPath) {
      watchedConfigPath = cfgPath;
      watchGitConfig(cfgPath);
    }
  }

  const branchPort: Record<string, number> = {};
  const branchSessionId: Record<string, string> = {};
  try {
    // Build branch → port map from git config.
    const portOut = execFileSync('git', ['config', '--get-regexp', 'branch\\..*\\.port'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of portOut.trim().split('\n')) {
      if (!line) continue;
      const m = line.match(/^branch\.(.+)\.port\s+(\d+)$/);
      if (m) branchPort[m[1]] = parseInt(m[2], 10);
    }

    // Build branch → sessionId map, then combine into sessionId → port.
    const sessionOut = execFileSync('git', ['config', '--get-regexp', 'branch\\..*\\.sessionid'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const cache: Record<string, number> = {};
    for (const line of sessionOut.trim().split('\n')) {
      if (!line) continue;
      const m = line.match(/^branch\.(.+)\.sessionid\s+(\S+)$/);
      if (m) {
        branchSessionId[m[1]] = m[2];
        const port = branchPort[m[1]];
        if (port) cache[m[2]] = port;
      }
    }
    sessionPortCache = cache;
  } catch {
    // git config --get-regexp exits non-zero when no keys match — normal on first run
  }

  // Build branch → worktreePath from git worktree list.
  const branchWorktree: Record<string, string> = {};
  try {
    const wtOut = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let curPath: string | undefined;
    for (const line of wtOut.split('\n')) {
      if (line.startsWith('worktree ')) {
        curPath = line.slice(9).trim();
      } else if (line.startsWith('branch ') && curPath) {
        const branch = line.slice(7).trim().replace('refs/heads/', '');
        branchWorktree[branch] = curPath;
      }
    }
  } catch {
    // git worktree list failed
  }

  // Combine: sessionId → { worktreePath, port }
  const newWorktreeCache: Record<string, { worktreePath: string; port: number }> = {};
  for (const [branch, sessionId] of Object.entries(branchSessionId)) {
    const port = branchPort[branch];
    const worktreePath = branchWorktree[branch];
    if (port && worktreePath) {
      newWorktreeCache[sessionId] = { worktreePath, port };
    }
  }
  sessionWorktreeCache = newWorktreeCache;

  // Determine production branch from git config primordia.productionBranch (set on
  // each accept), falling back to HEAD of the current worktree (initial bootstrap
  // before the first accept or on deployments not yet migrated to git config).
  let prodBranch: string | null = null;
  try {
    const ref = execFileSync('git', ['config', '--get', 'primordia.productionBranch'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (ref) prodBranch = ref;
  } catch {
    // primordia.productionBranch not yet set — fall through to HEAD fallback
  }
  if (!prodBranch) {
    try {
      prodBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: MAIN_REPO,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null;
    } catch {
      // Detached HEAD — keep current upstream port
    }
  }
  if (prodBranch) {
    currentProdBranch = prodBranch;
    const port = branchPort[prodBranch];
    if (port && port !== upstreamPort) {
      console.log(`[proxy] upstream port: ${upstreamPort} → ${port} (PROD branch: ${prodBranch})`);
      upstreamPort = port;
    }
  }
}

function watchGitConfig(configPath: string): void {
  try {
    fs.watch(configPath, () => setTimeout(readAllPorts, 50));
  } catch {
    setTimeout(() => watchGitConfig(configPath), 1000);
  }
}

// ─── Preview server management ───────────────────────────────────────────────

/**
 * Spawns `bun run dev` in the session's worktree and tracks the process.
 * Incoming requests are queued in entry.startWaiters until 'Ready' is detected.
 */
function startPreviewServer(
  sessionId: string,
  info: { worktreePath: string; port: number },
): PreviewEntry {
  const entry: PreviewEntry = {
    process: null as unknown as ChildProcess, // assigned below
    port: info.port,
    worktreePath: info.worktreePath,
    logBuffer: '',
    lastActivityMs: Date.now(),
    status: 'starting',
    startWaiters: [],
    logSubscribers: new Set(),
  };
  previewProcesses.set(sessionId, entry);

  console.log(`[proxy] starting preview server for session ${sessionId} on :${info.port} in ${info.worktreePath}`);

  const proc = spawn('bun', ['run', 'dev'], {
    cwd: info.worktreePath,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(info.port),
      HOSTNAME: '0.0.0.0',
      NEXT_BASE_PATH: `/preview/${sessionId}`,
      REVERSE_PROXY_PORT: String(LISTEN_PORT),
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.unref();
  entry.process = proc;

  const appendLog = (text: string) => {
    entry.logBuffer += text;
    if (entry.logBuffer.length > MAX_LOG_BYTES) {
      entry.logBuffer = entry.logBuffer.slice(entry.logBuffer.length - MAX_LOG_BYTES);
    }
    for (const sub of entry.logSubscribers) {
      sub.write(text);
    }
    if (entry.status === 'starting' && text.includes('Ready')) {
      entry.status = 'running';
      console.log(`[proxy] preview server ready for session ${sessionId} on :${info.port}`);
      const waiters = entry.startWaiters.splice(0);
      for (const w of waiters) w.resolve();
    }
  };

  proc.stdout?.on('data', (d: Buffer) => appendLog(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => appendLog(d.toString()));

  proc.on('close', (code) => {
    if (entry.status === 'starting') {
      const err = new Error(`Preview server exited before becoming ready (code ${code ?? 'unknown'})`);
      const waiters = entry.startWaiters.splice(0);
      for (const w of waiters) w.reject(err);
    }
    entry.status = 'stopped';
    previewProcesses.delete(sessionId);
    console.log(`[proxy] preview server stopped for session ${sessionId} (code ${code ?? 'unknown'})`);
    for (const sub of entry.logSubscribers) sub.close();
    entry.logSubscribers.clear();
  });

  proc.on('error', (err) => {
    appendLog(`[proxy error] ${err.message}\n`);
    if (entry.status === 'starting') {
      entry.status = 'stopped';
      const spawnErr = new Error(`Preview server spawn failed: ${err.message}`);
      const waiters = entry.startWaiters.splice(0);
      for (const w of waiters) w.reject(spawnErr);
    }
  });

  return entry;
}

/**
 * Kills the preview server for the given session, if running.
 */
function stopPreviewServer(sessionId: string): void {
  const entry = previewProcesses.get(sessionId);
  if (!entry || entry.status === 'stopped') return;
  console.log(`[proxy] stopping preview server for session ${sessionId}`);
  entry.status = 'stopped';
  previewProcesses.delete(sessionId);
  try {
    if (entry.process.pid !== undefined) {
      process.kill(-entry.process.pid, 'SIGTERM');
    }
  } catch {
    try { entry.process.kill('SIGTERM'); } catch { /* already dead */ }
  }
}

// Kill preview servers that have been inactive for 30 minutes.
setInterval(() => {
  const cutoff = Date.now() - PREVIEW_INACTIVITY_MS;
  for (const [sessionId, entry] of previewProcesses.entries()) {
    if (entry.lastActivityMs < cutoff) {
      console.log(`[proxy] stopping idle preview server ${sessionId} (30 min inactivity)`);
      stopPreviewServer(sessionId);
    }
  }
}, 60_000).unref();

// ─── Production server ────────────────────────────────────────────────────────

/**
 * On startup, if the production Next.js server is not already running on the
 * upstream port, find the production worktree and spawn `bun run start` there.
 * This makes the proxy responsible for the production server lifecycle so no
 * separate primordia.service systemd unit is needed.
 */
async function startProdServerIfNeeded(): Promise<void> {
  if (!currentProdBranch || !upstreamPort) return;

  // Check if the production server is already running.
  try {
    await fetch(`http://localhost:${upstreamPort}/`, {
      signal: AbortSignal.timeout(2_000),
      redirect: 'manual',
    });
    console.log(`[proxy] production server already running on :${upstreamPort}`);
    return;
  } catch {
    // Not running — need to start it.
  }

  // Find the worktree checked out on the production branch.
  let prodPath: string | null = null;
  try {
    const wtOut = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let curPath: string | undefined;
    let curBranch: string | null = null;
    for (const line of wtOut.split('\n')) {
      if (line.startsWith('worktree ')) { curPath = line.slice(9); curBranch = null; }
      else if (line.startsWith('branch ')) { curBranch = line.slice(7).replace('refs/heads/', ''); }
      else if (line === '' && curPath && curBranch === currentProdBranch) { prodPath = curPath; break; }
    }
    // Handle last entry (no trailing blank line)
    if (!prodPath && curPath && curBranch === currentProdBranch) prodPath = curPath;
  } catch {
    // git not available
  }

  if (!prodPath) {
    console.warn(`[proxy] cannot start prod server: no worktree for branch '${currentProdBranch}'`);
    return;
  }

  console.log(`[proxy] starting production server (${currentProdBranch}) on :${upstreamPort} in ${prodPath}`);
  const server = spawn('bun', ['run', 'start'], {
    cwd: prodPath,
    env: { ...process.env, PORT: String(upstreamPort), HOSTNAME: '0.0.0.0' },
    stdio: 'ignore',
    detached: true,
  });
  server.unref();
}

readAllPorts();
// Start production server on boot if not already running.
void startProdServerIfNeeded();

// Safety-net poll every 5 s in case fs.watch misses an event
setInterval(readAllPorts, 5000);

// ─── Request forwarding ───────────────────────────────────────────────────────

/**
 * Forwards a request to the given port, optionally using a pre-buffered body
 * instead of piping from clientReq.
 */
function forwardToPort(
  port: number,
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  bodyBuffer?: Buffer,
): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port,
    path: clientReq.url,
    method: clientReq.method,
    headers: forwardHeaders(clientReq, {
      'x-forwarded-for': clientReq.socket.remoteAddress ?? '',
      'x-forwarded-proto': 'http',
    }),
  };

  const upstreamReq = http.request(options, (upstreamRes) => {
    clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(clientRes);
  });

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] upstream error on port ${port}:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end('Bad Gateway — upstream server unavailable\n');
    }
  });

  if (bodyBuffer !== undefined) {
    if (bodyBuffer.length > 0) upstreamReq.write(bodyBuffer);
    upstreamReq.end();
  } else {
    clientReq.pipe(upstreamReq);
  }
}

// ─── Preview request handler (auto-start + queue) ────────────────────────────

/**
 * Handles a request for /preview/{sessionId}/... with auto-start.
 * If the preview server is not running, starts it and queues the request
 * until it is ready (up to PREVIEW_START_TIMEOUT_MS).
 */
async function handlePreviewRequest(
  sessionId: string,
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  let entry = previewProcesses.get(sessionId);

  // Update activity timestamp on every request to this preview.
  if (entry) entry.lastActivityMs = Date.now();

  if (entry?.status === 'running') {
    forwardToPort(entry.port, clientReq, clientRes);
    return;
  }

  if (!entry || entry.status === 'stopped') {
    // Try to look up the session's worktree info.
    let info = sessionWorktreeCache[sessionId];
    if (!info) {
      // Cache may be stale — force a refresh and retry.
      readAllPorts();
      info = sessionWorktreeCache[sessionId];
    }
    if (!info) {
      // Unknown session — forward to upstream (will produce a useful 404 from Next.js)
      forwardToPort(upstreamPort, clientReq, clientRes);
      return;
    }
    entry = startPreviewServer(sessionId, info);
  }

  // Server is 'starting' — buffer the request body and wait.
  const chunks: Buffer[] = [];
  for await (const chunk of clientReq as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const bodyBuffer = Buffer.concat(chunks);

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
        clientRes.end(
          '<html><head><title>Preview Starting</title></head><body>' +
          '<h2>Preview server is starting…</h2>' +
          '<p>Please wait a moment and refresh.</p>' +
          '</body></html>',
        );
      }
      resolve();
    }, PREVIEW_START_TIMEOUT_MS);

    entry!.startWaiters.push({
      resolve: () => {
        clearTimeout(timeoutId);
        if (entry) entry.lastActivityMs = Date.now();
        forwardToPort(entry!.port, clientReq, clientRes, bodyBuffer);
        resolve();
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        if (!clientRes.headersSent) {
          clientRes.writeHead(503, { 'content-type': 'text/plain' });
          clientRes.end(`Preview server failed to start: ${err.message}\n`);
        }
        resolve();
      },
    });
  });
}

// ─── Proxy management API ─────────────────────────────────────────────────────

/**
 * Handles requests to /_proxy/preview/:sessionId/:action.
 *
 * GET  /_proxy/preview/:id/status  — JSON { devServerStatus }
 * POST /_proxy/preview/:id/restart — kill existing + start new
 * DELETE /_proxy/preview/:id       — kill (used during accept/reject)
 * GET  /_proxy/preview/:id/logs    — SSE stream of server logs
 */
function handleProxyApi(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): void {
  const url = clientReq.url ?? '';

  // POST /_proxy/refresh — force-read primordia.productionBranch and all branch ports immediately.
  // Called by the production server after an accept to guarantee the proxy picks
  // up the new production branch even if the fs.watch inotify event was missed.
  if (url === '/_proxy/refresh' && clientReq.method === 'POST') {
    readAllPorts();
    clientRes.writeHead(200, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({ ok: true }));
    return;
  }

  const match = url.match(/^\/_proxy\/preview\/([^/?#]+)(?:\/([^/?#]*))?/);
  if (!match) {
    clientRes.writeHead(404, { 'content-type': 'text/plain' });
    clientRes.end('Not Found');
    return;
  }

  const sessionId = match[1];
  const action = match[2] ?? '';

  // GET /_proxy/preview/:id/status
  if (action === 'status' && clientReq.method === 'GET') {
    const entry = previewProcesses.get(sessionId);
    clientRes.writeHead(200, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({ devServerStatus: entry?.status ?? 'stopped' }));
    return;
  }

  // POST /_proxy/preview/:id/restart
  if (action === 'restart' && clientReq.method === 'POST') {
    stopPreviewServer(sessionId);
    const info = sessionWorktreeCache[sessionId] ?? (() => { readAllPorts(); return sessionWorktreeCache[sessionId]; })();
    if (!info) {
      clientRes.writeHead(404, { 'content-type': 'application/json' });
      clientRes.end(JSON.stringify({ error: 'Session worktree not found in cache' }));
      return;
    }
    startPreviewServer(sessionId, info);
    clientRes.writeHead(200, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({ ok: true }));
    return;
  }

  // DELETE /_proxy/preview/:id  (kill)
  if ((action === '' || action === 'kill') && clientReq.method === 'DELETE') {
    stopPreviewServer(sessionId);
    clientRes.writeHead(200, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /_proxy/preview/:id/logs  (SSE stream)
  if (action === 'logs' && clientReq.method === 'GET') {
    clientRes.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });

    const entry = previewProcesses.get(sessionId);

    // Send current log buffer as the first event.
    if (entry?.logBuffer) {
      clientRes.write(`data: ${JSON.stringify({ text: entry.logBuffer, snapshot: true })}\n\n`);
    }

    if (!entry || entry.status === 'stopped') {
      clientRes.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      clientRes.end();
      return;
    }

    // Subscribe to future log lines.
    const subscriber: LogSubscriber = {
      write: (text) => {
        if (!clientRes.writableEnded) {
          clientRes.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      },
      close: () => {
        if (!clientRes.writableEnded) {
          clientRes.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          clientRes.end();
        }
      },
    };
    entry.logSubscribers.add(subscriber);
    clientReq.on('close', () => {
      entry.logSubscribers.delete(subscriber);
    });
    return;
  }

  clientRes.writeHead(404, { 'content-type': 'text/plain' });
  clientRes.end('Not Found');
}

// ─── Routing ──────────────────────────────────────────────────────────────────

/**
 * Resolves the target port for a non-preview request.
 */
function resolveUpstreamPort(): number {
  return upstreamPort;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function handleRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  const url = clientReq.url ?? '/';

  // Proxy management API
  if (url.startsWith('/_proxy/')) {
    handleProxyApi(clientReq, clientRes);
    return;
  }

  // Preview routing with auto-start
  const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
  if (previewMatch) {
    await handlePreviewRequest(previewMatch[1], clientReq, clientRes);
    return;
  }

  // Default: forward to production upstream
  forwardToPort(resolveUpstreamPort(), clientReq, clientRes);
}

const server = http.createServer((clientReq, clientRes) => {
  void handleRequest(clientReq, clientRes);
});

server.on('upgrade', (clientReq: http.IncomingMessage, clientSocket: stream.Duplex, head: Buffer) => {
  clientSocket.on('error', (err) => {
    console.error(`[proxy] client socket error during WS upgrade:`, err.message);
  });

  const url = clientReq.url ?? '/';

  // Update activity for preview WebSocket connections (HMR).
  const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
  if (previewMatch) {
    const entry = previewProcesses.get(previewMatch[1]);
    if (entry) entry.lastActivityMs = Date.now();
  }

  // Determine target port.
  let targetPort = upstreamPort;
  if (previewMatch) {
    const cached = sessionPortCache[previewMatch[1]];
    if (cached) targetPort = cached;
  }

  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'x-forwarded-for': clientReq.socket.remoteAddress ?? '',
      'x-forwarded-proto': 'http',
    },
  };

  const upstreamReq = http.request(options);

  upstreamReq.on('upgrade', (upstreamRes: http.IncomingMessage, upstreamSocket: stream.Duplex, upstreamHead: Buffer) => {
    let responseHead = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, val] of Object.entries(upstreamRes.headers)) {
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) responseHead += `${key}: ${v}\r\n`;
    }
    responseHead += '\r\n';
    clientSocket.write(responseHead);

    // upstreamHead contains data from the upstream socket buffered after the 101
    // response headers — put it back on the upstream socket's readable side so
    // it flows through upstreamSocket.pipe(clientSocket) to the browser.
    // head contains data from the client socket buffered after the HTTP upgrade
    // request headers — put it back on the client socket's readable side so it
    // flows through clientSocket.pipe(upstreamSocket) to the dev server.
    if (upstreamHead && upstreamHead.length > 0) upstreamSocket.unshift(upstreamHead);
    if (head && head.length > 0) clientSocket.unshift(head);

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);

    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => clientSocket.destroy());
  });

  // If the upstream responds with a non-101 (e.g. 400 or 404), the 'upgrade'
  // event never fires. Without a 'response' handler the client socket would
  // hang open indefinitely, so we send a 502 and close it.
  upstreamReq.on('response', (upstreamRes) => {
    console.error(`[proxy] WS upstream on port ${targetPort} returned HTTP ${upstreamRes.statusCode ?? 'unknown'} instead of 101`);
    upstreamRes.resume(); // drain so Node.js can reuse the connection
    if (!clientSocket.destroyed) {
      clientSocket.write(
        `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n` +
        `WebSocket upstream did not upgrade (status ${upstreamRes.statusCode ?? 'unknown'})\n`,
      );
      clientSocket.destroy();
    }
  });

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] WS upstream error on port ${targetPort}:`, err.message);
    clientSocket.destroy();
  });

  upstreamReq.end();
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(
    `[proxy] listening on :${LISTEN_PORT} → upstream :${upstreamPort} (git config)`,
  );
  console.log(`[proxy] main repo: ${MAIN_REPO}`);
  console.log(`[proxy] worktrees: ${WORKTREES_DIR}`);
});

process.on('SIGTERM', () => {
  // Stop all preview servers before exiting.
  for (const sessionId of previewProcesses.keys()) {
    stopPreviewServer(sessionId);
  }
  server.close(() => process.exit(0));
});

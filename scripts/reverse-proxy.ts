// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// Listens on REVERSE_PROXY_PORT (default 3000) and forwards all traffic to
// the upstream port stored in git config as branch.{currentBranch}.port for
// the branch stored in git config as primordia.productionBranch.
//
// On startup and on demand, if the production Next.js server is not already
// running, the proxy asks lib/process-manager.ts to start it as a detached
// process. The proxy itself owns no app server child processes.
//
// Preview server management: the proxy routes preview traffic and delegates
// dev-server start/stop/log handling to lib/process-manager.ts. When a request
// arrives for /preview/{sessionId} and no server is running for that session,
// the proxy starts one lazily, queuing the first request until it is ready.
// Preview servers are automatically stopped after 30 minutes of inactivity,
// except entries matching the current production branch/port are never stopped
// by the preview idle sweeper.
//
// Session routing: requests to /preview/{branchName}/... are routed to the
// port associated with that branch. The mapping is derived from git config:
// each branch has a branch.{name}.port entry. Branches with slashes in their
// name are not supported for preview routing.
//
// This approach eliminates the need for proxy-upstream.json and
// proxy-previews.json entirely — the single source of truth is git config,
// which is updated atomically during blue/green accepts.

import * as http from 'http';
import * as net from 'net';
import {
  getProxyRoutingState,
  startWorktreeServer,
  stopWorktreeServer,
  watchGitConfig,
} from '@/lib/process-manager';
import { getPrimordiaRuntimePaths } from '@/lib/git-runtime';
import { runScheduledJobs } from '@/lib/scheduled-jobs';

// Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailers',
]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logCrashBoundary(label: string, err: unknown): void {
  console.error(`[proxy] ${label}:`, errorMessage(err));
}

function safeEnd(res: http.ServerResponse, data?: string | Buffer): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.end(data);
  } catch (err) {
    logCrashBoundary('response end failed', err);
    try { res.destroy(err instanceof Error ? err : undefined); } catch { /* already closed */ }
  }
}

function safeWriteHead(
  res: http.ServerResponse,
  statusCode: number,
  headers?: http.OutgoingHttpHeaders,
): boolean {
  if (res.headersSent || res.writableEnded || res.destroyed) return false;
  try {
    res.writeHead(statusCode, headers);
    return true;
  } catch (err) {
    logCrashBoundary('response writeHead failed', err);
    try { res.destroy(err instanceof Error ? err : undefined); } catch { /* already closed */ }
    return false;
  }
}

function sendPlainError(res: http.ServerResponse, statusCode: number, message: string): void {
  if (safeWriteHead(res, statusCode, { 'content-type': 'text/plain' })) {
    safeEnd(res, `${message}\n`);
  }
}

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

/**
 * Derives the public-facing port from an incoming request's x-forwarded
 * headers, falling back to the Host header port, then to the protocol default.
 *
 * Chain of preference:
 *   1. x-forwarded-port  (set by an upstream proxy like exe.dev)
 *   2. port in x-forwarded-host  (e.g. "myhost:8080")
 *   3. port in Host header
 *   4. 443 for https, 80 for http
 */
function derivePublicPort(incoming: http.IncomingMessage): string {
  const fwdPort = incoming.headers['x-forwarded-port'];
  if (typeof fwdPort === 'string' && fwdPort) return fwdPort;

  const fwdHost = incoming.headers['x-forwarded-host'];
  if (typeof fwdHost === 'string') {
    const colonIdx = fwdHost.lastIndexOf(':');
    if (colonIdx !== -1) return fwdHost.slice(colonIdx + 1);
  }

  const host = incoming.headers['host'];
  if (typeof host === 'string') {
    const colonIdx = host.lastIndexOf(':');
    if (colonIdx !== -1) return host.slice(colonIdx + 1);
  }

  const proto = typeof incoming.headers['x-forwarded-proto'] === 'string'
    ? incoming.headers['x-forwarded-proto']
    : 'http';
  return proto === 'https' ? '443' : '80';
}

const LISTEN_PORT = parseInt(process.env.REVERSE_PROXY_PORT ?? '3000', 10);

const PRIMORDIA_PATHS = getPrimordiaRuntimePaths();
const PRIMORDIA_ROOT = PRIMORDIA_PATHS.root;
const WORKTREES_DIR = PRIMORDIA_PATHS.worktreesDir;
const MAIN_REPO = PRIMORDIA_PATHS.mainRepo;

let upstreamPort = 3001;
/** The branch name currently set as primordia.productionBranch. */
let currentProdBranch: string | null = null;
/** Cache of branch name → port for fast preview lookups. */
let sessionPortCache: Record<string, number> = {};
/** Cache of branch name → { worktreePath, port } for preview server spawning. */
let sessionWorktreeCache: Record<string, { worktreePath: string; port: number }> = {};
/** Path to the git config file being watched. */
let watchedConfigPath: string | null = null;
// ─── Managed app server registry configuration ───────────────────────────────
/** Inactivity timeout in minutes before a preview server is stopped (configurable via git config primordia.previewInactivityMin). */
let previewInactivityMin = 30;
/** How long to wait for a server to become ready before giving up (2 min). */
const PREVIEW_START_TIMEOUT_MS = 2 * 60 * 1000;
/** Maximum request header bytes buffered by the raw TCP classifier before HTTP parsing. */
const MAX_REQUEST_HEADER_BYTES = 64 * 1024;
/** Timeout for clients to finish sending request headers to the raw TCP classifier. */
const REQUEST_HEADER_TIMEOUT_MS = 30_000;
/** Maximum JSON/body bytes read by proxy management endpoints before forwarding. */
const MAX_PROXY_BODY_BYTES = 1024 * 1024;

interface StartWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Re-reads process-manager routing state and updates the proxy caches.
 */
function readAllPorts(): void {
  const state = getProxyRoutingState(MAIN_REPO, LISTEN_PORT);
  if (!watchedConfigPath) {
    watchedConfigPath = watchGitConfig(MAIN_REPO, () => {
      try { readAllPorts(); } catch (err) { logCrashBoundary('git config reload failed', err); }
    });
  }

  sessionPortCache = Object.fromEntries(
    [...state.branchPorts].filter(([branch]) => !branch.includes('/')),
  );
  sessionWorktreeCache = state.previewTargets;

  if (state.productionBranch && state.upstreamPort) {
    const prevProdBranch = currentProdBranch;
    currentProdBranch = state.productionBranch;
    const portChanged = state.upstreamPort !== upstreamPort;
    if (portChanged) {
      console.log(`[proxy] upstream port: ${upstreamPort} → ${state.upstreamPort} (PROD branch: ${state.productionBranch})`);
      upstreamPort = state.upstreamPort;
    }
    if (portChanged || state.productionBranch !== prevProdBranch) {
      setTimeout(() => {
        startProdServerIfNeeded().catch((err) => logCrashBoundary('startProdServerIfNeeded failed after config reload', err));
      }, 0);
    }
  }

  if (state.previewInactivityMin) previewInactivityMin = state.previewInactivityMin;

  for (const [sessionId, entry] of previewProcesses.entries()) {
    if (isProductionTarget(sessionId, entry.port)) {
      console.warn(`[proxy] evicting preview registry entry for production branch ${sessionId} on :${entry.port}`);
      entry.status = 'stopped';
      previewProcesses.delete(sessionId);
    }
  }

}

// ─── Managed app server registry ──────────────────────────────────────────────

type ManagedServerKind = 'preview' | 'production';

type ManagedServerMode = 'dev' | 'prod';

interface ManagedServerEntry {
  id: string;
  kind: ManagedServerKind;
  mode: ManagedServerMode;
  port: number;
  worktreePath?: string;
  lastActivityMs: number;
  status: 'starting' | 'running' | 'stopped';
  startWaiters: StartWaiter[];
  startPromise: Promise<void> | null;
}

/** Active preview server processes keyed by session ID. */
const previewProcesses = new Map<string, ManagedServerEntry>();
let prodEntry: ManagedServerEntry | null = null;

function serverLabel(entry: ManagedServerEntry): string {
  return entry.kind === 'production' ? 'production' : `preview ${entry.id}`;
}

function getProdEntry(): ManagedServerEntry | null {
  if (!currentProdBranch || !upstreamPort) return null;
  if (!prodEntry || prodEntry.id !== currentProdBranch || prodEntry.port !== upstreamPort) {
    prodEntry = {
      id: currentProdBranch,
      kind: 'production',
      mode: 'prod',
      port: upstreamPort,
      lastActivityMs: Date.now(),
      status: 'stopped',
      startWaiters: [],
      startPromise: null,
    };
  }
  return prodEntry;
}

async function isPortReady(port: number, timeoutMs = 2_000): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    return true;
  } catch {
    return false;
  }
}

function settleStartWaiters(entry: ManagedServerEntry, err?: Error): void {
  const waiters = entry.startWaiters.splice(0);
  for (const waiter of waiters) {
    try {
      if (err) waiter.reject(err);
      else waiter.resolve();
    } catch (waiterErr) {
      logCrashBoundary(`${serverLabel(entry)} start waiter failed`, waiterErr);
    }
  }
}

async function waitForServerReady(entry: ManagedServerEntry): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= PREVIEW_START_TIMEOUT_MS) {
    if (await isPortReady(entry.port)) {
      entry.status = 'running';
      console.log(`[proxy] ${serverLabel(entry)} server ready on :${entry.port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  entry.status = 'stopped';
  throw new Error(`${serverLabel(entry)} server did not become ready before timeout`);
}

function isProductionTarget(branch: string, port: number): boolean {
  return Boolean(currentProdBranch && branch === currentProdBranch) || Boolean(upstreamPort && port === upstreamPort);
}

async function startManagedServer(entry: ManagedServerEntry): Promise<void> {
  if (entry.startPromise) return entry.startPromise;

  entry.startPromise = (async () => {
    if (await isPortReady(entry.port, 750)) {
      entry.status = 'running';
      console.log(`[proxy] ${serverLabel(entry)} server already running on :${entry.port}`);
      settleStartWaiters(entry);
      return;
    }

    entry.status = 'starting';
    console.log(`[proxy] asking process-manager to start ${serverLabel(entry)} server (${entry.id}) on :${entry.port}`);
    try {
      const previousProxyPort = process.env.REVERSE_PROXY_PORT;
      if (entry.kind === 'preview') process.env.REVERSE_PROXY_PORT = String(LISTEN_PORT);
      try {
        const result = await startWorktreeServer(entry.id, entry.mode, MAIN_REPO);
        console.log(`[proxy] ${result.message}`);
      } finally {
        if (entry.kind === 'preview') {
          if (previousProxyPort === undefined) delete process.env.REVERSE_PROXY_PORT;
          else process.env.REVERSE_PROXY_PORT = previousProxyPort;
        }
      }
      await waitForServerReady(entry);
      settleStartWaiters(entry);
    } catch (err) {
      const startErr = new Error(`${serverLabel(entry)} server failed to start: ${errorMessage(err)}`);
      entry.status = 'stopped';
      console.error(`[proxy] ${startErr.message}`);
      settleStartWaiters(entry, startErr);
      throw startErr;
    }
  })().finally(() => {
    entry.startPromise = null;
  });

  return entry.startPromise;
}

function stopPreviewServer(sessionId: string): void {
  const entry = previewProcesses.get(sessionId);
  if (!entry || entry.status === 'stopped') return;
  if (isProductionTarget(sessionId, entry.port)) {
    console.warn(`[proxy] refusing to stop preview ${sessionId}: it matches the current production target on :${entry.port}`);
    entry.status = 'stopped';
    previewProcesses.delete(sessionId);
    return;
  }
  console.log(`[proxy] stopping ${serverLabel(entry)} server`);
  entry.status = 'stopped';
  previewProcesses.delete(sessionId);
  void stopWorktreeServer(sessionId, MAIN_REPO).catch((err) => {
    logCrashBoundary(`process-manager stop failed for preview ${sessionId}`, err);
  });
}

// Kill preview servers that have been inactive for previewInactivityMin minutes.
// Also evict stopped entries (kept for crash-log access) after the same timeout.
setInterval(() => {
  const cutoff = Date.now() - previewInactivityMin * 60 * 1000;
  for (const [sessionId, entry] of previewProcesses.entries()) {
    if (entry.lastActivityMs < cutoff) {
      if (entry.status === 'stopped') {
        previewProcesses.delete(sessionId);
      } else if (isProductionTarget(sessionId, entry.port)) {
        console.warn(`[proxy] idle preview cleanup skipped ${sessionId}: it matches production on :${entry.port}`);
        entry.status = 'stopped';
        previewProcesses.delete(sessionId);
      } else {
        console.log(`[proxy] stopping idle preview server ${sessionId} (${previewInactivityMin} min inactivity)`);
        stopPreviewServer(sessionId);
      }
    }
  }
}, 60_000).unref();

/**
 * On startup, if the production Next.js server is not already running on the
 * upstream port, find the production worktree and spawn `bun run start` there.
 * This makes the proxy responsible for the production server lifecycle so no
 * separate primordia.service systemd unit is needed.
 */
async function startProdServerIfNeeded(): Promise<void> {
  const entry = getProdEntry();
  if (!entry) return;
  return startManagedServer(entry);
}

try {
  readAllPorts();
} catch (err) {
  logCrashBoundary('initial git config load failed', err);
}
// Start production server on boot if not already running.
startProdServerIfNeeded().catch((err) => logCrashBoundary('initial production server start failed', err));

// Safety-net poll every 5 s in case fs.watch misses an event
setInterval(() => {
  try { readAllPorts(); } catch (err) { logCrashBoundary('periodic git config reload failed', err); }
}, 5000);

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
      'x-forwarded-proto': (typeof clientReq.headers['x-forwarded-proto'] === 'string'
        ? clientReq.headers['x-forwarded-proto']
        : 'http'),
      'x-forwarded-port': derivePublicPort(clientReq),
    }),
  };

  let upstreamReq: http.ClientRequest;
  try {
    upstreamReq = http.request(options, (upstreamRes) => {
      try {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      } catch (err) {
        logCrashBoundary(`forward response setup failed on port ${port}`, err);
        upstreamRes.destroy(err instanceof Error ? err : undefined);
        try { clientRes.destroy(err instanceof Error ? err : undefined); } catch { /* already closed */ }
      }
      upstreamRes.on('error', (err) => {
        logCrashBoundary(`upstream response error on port ${port}`, err);
        try { clientRes.destroy(err); } catch { /* already closed */ }
      });
    });
  } catch (err) {
    console.error(`[proxy] could not create upstream request on port ${port}:`, errorMessage(err));
    sendPlainError(clientRes, 502, 'Bad Gateway - upstream request failed');
    return;
  }

  clientReq.on('error', (err) => {
    logCrashBoundary('client request stream error', err);
    try { upstreamReq.destroy(err); } catch { /* already closed */ }
  });
  clientRes.on('error', (err) => {
    logCrashBoundary('client response stream error', err);
    try { upstreamReq.destroy(err); } catch { /* already closed */ }
  });

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] upstream error on port ${port}:`, err.message);
    if (port === upstreamPort) {
      const entry = getProdEntry();
      if (entry) entry.status = 'stopped';
    }
    if (!clientRes.headersSent) {
      sendPlainError(clientRes, 502, 'Bad Gateway - upstream server unavailable');
    } else {
      try { clientRes.destroy(err); } catch { /* already closed */ }
    }
  });

  if (bodyBuffer !== undefined) {
    if (bodyBuffer.length > 0) upstreamReq.write(bodyBuffer);
    upstreamReq.end();
  } else {
    clientReq.pipe(upstreamReq);
  }
}

async function readRequestBodyForQueuedStart(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  label: string,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  try {
    for await (const chunk of clientReq as AsyncIterable<Buffer>) {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_PROXY_BODY_BYTES) {
        sendPlainError(clientRes, 413, `Request body too large while ${label} server is starting`);
        return null;
      }
      chunks.push(chunk);
    }
  } catch (err) {
    logCrashBoundary(`${label} request body read failed`, err);
    sendPlainError(clientRes, 400, 'Request body could not be read');
    return null;
  }
  return Buffer.concat(chunks);
}

async function forwardWhenReady(
  entry: ManagedServerEntry,
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  entry.lastActivityMs = Date.now();
  if (entry.status === 'running') {
    forwardToPort(entry.port, clientReq, clientRes);
    return;
  }

  const bodyBuffer = await readRequestBodyForQueuedStart(clientReq, clientRes, serverLabel(entry));
  if (bodyBuffer === null) return;

  if (!entry.startPromise) {
    startManagedServer(entry).catch((err) => logCrashBoundary(`${serverLabel(entry)} lazy start failed`, err));
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
        safeEnd(clientRes,
          '<html><head><title>Server Starting</title></head><body>' +
          `<h2>${entry.kind === 'production' ? 'Production' : 'Preview'} server is starting…</h2>` +
          '<p>Please wait a moment and refresh.</p>' +
          '</body></html>',
        );
      }
      resolve();
    }, PREVIEW_START_TIMEOUT_MS);

    entry.startWaiters.push({
      resolve: () => {
        clearTimeout(timeoutId);
        entry.lastActivityMs = Date.now();
        forwardToPort(entry.port, clientReq, clientRes, bodyBuffer);
        resolve();
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        if (!clientRes.headersSent) {
          clientRes.writeHead(503, { 'content-type': 'text/plain' });
          safeEnd(clientRes, `${serverLabel(entry)} server failed to start: ${err.message}\n`);
        }
        resolve();
      },
    });
  });
}

async function handlePreviewRequest(
  sessionId: string,
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  let entry = previewProcesses.get(sessionId);
  if (entry) {
    await forwardWhenReady(entry, clientReq, clientRes);
    return;
  }

  let info = sessionWorktreeCache[sessionId];
  if (!info) {
    readAllPorts();
    info = sessionWorktreeCache[sessionId];
  }
  if (!info) {
    // Unknown session — forward to upstream (will produce a useful 404 from Next.js)
    forwardToPort(upstreamPort, clientReq, clientRes);
    return;
  }
  if (isProductionTarget(sessionId, info.port)) {
    console.warn(`[proxy] refusing preview for session ${sessionId}: worktree is the current production server (port :${info.port})`);
    clientRes.writeHead(409, { 'content-type': 'text/plain' });
    clientRes.end(`This session's branch is now the production server and cannot be previewed as a dev server.\n`);
    return;
  }

  entry = {
    id: sessionId,
    kind: 'preview',
    mode: 'dev',
    port: info.port,
    worktreePath: info.worktreePath,
    lastActivityMs: Date.now(),
    status: 'stopped',
    startWaiters: [],
    startPromise: null,
  };
  previewProcesses.set(sessionId, entry);
  await forwardWhenReady(entry, clientReq, clientRes);
}

async function handleProdRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  const entry = getProdEntry();
  if (!entry) {
    sendPlainError(clientRes, 503, 'Production upstream is not configured');
    return;
  }
  await forwardWhenReady(entry, clientReq, clientRes);
}

// ─── Routing ──────────────────────────────────────────────────────────────────

// ─── HTTP server ──────────────────────────────────────────────────────────────

async function handleRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  try {
    const url = clientReq.url ?? '/';

    if (url.startsWith('/_proxy/')) {
      sendPlainError(clientRes, 404, 'Not Found');
      return;
    }

    // Preview routing with auto-start
    const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
    if (previewMatch) {
      await handlePreviewRequest(previewMatch[1], clientReq, clientRes);
      return;
    }

    // Default: forward to production upstream, lazily starting it if idle/down.
    await handleProdRequest(clientReq, clientRes);
  } catch (err) {
    logCrashBoundary('request handler failed', err);
    sendPlainError(clientRes, 500, 'Internal proxy error');
  }
}

// Internal HTTP handler. Listens on a random localhost port; the external
// net.Server forwards non-WebSocket connections to it via loopback.
const httpHandler = http.createServer((clientReq, clientRes) => {
  handleRequest(clientReq, clientRes).catch((err) => {
    logCrashBoundary('request handler rejected', err);
    sendPlainError(clientRes, 500, 'Internal proxy error');
  });
});

// Inject x-forwarded-for / x-forwarded-proto into a raw HTTP upgrade request
// buffer and return the modified buffer.  Works at the byte level so we don't
// need an HTTP parser just for these two headers.
function buildWsUpgradeRequest(reqBuf: Buffer, remoteAddress: string): Buffer {
  const headerEnd = reqBuf.indexOf('\r\n\r\n');
  if (headerEnd === -1) return reqBuf; // shouldn't happen
  let headers = reqBuf.slice(0, headerEnd).toString('binary');
  // Extract upstream x-forwarded-proto before stripping (exe.dev sets this to 'https').
  const protoMatch = headers.match(/\r\nx-forwarded-proto:\s*([^\r\n]+)/i);
  const proto = protoMatch ? protoMatch[1].trim() : 'http';
  // Remove any existing forwarded headers to avoid duplicates.
  headers = headers.replace(/\r\nx-forwarded-for:[^\r\n]*/gi, '');
  headers = headers.replace(/\r\nx-forwarded-proto:[^\r\n]*/gi, '');
  headers += `\r\nX-Forwarded-For: ${remoteAddress}`;
  headers += `\r\nX-Forwarded-Proto: ${proto}`;
  return Buffer.concat([Buffer.from(headers, 'binary'), Buffer.from('\r\n\r\n')]);
}

// Handle a WebSocket upgrade at the raw TCP level.  This bypasses Bun's
// http.Server upgrade socket, which does not correctly forward writes back
// to the client (Bun bug: the socket's write() call succeeds but the bytes
// are silently dropped).  Using raw net.Socket connections on both sides
// avoids the issue entirely.
function handleWsUpgrade(rawSocket: net.Socket, reqBuf: Buffer): void {
  rawSocket.on('error', (err) => {
    console.error('[proxy] client socket error during WS upgrade:', err.message);
  });

  const reqStr = reqBuf.toString('binary');
  const url = reqStr.match(/^[A-Z]+ (\S+)/)?.[1] ?? '/';

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
  } else {
    const entry = getProdEntry();
    if (entry?.status !== 'running') {
      startProdServerIfNeeded().catch((err) => logCrashBoundary('production lazy start for websocket failed', err));
    }
  }

  const upstreamSocket = net.createConnection(targetPort, '127.0.0.1');
  upstreamSocket.on('connect', () => {
    // Forward the upgrade request (with x-forwarded headers injected).
    upstreamSocket.write(buildWsUpgradeRequest(reqBuf, rawSocket.remoteAddress ?? ''));

    // Inspect the first response chunk from the upstream to verify it is a 101.
    // If not (e.g. the dev server returned 400), return a 502 to the browser.
    // Once confirmed as 101, push the chunk back and start the bidirectional pipe.
    upstreamSocket.once('data', (firstChunk: Buffer) => {
      const firstLine = firstChunk.slice(0, 20).toString('binary');
      if (!firstLine.startsWith('HTTP/1.1 101') && !firstLine.startsWith('HTTP/1.0 101')) {
        console.error(`[proxy] WS upstream on port ${targetPort} did not return 101`);
        upstreamSocket.destroy();
        if (!rawSocket.destroyed) {
          rawSocket.write(
            `HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n` +
            `WebSocket upstream did not upgrade\n`,
          );
          rawSocket.destroy();
        }
        return;
      }
      // Put the first chunk back so it flows through the pipe.
      upstreamSocket.unshift(firstChunk);
      // Bidirectional pipe — after this the proxy is a transparent tunnel.
      rawSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(rawSocket);
      rawSocket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.on('error', () => rawSocket.destroy());
      rawSocket.resume();
    });
  });
  upstreamSocket.on('error', (err) => {
    console.error(`[proxy] WS upstream error on port ${targetPort}:`, err.message);
    if (targetPort === upstreamPort) {
      const entry = getProdEntry();
      if (entry) entry.status = 'stopped';
    }
    if (!rawSocket.destroyed) rawSocket.destroy();
  });
}

// External listener.  Each connection is inspected: WebSocket upgrades are
// handled via raw-TCP tunnelling (see handleWsUpgrade); all other requests
// are forwarded to the internal httpHandler via a loopback connection.
let httpHandlerPort = 0;
const server = net.createServer((rawSocket) => {
  rawSocket.pause();
  let buf = Buffer.alloc(0);
  const headerTimer = setTimeout(() => {
    if (!rawSocket.destroyed) {
      rawSocket.write('HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n');
      rawSocket.destroy();
    }
  }, REQUEST_HEADER_TIMEOUT_MS);
  headerTimer.unref();

  rawSocket.on('error', (err) => {
    logCrashBoundary('raw client socket error', err);
  });
  rawSocket.on('close', () => clearTimeout(headerTimer));

  const onData = (chunk: Buffer): void => {
    try {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (buf.length > MAX_REQUEST_HEADER_BYTES) {
          clearTimeout(headerTimer);
          rawSocket.removeListener('data', onData);
          if (!rawSocket.destroyed) {
            rawSocket.write('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
            rawSocket.destroy();
          }
          return;
        }
        // Headers not yet complete — keep accumulating.
        rawSocket.resume();
        return;
      }
      if (headerEnd > MAX_REQUEST_HEADER_BYTES) {
        clearTimeout(headerTimer);
        rawSocket.removeListener('data', onData);
        if (!rawSocket.destroyed) {
          rawSocket.write('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
          rawSocket.destroy();
        }
        return;
      }

      clearTimeout(headerTimer);
      rawSocket.removeListener('data', onData);

      const isWsUpgrade = /upgrade:\s*websocket/i.test(buf.slice(0, headerEnd).toString('binary'));
      if (isWsUpgrade) {
        handleWsUpgrade(rawSocket, buf);
      } else {
        // Forward to internal HTTP handler via loopback.
        const internal = net.createConnection(httpHandlerPort, '127.0.0.1');
        internal.on('connect', () => {
          internal.write(buf);
          rawSocket.pipe(internal);
          internal.pipe(rawSocket);
          rawSocket.on('error', () => internal.destroy());
          internal.on('error', () => rawSocket.destroy());
          rawSocket.resume();
        });
        internal.on('error', (err) => {
          console.error('[proxy] internal handler connection error:', err.message);
          if (!rawSocket.destroyed) rawSocket.destroy();
        });
      }
    } catch (err) {
      clearTimeout(headerTimer);
      rawSocket.removeListener('data', onData);
      logCrashBoundary('raw request classification failed', err);
      if (!rawSocket.destroyed) rawSocket.destroy();
    }
  };

  rawSocket.on('data', onData);
  rawSocket.resume();
});

// ─── Server startup ───────────────────────────────────────────────────────────

httpHandler.listen(0, '127.0.0.1', () => {
  httpHandlerPort = (httpHandler.address() as net.AddressInfo).port;
  server.listen(LISTEN_PORT, '0.0.0.0', () => {
    console.log(
      `[proxy] listening on :${LISTEN_PORT} → upstream :${upstreamPort} (git config)`,
    );
    console.log(`[proxy] main repo: ${MAIN_REPO}`);
    console.log(`[proxy] worktrees: ${WORKTREES_DIR}`);
  });
});

runScheduledJobs({
  repoRoot: MAIN_REPO,
  listenPort: LISTEN_PORT,
  archiveRoot: process.env.PRIMORDIA_DIR || PRIMORDIA_ROOT,
  logError: logCrashBoundary,
});

process.on('unhandledRejection', (reason) => {
  logCrashBoundary('unhandled promise rejection', reason);
});

process.on('uncaughtException', (err) => {
  logCrashBoundary('uncaught exception', err);
});

process.on('SIGTERM', () => {
  // Stop all preview servers before exiting.
  for (const sessionId of previewProcesses.keys()) {
    stopPreviewServer(sessionId);
  }
  // Close the external listener then the internal handler.
  // Belt-and-suspenders: force exit after 5 s if connections don't drain.
  server.close(() => httpHandler.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5_000).unref();
});

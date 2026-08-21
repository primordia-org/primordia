// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// Listens on REVERSE_PROXY_PORT (default 3000) and forwards all traffic to
// the upstream port stored in git config as branch.{currentBranch}.port for
// the branch stored in git config as primordia.productionBranch.
//
// On startup and on demand, if the production Next.js server is not already
// running, the proxy asks lib/process-manager.ts to start it as a detached
// process. The proxy itself owns no app server or scheduled-job child processes.
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
import { Duplex } from 'stream';
import {
  getProxyRoutingState,
  startWorktreeServer,
  stopWorktreeServer,
  watchGitConfig,
} from '@/lib/process-manager';
import { getPrimordiaRuntimePaths } from '@/lib/git-runtime';
import { applyCurrentProcessOomRole } from '@/lib/oom-priority';
import { sendWebPushToCategory, WEB_PUSH_CATEGORY_TAGS } from '@/lib/web-push';

console.log(`[proxy] runtime Bun ${Bun.version}`);
applyCurrentProcessOomRole('reverse-proxy', (message) => console.warn(`[proxy] ${message}`));

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
const WORKTREES_DIR = PRIMORDIA_PATHS.worktreesDir;
const MAIN_REPO = PRIMORDIA_PATHS.mainRepo;

let upstreamPort = 3001;
/** The branch name currently set as primordia.productionBranch. */
let currentProdBranch: string | null = null;

/** Cache of branch name → { worktreePath, port } for preview server spawning. */
let sessionWorktreeCache: Record<string, { worktreePath: string; port: number }> = {};
/** Path to the git config file being watched. */
let watchedConfigPath: string | null = null;
// ─── Managed app server registry configuration ───────────────────────────────
/** Inactivity timeout in minutes before a preview server is stopped (configurable via git config primordia.previewInactivityMin). */
let previewInactivityMin = 30;
/** How long to wait for a server to become ready before giving up (2 min). */
const PREVIEW_START_TIMEOUT_MS = 2 * 60 * 1000;

/** Maximum JSON/body bytes read by proxy management endpoints before forwarding. */
const MAX_PROXY_BODY_BYTES = 1024 * 1024;
/** Avoid probing an already-running preview on every asset request while still detecting stale idle entries promptly. */
const PREVIEW_RUNNING_CHECK_INTERVAL_MS = 5_000;
/** Background health-check cadence for production. This is separate from request-time lazy starts. */
const PRODUCTION_HEALTH_CHECK_INTERVAL_MS = 10_000;
/** Avoid duplicate outage pushes during a restart storm. */
const PRODUCTION_OUTAGE_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

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
  lastReadyCheckMs: number;
}

/** Active preview server processes keyed by session ID. */
const previewProcesses = new Map<string, ManagedServerEntry>();
let prodEntry: ManagedServerEntry | null = null;
let productionOutageStartedAt: number | null = null;
let lastProductionOutageNotificationMs = 0;
let lastProductionRecoveryNotificationMs = 0;

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
      lastReadyCheckMs: 0,
    };
  }
  return prodEntry;
}

async function notifyProductionServerHealth(title: string, body: string, tagSuffix: string): Promise<void> {
  try {
    const result = await sendWebPushToCategory('server-health-alerts', {
      title,
      body,
      url: '/admin/server-health',
      tag: `${WEB_PUSH_CATEGORY_TAGS['server-health-alerts']}-production-${tagSuffix}`,
    });
    console.log(`[proxy] server-health push '${title}' attempted=${result.attempted} delivered=${result.delivered}`);
  } catch (err) {
    logCrashBoundary('server-health push failed', err);
  }
}

function maybeNotifyProductionOutage(reason: string): void {
  const now = Date.now();
  if (now - lastProductionOutageNotificationMs < PRODUCTION_OUTAGE_NOTIFY_COOLDOWN_MS) return;
  lastProductionOutageNotificationMs = now;
  const branch = currentProdBranch ?? 'unknown branch';
  void notifyProductionServerHealth(
    'Primordia production server is down',
    `${branch} on port ${upstreamPort} is not answering (${reason}). The reverse proxy is attempting to restart it.`,
    'down',
  );
}

function markProductionOutage(reason: string): void {
  if (productionOutageStartedAt === null) productionOutageStartedAt = Date.now();
  maybeNotifyProductionOutage(reason);
}

function maybeNotifyProductionRecovery(): void {
  if (productionOutageStartedAt === null) return;
  const outageMs = Date.now() - productionOutageStartedAt;
  productionOutageStartedAt = null;
  const now = Date.now();
  if (now - lastProductionRecoveryNotificationMs < PRODUCTION_OUTAGE_NOTIFY_COOLDOWN_MS) return;
  lastProductionRecoveryNotificationMs = now;
  const branch = currentProdBranch ?? 'unknown branch';
  void notifyProductionServerHealth(
    'Primordia production server recovered',
    `${branch} on port ${upstreamPort} is answering again after ${Math.round(outageMs / 1000)}s.`,
    'recovered',
  );
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
      entry.lastReadyCheckMs = Date.now();
      console.log(`[proxy] ${serverLabel(entry)} server ready on :${entry.port}`);
      if (entry.kind === 'production') maybeNotifyProductionRecovery();
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
      entry.lastReadyCheckMs = Date.now();
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
      if (entry.kind === 'production') markProductionOutage(startErr.message);
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

// Production server safety net: the service supervisor intentionally keeps only
// the proxy/jobs daemons alive. The proxy owns production app-server lifecycle,
// so it must restart production even when no user request arrives to trigger the
// normal lazy-start path.
setInterval(() => {
  const entry = getProdEntry();
  if (!entry || entry.startPromise) return;
  isPortReady(entry.port, 750).then((ready) => {
    if (ready) {
      entry.status = 'running';
      entry.lastReadyCheckMs = Date.now();
      maybeNotifyProductionRecovery();
      return;
    }
    if (entry.status === 'running') console.warn(`[proxy] production health check failed on :${entry.port}; restarting`);
    entry.status = 'stopped';
    markProductionOutage('background health check failed');
    startManagedServer(entry).catch((err) => logCrashBoundary('production health-check restart failed', err));
  }).catch((err) => logCrashBoundary('production health check failed unexpectedly', err));
}, PRODUCTION_HEALTH_CHECK_INTERVAL_MS).unref();

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
      markProductionOutage(`upstream error: ${err.message}`);
    }
    for (const entry of previewProcesses.values()) {
      if (entry.port === port && entry.status === 'running') {
        console.warn(`[proxy] marking ${serverLabel(entry)} server stopped after upstream error on :${port}`);
        entry.status = 'stopped';
      }
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
    const shouldCheckPreview = entry.kind === 'preview'
      && Date.now() - entry.lastReadyCheckMs >= PREVIEW_RUNNING_CHECK_INTERVAL_MS;
    if (!shouldCheckPreview) {
      forwardToPort(entry.port, clientReq, clientRes);
      return;
    }
    if (await isPortReady(entry.port, 750)) {
      entry.lastReadyCheckMs = Date.now();
      forwardToPort(entry.port, clientReq, clientRes);
      return;
    }
    console.warn(`[proxy] ${serverLabel(entry)} server was marked running but :${entry.port} is down; restarting before forwarding`);
    entry.status = 'stopped';
    if (entry.kind === 'production') markProductionOutage('health check failed before forwarding');
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
    lastReadyCheckMs: 0,
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

function writeSocketHttpError(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
    `Content-Type: text/plain\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    `${message}\n`,
    () => socket.destroy(),
  );
}

async function ensureReadyForUpgrade(entry: ManagedServerEntry): Promise<void> {
  entry.lastActivityMs = Date.now();
  if (entry.status === 'running') {
    const shouldCheckPreview = entry.kind === 'preview'
      && Date.now() - entry.lastReadyCheckMs >= PREVIEW_RUNNING_CHECK_INTERVAL_MS;
    if (!shouldCheckPreview) return;
    if (await isPortReady(entry.port, 750)) {
      entry.lastReadyCheckMs = Date.now();
      return;
    }
    console.warn(`[proxy] ${serverLabel(entry)} server was marked running but :${entry.port} is down; restarting before websocket upgrade`);
    entry.status = 'stopped';
    if (entry.kind === 'production') markProductionOutage('health check failed before websocket upgrade');
  }

  if (!entry.startPromise) {
    startManagedServer(entry).catch((err) => logCrashBoundary(`${serverLabel(entry)} websocket lazy start failed`, err));
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${serverLabel(entry)} server is still starting`));
    }, PREVIEW_START_TIMEOUT_MS);

    entry.startWaiters.push({
      resolve: () => {
        clearTimeout(timeoutId);
        entry.lastActivityMs = Date.now();
        resolve();
      },
      reject: (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
    });
  });
}

async function getUpgradeTarget(url: string): Promise<ManagedServerEntry | null> {
  const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
  if (previewMatch) {
    const sessionId = previewMatch[1];
    let entry = previewProcesses.get(sessionId);
    if (entry) {
      await ensureReadyForUpgrade(entry);
      return entry;
    }

    let info = sessionWorktreeCache[sessionId];
    if (!info) {
      readAllPorts();
      info = sessionWorktreeCache[sessionId];
    }
    if (!info) return null;
    if (isProductionTarget(sessionId, info.port)) {
      throw new Error(`This session's branch is now the production server and cannot be previewed as a dev server.`);
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
      lastReadyCheckMs: 0,
    };
    previewProcesses.set(sessionId, entry);
    await ensureReadyForUpgrade(entry);
    return entry;
  }

  const entry = getProdEntry();
  if (!entry) return null;
  await ensureReadyForUpgrade(entry);
  return entry;
}

async function handleWsUpgrade(
  clientReq: http.IncomingMessage,
  clientSocket: Duplex,
  clientHead: Buffer,
): Promise<void> {
  clientSocket.on('error', (err) => {
    console.error('[proxy] client socket error during WS upgrade:', err.message);
  });

  const url = clientReq.url ?? '/';
  let target: ManagedServerEntry | null;
  try {
    target = await getUpgradeTarget(url);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[proxy] websocket target error for ${url}:`, message);
    writeSocketHttpError(clientSocket, 409, message);
    return;
  }

  if (!target) {
    writeSocketHttpError(clientSocket, 503, 'WebSocket upstream is not configured');
    return;
  }

  const upstreamReq = http.request({
    hostname: '127.0.0.1',
    port: target.port,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...forwardHeaders(clientReq, {
        'x-forwarded-for': clientReq.socket.remoteAddress ?? '',
        'x-forwarded-proto': (typeof clientReq.headers['x-forwarded-proto'] === 'string'
          ? clientReq.headers['x-forwarded-proto']
          : 'http'),
        'x-forwarded-port': derivePublicPort(clientReq),
      }),
      connection: 'Upgrade',
      upgrade: String(clientReq.headers.upgrade ?? 'websocket'),
    },
  });

  upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const headerLines = Object.entries(upstreamRes.headers).flatMap(([name, value]) => {
      if (Array.isArray(value)) return value.map((item) => `${name}: ${item}`);
      return value == null ? [] : [`${name}: ${value}`];
    });
    clientSocket.write(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
    if (clientHead.length > 0) upstreamSocket.write(clientHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => clientSocket.destroy());
  });

  upstreamReq.on('response', (upstreamRes) => {
    console.error(`[proxy] WS upstream on port ${target.port} returned ${upstreamRes.statusCode ?? 'unknown'} instead of 101`);
    upstreamReq.destroy();
    writeSocketHttpError(clientSocket, 502, 'WebSocket upstream did not upgrade');
  });

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] WS upstream error on port ${target.port}:`, err.message);
    if (target.kind === 'production') {
      target.status = 'stopped';
      markProductionOutage(`websocket upstream error: ${err.message}`);
    } else if (target.status === 'running') {
      console.warn(`[proxy] marking ${serverLabel(target)} server stopped after websocket upstream error on :${target.port}`);
      target.status = 'stopped';
    }
    if (!clientSocket.destroyed) clientSocket.destroy();
  });

  upstreamReq.end();
}

const server = http.createServer((clientReq, clientRes) => {
  handleRequest(clientReq, clientRes).catch((err) => {
    logCrashBoundary('request handler rejected', err);
    sendPlainError(clientRes, 500, 'Internal proxy error');
  });
});

server.on('upgrade', (clientReq, clientSocket, clientHead) => {
  handleWsUpgrade(clientReq, clientSocket, clientHead).catch((err) => {
    logCrashBoundary('websocket upgrade handler rejected', err);
    writeSocketHttpError(clientSocket, 500, 'Internal proxy error');
  });
});

// ─── Server startup ───────────────────────────────────────────────────────────

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(
    `[proxy] listening on :${LISTEN_PORT} → upstream :${upstreamPort} (git config)`,
  );
  console.log(`[proxy] main repo: ${MAIN_REPO}`);
  console.log(`[proxy] worktrees: ${WORKTREES_DIR}`);
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
  // Belt-and-suspenders: force exit after 5 s if connections don't drain.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});

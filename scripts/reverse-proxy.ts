// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// This process only proxies public traffic. Production and preview process
// lifecycle is delegated to scripts/worktree-session-daemon.ts over a local
// Unix socket. Keeping process management out of this file lets the proxy stay
// stable while worktree/session lifecycle behavior evolves independently.

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailers',
]);

const LISTEN_PORT = parseInt(process.env.REVERSE_PROXY_PORT ?? '3000', 10);
const DAEMON_SOCKET_PATH = process.env.WORKTREE_DAEMON_SOCKET || path.join('/tmp', `primordia-worktree-daemon-${LISTEN_PORT}.sock`);
const PRIMORDIA_ROOT = path.dirname(__filename);
const WORKTREES_DIR = path.join(PRIMORDIA_ROOT, 'worktrees');
const MAIN_REPO = path.join(PRIMORDIA_ROOT, 'source.git');
const MAX_REQUEST_HEADER_BYTES = 64 * 1024;
const REQUEST_HEADER_TIMEOUT_MS = 30_000;
const PREVIEW_START_TIMEOUT_MS = 2 * 60 * 1000;

let upstreamPort = 3001;
let currentProdBranch: string | null = null;
let sessionPortCache: Record<string, number> = {};
let watchedConfigPath: string | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logCrashBoundary(label: string, err: unknown): void {
  console.error(`[proxy] ${label}:`, errorMessage(err));
}

function safeEnd(res: http.ServerResponse, statusCode: number, message: string): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.writeHead(statusCode, { 'content-type': 'text/plain' });
    res.end(`${message}\n`);
  } catch (err) {
    logCrashBoundary('response write failed', err);
    try { res.destroy(err instanceof Error ? err : undefined); } catch { /* already closed */ }
  }
}

function findGitConfigPath(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.isAbsolute(out) ? path.join(out, 'config') : path.join(cwd, out, 'config');
  } catch {
    return null;
  }
}

function readAllPorts(): void {
  try {
    const prod = execFileSync('git', ['config', '--get', 'primordia.productionBranch'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (prod) currentProdBranch = prod;
  } catch { /* not set yet */ }

  const nextSessionPorts: Record<string, number> = {};
  try {
    const out = execFileSync('git', ['config', '--get-regexp', '^branch\\.[^.]+\\.port$'], {
      cwd: MAIN_REPO,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceIdx = trimmed.indexOf(' ');
      if (spaceIdx === -1) continue;
      const key = trimmed.slice(0, spaceIdx);
      const value = trimmed.slice(spaceIdx + 1).trim();
      const match = key.match(/^branch\.([^.]+)\.port$/);
      if (!match) continue;
      const port = parseInt(value, 10);
      if (port) nextSessionPorts[match[1]] = port;
    }
  } catch { /* no branch ports yet */ }

  sessionPortCache = nextSessionPorts;
  if (currentProdBranch && sessionPortCache[currentProdBranch]) {
    upstreamPort = sessionPortCache[currentProdBranch];
  }

  const configPath = findGitConfigPath(MAIN_REPO);
  if (configPath && configPath !== watchedConfigPath) watchGitConfig(configPath);
}

function watchGitConfig(configPath: string): void {
  watchedConfigPath = configPath;
  try {
    fs.watch(configPath, { persistent: false }, () => {
      setTimeout(() => {
        try { readAllPorts(); } catch (err) { logCrashBoundary('git config reload failed', err); }
      }, 50);
    });
  } catch (err) {
    logCrashBoundary(`could not watch git config at ${configPath}`, err);
  }
}

function stripHopByHopHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const connVal = headers.connection;
  const perConnection = new Set(
    typeof connVal === 'string' ? connVal.split(',').map((s) => s.trim().toLowerCase()) : [],
  );
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && !perConnection.has(lower)) out[key] = value;
  }
  return out;
}

function forwardHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const out = stripHopByHopHeaders(req.headers);
  if (req.headers.host && !out['x-forwarded-host']) out['x-forwarded-host'] = req.headers.host;
  const remote = req.socket.remoteAddress;
  if (remote) {
    const prior = req.headers['x-forwarded-for'];
    out['x-forwarded-for'] = typeof prior === 'string' && prior ? `${prior}, ${remote}` : remote;
  }
  if (!out['x-forwarded-proto']) out['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? 'http';
  return out;
}

function daemonRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const upstream = http.request({
    socketPath: DAEMON_SOCKET_PATH,
    path: req.url,
    method: req.method,
    headers: stripHopByHopHeaders(req.headers),
  }, (daemonRes) => {
    res.writeHead(daemonRes.statusCode ?? 502, stripHopByHopHeaders(daemonRes.headers));
    daemonRes.pipe(res);
  });
  upstream.on('error', (err) => safeEnd(res, 503, `Worktree daemon unavailable: ${errorMessage(err)}`));
  req.pipe(upstream);
}

async function daemonFetch(pathname: string, init?: { method?: string; body?: string; headers?: http.OutgoingHttpHeaders }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DAEMON_SOCKET_PATH,
      path: pathname,
      method: init?.method ?? 'GET',
      headers: init?.headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (init?.body) req.end(init.body); else req.end();
  });
}

async function ensurePreviewRunning(sessionId: string): Promise<void> {
  const readStatus = async (): Promise<string> => {
    const res = await daemonFetch(`/_proxy/preview/${encodeURIComponent(sessionId)}/status`);
    if (res.status >= 400) throw new Error(res.body || `status ${res.status}`);
    try { return (JSON.parse(res.body) as { devServerStatus?: string }).devServerStatus ?? 'stopped'; }
    catch { return 'stopped'; }
  };

  let status = await readStatus();
  if (status === 'running') return;
  if (status !== 'starting') {
    const restart = await daemonFetch(`/_proxy/preview/${encodeURIComponent(sessionId)}/restart`, { method: 'POST' });
    if (restart.status >= 400) throw new Error(restart.body || `restart ${restart.status}`);
  }

  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await readStatus();
    if (status === 'running') return;
    if (status === 'error' || status === 'stopped') throw new Error(`preview server ${status}`);
  }
  throw new Error('preview server did not become ready in time');
}

function forwardToPort(port: number, req: http.IncomingMessage, res: http.ServerResponse): void {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port,
    path: req.url,
    method: req.method,
    headers: forwardHeaders(req),
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, stripHopByHopHeaders(upstreamRes.headers));
    upstreamRes.pipe(res);
  });
  upstream.on('error', (err) => safeEnd(res, 502, `Upstream on port ${port} unavailable: ${errorMessage(err)}`));
  req.pipe(upstream);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  if (url === '/_proxy/refresh' && req.method === 'POST') {
    readAllPorts();
    daemonRequest(req, res);
    return;
  }
  if (url.startsWith('/_proxy/')) {
    daemonRequest(req, res);
    return;
  }

  const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
  if (previewMatch) {
    const sessionId = decodeURIComponent(previewMatch[1]);
    const port = sessionPortCache[sessionId] ?? (() => { readAllPorts(); return sessionPortCache[sessionId]; })();
    if (!port) return safeEnd(res, 404, `Unknown preview session: ${sessionId}`);
    if (port === upstreamPort) return forwardToPort(port, req, res);
    try {
      await ensurePreviewRunning(sessionId);
    } catch (err) {
      return safeEnd(res, 503, `Preview unavailable: ${errorMessage(err)}`);
    }
    return forwardToPort(port, req, res);
  }

  forwardToPort(upstreamPort, req, res);
}

const httpHandler = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    logCrashBoundary('request handler failed', err);
    safeEnd(res, 500, 'Internal proxy error');
  });
});

function buildWsUpgradeRequest(reqBuf: Buffer, remoteAddress: string): Buffer {
  const headerEnd = reqBuf.indexOf('\r\n\r\n');
  if (headerEnd === -1) return reqBuf;
  let headers = reqBuf.slice(0, headerEnd).toString('binary');
  const protoMatch = headers.match(/\r\nx-forwarded-proto:\s*([^\r\n]+)/i);
  const proto = protoMatch ? protoMatch[1].trim() : 'http';
  headers = headers.replace(/\r\nx-forwarded-for:[^\r\n]*/gi, '');
  headers = headers.replace(/\r\nx-forwarded-proto:[^\r\n]*/gi, '');
  headers += `\r\nX-Forwarded-For: ${remoteAddress}`;
  headers += `\r\nX-Forwarded-Proto: ${proto}`;
  return Buffer.concat([Buffer.from(headers, 'binary'), Buffer.from('\r\n\r\n')]);
}

function handleWsUpgrade(rawSocket: net.Socket, reqBuf: Buffer): void {
  rawSocket.on('error', (err) => logCrashBoundary('client socket error during WS upgrade', err));
  const url = reqBuf.toString('binary').match(/^[A-Z]+ (\S+)/)?.[1] ?? '/';
  const previewMatch = url.match(/^\/preview\/([^/?#]+)/);
  let targetPort = upstreamPort;
  if (previewMatch) {
    const cached = sessionPortCache[decodeURIComponent(previewMatch[1])] ?? (() => { readAllPorts(); return sessionPortCache[decodeURIComponent(previewMatch[1])]; })();
    if (cached) targetPort = cached;
  }

  const upstreamSocket = net.createConnection(targetPort, '127.0.0.1');
  upstreamSocket.on('connect', () => {
    upstreamSocket.write(buildWsUpgradeRequest(reqBuf, rawSocket.remoteAddress ?? ''));
    upstreamSocket.pipe(rawSocket);
    rawSocket.pipe(upstreamSocket);
    rawSocket.resume();
  });
  upstreamSocket.on('error', (err) => {
    logCrashBoundary(`WS upstream connection failed on :${targetPort}`, err);
    if (!rawSocket.destroyed) {
      rawSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nWebSocket upstream unavailable\n');
      rawSocket.destroy();
    }
  });
  rawSocket.on('close', () => upstreamSocket.destroy());
}

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

  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk]);
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      if (buf.length > MAX_REQUEST_HEADER_BYTES) {
        clearTimeout(headerTimer);
        rawSocket.removeListener('data', onData);
        rawSocket.write('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n');
        rawSocket.destroy();
      }
      rawSocket.resume();
      return;
    }

    clearTimeout(headerTimer);
    rawSocket.removeListener('data', onData);
    if (/upgrade:\s*websocket/i.test(buf.slice(0, headerEnd).toString('binary'))) {
      handleWsUpgrade(rawSocket, buf);
      return;
    }

    const internal = net.createConnection(httpHandlerPort, '127.0.0.1');
    internal.on('connect', () => {
      internal.write(buf);
      rawSocket.pipe(internal);
      internal.pipe(rawSocket);
      rawSocket.resume();
    });
    internal.on('error', (err) => {
      logCrashBoundary('internal handler connection failed', err);
      rawSocket.destroy();
    });
  };

  rawSocket.on('error', (err) => logCrashBoundary('raw client socket error', err));
  rawSocket.on('close', () => clearTimeout(headerTimer));
  rawSocket.on('data', onData);
  rawSocket.resume();
});

try { readAllPorts(); } catch (err) { logCrashBoundary('initial git config load failed', err); }
setInterval(() => {
  try { readAllPorts(); } catch (err) { logCrashBoundary('periodic git config reload failed', err); }
}, 5000).unref();

httpHandler.listen(0, '127.0.0.1', () => {
  httpHandlerPort = (httpHandler.address() as net.AddressInfo).port;
  server.listen(LISTEN_PORT, '0.0.0.0', () => {
    console.log(`[proxy] listening on :${LISTEN_PORT} → production :${upstreamPort}`);
    console.log(`[proxy] lifecycle daemon socket: ${DAEMON_SOCKET_PATH}`);
    console.log(`[proxy] main repo: ${MAIN_REPO}`);
    console.log(`[proxy] worktrees: ${WORKTREES_DIR}`);
  });
});

process.on('unhandledRejection', (reason) => logCrashBoundary('unhandled promise rejection', reason));
process.on('uncaughtException', (err) => logCrashBoundary('uncaught exception', err));
process.on('SIGTERM', () => {
  server.close(() => httpHandler.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5_000).unref();
});

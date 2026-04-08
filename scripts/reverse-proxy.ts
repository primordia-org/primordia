// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// Listens on REVERSE_PROXY_PORT (default 3000) and forwards all traffic to
// the upstream port stored in git config as branch.{currentBranch}.port for
// the branch checked out in the primordia-worktrees/current slot.
//
// Preview server routing: requests to /preview/{sessionId}/... are routed to
// the port associated with that session. The mapping is derived from git config:
// each branch has branch.{name}.sessionId and branch.{name}.port entries, which
// are combined into a sessionId → port lookup table.
//
// This approach eliminates the need for proxy-upstream.json and
// proxy-previews.json entirely — the single source of truth is git config,
// which is updated atomically during blue/green accepts.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import { execFileSync } from 'child_process';

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
const CURRENT_SYMLINK = path.join(WORKTREES_DIR, 'current');

let upstreamPort = 3001;
/** Cache of session ID → port for fast preview lookups. */
let sessionPortCache: Record<string, number> = {};
/** Path to the git config file being watched. */
let watchedConfigPath: string | null = null;
/** Path to the .git/PROD symbolic-ref file being watched. */
let watchedProdPath: string | null = null;

/** Returns the resolved path of the current production worktree. */
function getCurrentWorktreePath(): string | null {
  try {
    return fs.realpathSync(CURRENT_SYMLINK);
  } catch {
    return null;
  }
}

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
 * Re-reads all branch ports from git config and updates the cache.
 * Also updates the upstream port based on the current branch.
 */
function readAllPorts(): void {
  const worktreePath = getCurrentWorktreePath();
  if (!worktreePath) return;

  // Start watching the git config file if not already doing so.
  if (!watchedConfigPath) {
    const cfgPath = findGitConfigPath(worktreePath);
    if (cfgPath) {
      watchedConfigPath = cfgPath;
      watchGitConfig(cfgPath);
      // Also watch .git/PROD; it may not exist until the first accept.
      setupProdWatch(path.dirname(cfgPath));
    }
  }

  const branchPort: Record<string, number> = {};
  try {
    // Build branch → port map from git config.
    const portOut = execFileSync('git', ['config', '--get-regexp', 'branch\\..*\\.port'], {
      cwd: worktreePath,
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
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const cache: Record<string, number> = {};
    for (const line of sessionOut.trim().split('\n')) {
      if (!line) continue;
      const m = line.match(/^branch\.(.+)\.sessionid\s+(\S+)$/);
      if (m) {
        const port = branchPort[m[1]];
        if (port) cache[m[2]] = port;
      }
    }
    sessionPortCache = cache;
  } catch {
    // git config --get-regexp exits non-zero when no keys match — normal on first run
  }

  // Determine production branch: prefer the PROD symbolic-ref (set on each
  // accept), fall back to HEAD of the current worktree (initial bootstrap
  // before the first accept or on pre-PROD deployments).
  let prodBranch: string | null = null;
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'PROD'], {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (ref) prodBranch = ref;
  } catch {
    // PROD not yet initialised — fall through to HEAD fallback
  }
  if (!prodBranch) {
    try {
      prodBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null;
    } catch {
      // Detached HEAD — keep current upstream port
    }
  }
  if (prodBranch) {
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

/**
 * Sets up a fs.watch on .git/PROD so the proxy reacts instantly when the
 * production branch changes. PROD is created on the first accept, so this
 * retries every 5 s until the file appears.
 */
function setupProdWatch(gitDir: string): void {
  if (watchedProdPath) return;
  const prodRefPath = path.join(gitDir, 'PROD');
  if (fs.existsSync(prodRefPath)) {
    watchedProdPath = prodRefPath;
    fs.watch(prodRefPath, () => setTimeout(readAllPorts, 50));
  } else {
    // PROD is created on the first accept — retry until it appears.
    setTimeout(() => setupProdWatch(gitDir), 5_000);
  }
}

readAllPorts();

// Safety-net poll every 5 s in case fs.watch misses an event
setInterval(readAllPorts, 5000);

/**
 * Resolves the target port for a request.
 * Requests matching /preview/{sessionId} are routed to that session's port;
 * everything else goes to the main upstream.
 */
function resolveTargetPort(urlPath: string): number {
  const previewMatch = urlPath.match(/^\/preview\/([^/?#]+)/);
  if (previewMatch) {
    const port = sessionPortCache[previewMatch[1]];
    if (port) return port;
  }
  return upstreamPort;
}

const server = http.createServer((clientReq, clientRes) => {
  const targetPort = resolveTargetPort(clientReq.url ?? '/');

  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: targetPort,
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
    console.error(`[proxy] upstream error on port ${targetPort}:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end('Bad Gateway — upstream server unavailable\n');
    }
  });

  clientReq.pipe(upstreamReq);
});

server.on('upgrade', (clientReq: http.IncomingMessage, clientSocket: stream.Duplex, head: Buffer) => {
  clientSocket.on('error', (err) => {
    console.error(`[proxy] client socket error during WS upgrade:`, err.message);
  });

  const targetPort = resolveTargetPort(clientReq.url ?? '/');

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

    if (upstreamHead && upstreamHead.length > 0) clientSocket.unshift(upstreamHead);
    if (head && head.length > 0) upstreamSocket.unshift(head);

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);

    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => clientSocket.destroy());
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
  console.log(`[proxy] worktrees: ${WORKTREES_DIR}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

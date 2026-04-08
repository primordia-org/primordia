// scripts/reverse-proxy.ts
// Lightweight HTTP reverse proxy for zero-downtime blue/green deploys.
//
// Listens on REVERSE_PROXY_PORT (default 3000) and forwards all traffic to
// the upstream port defined in proxy-upstream.json in the primordia-worktrees
// directory. The upstream port is updated atomically during accepts, so traffic
// switches to the new production server with no dropped connections.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';

// Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1).
// These are connection-specific and meaningful only for a single transport link.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailers',
]);

/**
 * Strip hop-by-hop headers from a headers object before forwarding to upstream.
 * Also strips any headers named in the Connection header's value, which marks
 * additional per-hop headers specific to this connection.
 *
 * NOTE: transfer-encoding is intentionally NOT stripped here. Node.js HTTP
 * already decodes chunked bodies and will re-encode on the outgoing side; the
 * header value ends up accurate without any special handling.
 *
 * NOTE: upgrade is intentionally NOT stripped here. Non-upgrade requests don't
 * carry this header, and the upgrade path uses a separate handler that forwards
 * all WebSocket negotiation headers verbatim.
 */
function forwardHeaders(
  incoming: http.IncomingMessage,
  extra: Record<string, string>,
): http.OutgoingHttpHeaders {
  const raw = incoming.headers;

  // Collect any per-connection header names declared in the Connection value.
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

  // Set x-forwarded-* headers. x-forwarded-host lets upstream reconstruct the
  // public URL (used by the exe.dev SSO route for redirect generation).
  const host = raw['host'];
  if (host && !out['x-forwarded-host']) {
    out['x-forwarded-host'] = host;
  }

  return { ...out, ...extra };
}

const LISTEN_PORT = parseInt(process.env.REVERSE_PROXY_PORT ?? '3000', 10);
const WORKTREES_DIR =
  process.env.PRIMORDIA_WORKTREES_DIR ?? '/home/exedev/primordia-worktrees';
const CONFIG_PATH = path.join(WORKTREES_DIR, 'proxy-upstream.json');

let upstreamPort = 3001;

function readConfig(): void {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { port: number };
    if (typeof parsed.port === 'number' && parsed.port > 0 && parsed.port !== upstreamPort) {
      console.log(`[proxy] upstream port: ${upstreamPort} → ${parsed.port}`);
      upstreamPort = parsed.port;
    }
  } catch {
    // Config not yet written — keep current value
  }
}

readConfig();

// Watch config file for changes; retry until the file exists
function watchConfig(): void {
  try {
    fs.watch(CONFIG_PATH, () => setTimeout(readConfig, 50));
  } catch {
    setTimeout(watchConfig, 1000);
  }
}
watchConfig();

// Safety-net poll every 5 s in case fs.watch misses an event
setInterval(readConfig, 5000);

const server = http.createServer((clientReq, clientRes) => {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: upstreamPort,
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
    console.error(`[proxy] upstream error on port ${upstreamPort}:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain' });
      clientRes.end('Bad Gateway — upstream server unavailable\n');
    }
  });

  clientReq.pipe(upstreamReq);
});

// Handle WebSocket upgrade requests (required for Next.js HMR in dev mode).
// All WebSocket negotiation headers (Upgrade, Connection, Sec-WebSocket-*) are
// forwarded verbatim — hop-by-hop stripping is intentionally skipped here because
// these headers are required by the WebSocket handshake protocol (RFC 6455).
server.on('upgrade', (clientReq: http.IncomingMessage, clientSocket: stream.Duplex, head: Buffer) => {
  // Guard against client disconnect before the upstream 101 arrives.
  clientSocket.on('error', (err) => {
    console.error(`[proxy] client socket error during WS upgrade:`, err.message);
  });

  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: upstreamPort,
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
    // Forward the 101 Switching Protocols response to the client.
    let responseHead = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, val] of Object.entries(upstreamRes.headers)) {
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) responseHead += `${key}: ${v}\r\n`;
    }
    responseHead += '\r\n';
    clientSocket.write(responseHead);

    // If either side buffered bytes in the same TCP packet as the upgrade
    // handshake, replay them into the correct socket before piping starts.
    // upstreamHead = bytes the upstream sent after its 101 → goes to clientSocket.
    // head = bytes the client sent after its Upgrade request → goes to upstreamSocket.
    if (upstreamHead && upstreamHead.length > 0) clientSocket.unshift(upstreamHead);
    if (head && head.length > 0) upstreamSocket.unshift(head);

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);

    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => clientSocket.destroy());
  });

  upstreamReq.on('error', (err) => {
    console.error(`[proxy] WS upstream error on port ${upstreamPort}:`, err.message);
    clientSocket.destroy();
  });

  upstreamReq.end();
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(
    `[proxy] listening on :${LISTEN_PORT} → upstream :${upstreamPort} (config: ${CONFIG_PATH})`,
  );
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

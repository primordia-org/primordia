#!/usr/bin/env bun
// scripts/test-hmr-proxy.ts
//
// Integration tests for the reverse proxy's WebSocket / HMR tunnel.
//
// Creates a minimal in-process proxy server using the EXACT same upgrade handler
// code as scripts/reverse-proxy.ts, then drives it with a raw-TCP mock upstream
// that behaves like a Next.js dev server.  All tests are self-contained — no git
// config, no real Next.js, no network.
//
// Usage: bun scripts/test-hmr-proxy.ts
//
// Exit code: 0 = all passed, 1 = any failure.

import * as http from 'node:http';
import * as net from 'node:net';
import { createHash } from 'node:crypto';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failedLabels: string[] = [];

function pass(label: string) {
  passed++;
  process.stdout.write(`  ✓ ${label}\n`);
}

function fail(label: string, detail?: unknown) {
  failed++;
  const msg = detail != null ? `${label}: ${detail}` : label;
  failedLabels.push(msg);
  process.stderr.write(`  ✗ ${msg}\n`);
}

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) pass(label); else fail(label, detail);
}

function timeout<T>(ms: number, label: string, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout (${ms} ms): ${label}`)), ms)
    ),
  ]);
}

type TrackedServer = (net.Server | http.Server) & { __testSockets?: Set<net.Socket> };

function trackSocket(server: TrackedServer, socket: net.Socket): void {
  server.__testSockets ??= new Set();
  server.__testSockets.add(socket);
  socket.on('close', () => server.__testSockets?.delete(socket));
}

async function closeTestServer(server: TrackedServer): Promise<void> {
  for (const socket of server.__testSockets ?? []) socket.destroy();
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 250);
    server.close(() => {
      clearTimeout(fallback);
      resolve();
    });
  });
}

// ─── WebSocket helpers ────────────────────────────────────────────────────────

/** Derive the Sec-WebSocket-Accept value (RFC 6455 §4.2.2). */
function wsAccept(key: string): string {
  return createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

/**
 * Build an unmasked WebSocket text frame (server-to-client direction).
 * Payload must be ≤ 125 bytes.
 */
function wsFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length > 125) throw new Error('wsFrame: payload too long for 1-byte length');
  const buf = Buffer.allocUnsafe(2 + payload.length);
  buf[0] = 0x81; // FIN=1, opcode=1 (text)
  buf[1] = payload.length;
  payload.copy(buf, 2);
  return buf;
}

/**
 * Build a masked WebSocket text frame (client-to-server direction).
 * Payload must be ≤ 125 bytes.
 */
function wsFrameMasked(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length > 125) throw new Error('wsFrameMasked: payload too long for 1-byte length');
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const buf = Buffer.allocUnsafe(2 + 4 + payload.length);
  buf[0] = 0x81;
  buf[1] = 0x80 | payload.length; // MASK bit set
  mask.copy(buf, 2);
  for (let i = 0; i < payload.length; i++) buf[6 + i] = payload[i] ^ mask[i % 4];
  return buf;
}

/**
 * Parse one WebSocket text frame (handles both masked and unmasked).
 * Returns null if the buffer is too short.
 */
function wsParseText(buf: Buffer): string | null {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  const len = buf[1] & 0x7f;
  if (len >= 126) return null; // extended-length not needed in tests
  const offset = masked ? 6 : 2;
  if (buf.length < offset + len) return null;
  if (masked) {
    const mask = buf.slice(2, 6);
    return Buffer.from(Array.from({ length: len }, (_, i) => buf[offset + i] ^ mask[i % 4])).toString('utf8');
  }
  return buf.slice(2, 2 + len).toString('utf8');
}

// ─── Mock upstream factory ────────────────────────────────────────────────────

/**
 * Creates a raw TCP server (simulates a Next.js dev server).
 * `handler` is called once per connection with the socket and the buffered HTTP
 * request (everything up to and including the first \r\n\r\n).
 */
function mockUpstreamServer(
  handler: (socket: net.Socket, reqHeaders: Buffer) => void,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      trackSocket(server as TrackedServer, socket);
      socket.on('error', () => {}); // silence individual socket errors in tests
      let acc = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        acc = Buffer.concat([acc, chunk]);
        const end = acc.indexOf('\r\n\r\n');
        if (end !== -1) {
          socket.off('data', onData);
          handler(socket, acc.slice(0, end + 4));
          // Any bytes after the header delimitier stay in the socket stream
          // (net.Socket does not buffer past what we've read here).
        }
      };
      socket.on('data', onData);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      if (addr) resolve({ server, port: addr.port }); else reject(new Error('no address'));
    });
  });
}

/** Standard 101 upgrade response for a given client key. */
function upgradeResponse(clientKey: string): string {
  return (
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${wsAccept(clientKey)}\r\n` +
    '\r\n'
  );
}

/** Extract the Sec-WebSocket-Key value from a raw HTTP request string. */
function extractWsKey(reqBuf: Buffer): string {
  const m = reqBuf.toString('binary').match(/Sec-WebSocket-Key:\s*([A-Za-z0-9+/=]+)/i);
  return m?.[1]?.trim() ?? '';
}

// ─── Proxy server (mirrors the WebSocket upgrade logic from reverse-proxy.ts) ──
//
// Uses a raw net.Server with the same raw-TCP-tunnel approach as the production
// proxy. Historical Bun 1.3 bugs made the simpler http.Server upgrade proxy
// unreliable: http.ClientRequest emitted 'response' instead of 'upgrade' for
// upstream 101 responses, and writes to the http.Server upgrade socket could be
// reported as successful while never reaching the browser. The Bun 1.4 probes
// below now cover those old failures directly; keep these production-tunnel
// tests focused on the still-deployed implementation.
//
// Any divergence from the real proxy's handleWsUpgrade() is a test gap.

function createProxyServer(
  targetPort: number,
): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer((rawSocket) => {
    trackSocket(server as TrackedServer, rawSocket);
    rawSocket.pause();
    let buf = Buffer.alloc(0);

    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) { rawSocket.resume(); return; }

      rawSocket.removeListener('data', onData);

      const isWsUpgrade = /upgrade:\s*websocket/i.test(buf.slice(0, headerEnd).toString('binary'));
      if (!isWsUpgrade) {
        // Tests only send WS upgrade requests; respond with a plain 200 for
        // any accidental non-upgrade connections so they don't hang.
        rawSocket.write('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nproxy');
        rawSocket.destroy();
        return;
      }

      rawSocket.on('error', () => upstreamSocket.destroy());

      const upstreamSocket = net.createConnection(targetPort, '127.0.0.1');
      upstreamSocket.on('connect', () => {
        upstreamSocket.write(buf); // forward the upgrade request as-is
        upstreamSocket.once('data', (firstChunk: Buffer) => {
          const firstLine = firstChunk.slice(0, 20).toString('binary');
          if (!firstLine.startsWith('HTTP/1.1 101') && !firstLine.startsWith('HTTP/1.0 101')) {
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
          upstreamSocket.unshift(firstChunk);
          rawSocket.pipe(upstreamSocket);
          upstreamSocket.pipe(rawSocket);
          upstreamSocket.on('error', () => rawSocket.destroy());
          rawSocket.resume();
        });
      });
      upstreamSocket.on('error', (err) => {
        console.error(`[test-proxy] upstream error:`, err.message);
        if (!rawSocket.destroyed) rawSocket.destroy();
      });
    };

    rawSocket.on('data', onData);
    rawSocket.resume();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      if (addr) resolve({ server, port: addr.port }); else reject(new Error('no address'));
    });
  });
}

/**
 * Minimal http.Server upgrade proxy used only to probe Bun's historical 1.3
 * upgrade bugs. This is intentionally much smaller than the production proxy:
 * it forwards one WebSocket upgrade to one upstream via http.request().
 */
function createHttpUpgradeProxyServer(
  targetPort: number,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  server.on('connection', (socket) => trackSocket(server as TrackedServer, socket));
  server.on('upgrade', (clientReq, clientSocket) => {
    const upstreamReq = http.request({
      host: '127.0.0.1',
      port: targetPort,
      path: clientReq.url,
      headers: clientReq.headers,
    });

    upstreamReq.on('response', (res) => {
      fail('http.request must not emit response for upstream 101', `status=${res.statusCode}`);
      clientSocket.destroy();
    });

    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      clientSocket.write(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`);
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) clientSocket.write(`${name}: ${item}\r\n`);
        } else if (value != null) {
          clientSocket.write(`${name}: ${value}\r\n`);
        }
      }
      clientSocket.write('\r\n');
      if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      clientSocket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.on('error', () => clientSocket.destroy());
    });

    upstreamReq.on('error', () => clientSocket.destroy());
    upstreamReq.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      if (addr) resolve({ server, port: addr.port }); else reject(new Error('no address'));
    });
  });
}

// ─── Client helpers ───────────────────────────────────────────────────────────

/**
 * Connects a raw TCP socket to `port` and sends a WebSocket upgrade request.
 * Accumulates data until the response headers end (\r\n\r\n) then resolves.
 * Any data after the headers (e.g. bundled WebSocket frames) is in `rest`.
 */
function wsConnect(
  port: number,
  path = '/_next/webpack-hmr',
): Promise<{ socket: net.Socket; headers: string; rest: Buffer; key: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, '127.0.0.1');
    socket.on('error', reject);
    socket.once('connect', () => {
      const key = Buffer.from(String(Math.random())).toString('base64').slice(0, 22) + '==';
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://127.0.0.1:${port}\r\n` +
        `\r\n`,
      );
      let acc = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        acc = Buffer.concat([acc, chunk]);
        const end = acc.indexOf('\r\n\r\n');
        if (end !== -1) {
          socket.off('data', onData);
          resolve({
            socket,
            headers: acc.slice(0, end + 4).toString('ascii'),
            rest: acc.slice(end + 4),
            key,
          });
        }
      };
      socket.on('data', onData);
    });
    setTimeout(() => reject(new Error('wsConnect timeout')), 5000);
  });
}

/** Wait for the next data event from a socket (with timeout). */
function nextChunk(socket: net.Socket, ms = 2000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off('data', handler);
      reject(new Error(`nextChunk timeout after ${ms} ms`));
    }, ms);
    const handler = (chunk: Buffer) => { clearTimeout(t); resolve(chunk); };
    socket.once('data', handler);
  });
}

/** Wait for socket close event (with timeout). */
function waitClose(socket: net.Socket, ms = 2000): Promise<void> {
  if ((socket as net.Socket).destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`waitClose timeout after ${ms} ms`)), ms);
    socket.once('close', () => { clearTimeout(t); resolve(); });
  });
}

// ─── Individual tests ─────────────────────────────────────────────────────────

async function t0_bunHttpRequestEmitsUpgradeFor101(): Promise<void> {
  console.log('\n▶ T0: Bun HTTP client emits upgrade, not response, for upstream 101');
  const sentinel = 'bun14-client-upgrade-head';
  const upstream = http.createServer();
  upstream.on('connection', (socket) => trackSocket(upstream as TrackedServer, socket));
  upstream.on('upgrade', (req, socket) => {
    const key = String(req.headers['sec-websocket-key'] ?? '');
    socket.write(upgradeResponse(key));
    socket.write(wsFrame(sentinel));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  const upstreamPort = (upstream.address() as net.AddressInfo).port;

  try {
    const result = await timeout(3000, 'http.request upgrade event', new Promise<{
      sawUpgrade: boolean;
      sawResponse: boolean;
      headText: string | null;
    }>((resolve, reject) => {
      let sawResponse = false;
      const req = http.request({
        host: '127.0.0.1',
        port: upstreamPort,
        path: '/_next/webpack-hmr',
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'dGVzdGtleQ==',
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('response', () => {
        sawResponse = true;
        resolve({ sawUpgrade: false, sawResponse, headText: null });
      });
      req.on('upgrade', (_res, socket, head) => {
        const headText = wsParseText(head);
        socket.destroy();
        resolve({ sawUpgrade: true, sawResponse, headText });
      });
      req.on('error', reject);
      req.end();
    }));

    assert(result.sawUpgrade, 'http.request emitted upgrade for 101 Switching Protocols');
    assert(!result.sawResponse, 'http.request did not emit response for 101 Switching Protocols');
    assert(result.headText === sentinel, `upstream head preserved on upgrade event: "${result.headText}"`);
  } finally {
    await closeTestServer(upstream);
  }
}

async function t0_bunHttpServerUpgradeSocketWritesReachClient(): Promise<void> {
  console.log('\n▶ T0b: Bun http.Server upgrade socket writes reach client through minimal proxy');
  const sentinel = 'bun14-http-upgrade-proxy-push';
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    sock.write(wsFrame(sentinel));
    sock.on('data', () => {});
  });
  const { server: proxySrv, port: proxyPort } = await createHttpUpgradeProxyServer(upPort);
  try {
    const { socket, headers, rest } = await timeout(3000, 'connect through minimal http proxy', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), 'minimal http proxy delivered 101 to browser');
    const frameData = rest.length >= 2 ? rest : await timeout(2000, 'minimal http proxy HMR push', nextChunk(socket));
    assert(wsParseText(frameData) === sentinel, `http.Server upgrade socket write reached browser: "${wsParseText(frameData)}"`);
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t1_basicBidirectionalFlow(): Promise<void> {
  console.log('\n▶ T1: Basic WebSocket upgrade + bidirectional data flow');
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    // Echo any frames received back to the client.
    sock.on('data', (d) => sock.write(d));
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers } = await timeout(3000, 'connect', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), '101 Switching Protocols received from proxy');
    assert(headers.includes('Sec-WebSocket-Accept'), 'Sec-WebSocket-Accept forwarded to client');

    // Browser → upstream → browser echo.
    const msg = 'hmr-hello';
    socket.write(wsFrameMasked(msg));
    const echoData = await timeout(2000, 'echo', nextChunk(socket));
    assert(wsParseText(echoData) === msg, `echo round-trip: "${wsParseText(echoData)}" === "${msg}"`);

    // Verify 'upgrade' header is in the 101 response (required by the WebSocket spec).
    assert(
      headers.toLowerCase().includes('upgrade: websocket'),
      'Upgrade: websocket header present in 101 response',
    );

    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t2_upstreamInitiatedPush(): Promise<void> {
  console.log('\n▶ T2: Upstream-initiated HMR push (upstream → browser data flow)');
  const hmrMsg = 'hmr-initial-state';
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    // Push an HMR frame immediately (without waiting for a client message).
    sock.write(wsFrame(hmrMsg));
    sock.on('data', () => {}); // drain browser pings
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers, rest } = await timeout(3000, 'connect', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), '101 received');

    // The push may arrive bundled with the headers (in `rest`) or in the next chunk.
    const frameData = rest.length >= 2
      ? rest
      : await timeout(2000, 'HMR push', nextChunk(socket));

    assert(
      wsParseText(frameData) === hmrMsg,
      `upstream-initiated push received by browser: "${wsParseText(frameData)}"`,
    );
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t3_upstreamHeadBundledWith101(): Promise<void> {
  console.log('\n▶ T3: upstreamHead — WebSocket frame bundled in same TCP segment as 101 headers');
  // Regression test for the "swap backwards unshift calls" bug (2026-04-09 changelog).
  // If upstreamHead data is unshifted into the WRONG socket, it loops back to the
  // upstream instead of reaching the browser — HMR never fires.
  const sentinel = 'sentinel-upstreamHead';
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    // Deliberately concatenate 101 headers + WebSocket frame into a single write
    // so they arrive in the same TCP segment on the proxy side (upstreamHead = frame).
    sock.write(Buffer.concat([Buffer.from(upgradeResponse(key)), wsFrame(sentinel)]));
    sock.on('data', () => {}); // must drain to keep the connection open
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers, rest } = await timeout(3000, 'connect', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), '101 received');

    // Accumulate until we have a complete frame.
    let acc = rest;
    while (acc.length < 2 || (acc.length < 2 + (acc[1] & 0x7f))) {
      try {
        acc = Buffer.concat([acc, await timeout(2000, 'more data', nextChunk(socket))]);
      } catch {
        break;
      }
    }

    assert(
      wsParseText(acc) === sentinel,
      `upstreamHead frame reaches browser (not looped back): "${wsParseText(acc)}"`,
    );
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t4_browserToUpstreamDirection(): Promise<void> {
  console.log('\n▶ T4: Browser → upstream data direction (client sends frames to dev server)');
  let upstreamReceived: string | null = null;
  const browserMsg = 'browser-to-upstream-msg';
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    // Capture the first frame arriving from the browser (via proxy).
    sock.once('data', (d) => { upstreamReceived = wsParseText(d); });
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers } = await timeout(3000, 'connect', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), '101 received');

    socket.write(wsFrameMasked(browserMsg));
    // Give the proxy time to forward the frame to the upstream.
    await new Promise<void>((r) => setTimeout(r, 300));

    assert(upstreamReceived === browserMsg, `browser frame received by upstream: "${upstreamReceived}"`);
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t5_upstreamClosePropagatesToBrowser(): Promise<void> {
  console.log('\n▶ T5: Upstream close propagates to browser socket');
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    // Close the upstream after a brief delay (simulates dev server crash / restart).
    setTimeout(() => sock.destroy(), 150);
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket } = await timeout(3000, 'connect', wsConnect(proxyPort));
    await timeout(2000, 'browser socket closes after upstream close', waitClose(socket));
    pass('browser socket closed when upstream closed');
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t6_browserClosePropagatesToUpstream(): Promise<void> {
  console.log('\n▶ T6: Browser close propagates to upstream socket');
  let upstreamClosed = false;
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    sock.on('close', () => { upstreamClosed = true; });
    sock.on('data', () => {}); // drain
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket } = await timeout(3000, 'connect', wsConnect(proxyPort));
    await new Promise<void>((r) => setTimeout(r, 150));
    socket.destroy();
    await new Promise<void>((r) => setTimeout(r, 300));
    assert(upstreamClosed, 'upstream socket closed when browser disconnected');
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t7_upstreamConnectionRefused(): Promise<void> {
  console.log('\n▶ T7: Upstream connection refused — proxy must not hang the browser');
  // Use a port that nothing is listening on.
  const deadPort = 59998;
  const { server: proxySrv, port: proxyPort } = await createProxyServer(deadPort);
  try {
    // Connect to the proxy and send the upgrade request.
    const socket = net.createConnection(proxyPort, '127.0.0.1');
    await new Promise<void>((r) => socket.once('connect', r));
    const key = 'dGVzdGtleWZvcnByb3h5dGVzdA==';
    socket.write(
      `GET /_next/webpack-hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    // The proxy should close the socket rather than leaving it hanging.
    await timeout(3000, 'socket closed after upstream refused', waitClose(socket));
    pass('socket closed promptly when upstream refused connection');
  } finally {
    await closeTestServer(proxySrv);
  }
}

async function t8_non101UpstreamResponse(): Promise<void> {
  console.log('\n▶ T8: Upstream returns non-101 (e.g. 400) — proxy must send 502 or close');
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock) => {
    // Return a plain HTTP error instead of upgrading.
    sock.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    sock.destroy();
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const socket = net.createConnection(proxyPort, '127.0.0.1');
    await new Promise<void>((r) => socket.once('connect', r));
    const key = 'dGVzdGtleWZvcnByb3h5dGVzdA==';
    socket.write(
      `GET /_next/webpack-hmr HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );

    // Collect whatever the proxy sends back before closing.
    let response = '';
    socket.on('data', (d) => { response += d.toString('ascii'); });
    await timeout(3000, 'proxy responds to non-101 upstream', waitClose(socket));

    const sent502 = response.includes('502');
    const closedWithoutData = response.length === 0;
    assert(
      sent502 || closedWithoutData,
      `proxy returned 502 or closed cleanly on non-101 upstream (got502=${sent502}, empty=${closedWithoutData})`,
    );
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t9_concurrentConnections(): Promise<void> {
  console.log('\n▶ T9: Concurrent WebSocket connections (5 simultaneous)');
  const N = 5;
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    sock.on('data', (d) => sock.write(d)); // echo
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const clients = await Promise.all(
      Array.from({ length: N }, () => timeout(4000, 'concurrent connect', wsConnect(proxyPort)))
    );
    let ok = 0;
    await Promise.all(clients.map(async ({ socket }, i) => {
      const msg = `concurrent-${i}`;
      socket.write(wsFrameMasked(msg));
      try {
        const data = await timeout(2000, `echo ${i}`, nextChunk(socket));
        if (wsParseText(data) === msg) ok++;
      } catch (e) {
        fail(`concurrent-${i} echo`, e);
      }
      socket.destroy();
    }));
    assert(ok === N, `all ${N} concurrent connections echoed correctly (${ok}/${N})`);
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t10_previewPathRouting(): Promise<void> {
  console.log('\n▶ T10: Preview path routing — /preview/{sessionId}/_next/webpack-hmr');
  // The proxy's `server.on('upgrade', …)` uses previewMatch[1] (the sessionId)
  // to pick the target port.  Here we verify the path is forwarded unchanged.
  const expectedPath = '/preview/abc123/_next/webpack-hmr';
  let receivedPath = '';

  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const pathMatch = req.toString().match(/^GET (\S+) HTTP/);
    receivedPath = pathMatch?.[1] ?? '';
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    sock.on('data', () => {});
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers } = await timeout(3000, 'connect', wsConnect(proxyPort, expectedPath));
    assert(headers.startsWith('HTTP/1.1 101'), '101 received for preview path');
    assert(
      receivedPath === expectedPath,
      `path forwarded unchanged to upstream: "${receivedPath}" === "${expectedPath}"`,
    );
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

async function t11_multiFrameSession(): Promise<void> {
  console.log('\n▶ T11: Multi-frame HMR session (many messages both directions)');
  const ROUNDS = 10;
  const { server: upSrv, port: upPort } = await mockUpstreamServer((sock, req) => {
    const key = extractWsKey(req);
    sock.write(upgradeResponse(key));
    // Server sends a frame every time it receives one (echo).
    sock.on('data', (d) => sock.write(d));
  });
  const { server: proxySrv, port: proxyPort } = await createProxyServer(upPort);
  try {
    const { socket, headers } = await timeout(3000, 'connect', wsConnect(proxyPort));
    assert(headers.startsWith('HTTP/1.1 101'), '101 received');

    let received = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const msg = `round-${i}`;
      socket.write(wsFrameMasked(msg));
      try {
        const data = await timeout(2000, `round ${i}`, nextChunk(socket));
        if (wsParseText(data) === msg) received++;
      } catch {
        break;
      }
    }
    assert(
      received === ROUNDS,
      `all ${ROUNDS} round-trip messages echoed (${received}/${ROUNDS})`,
    );
    socket.destroy();
  } finally {
    await closeTestServer(upSrv);
    await closeTestServer(proxySrv);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const _g = globalThis as unknown as { Bun?: { version: string } };
const runtime =
  typeof _g.Bun !== 'undefined'
    ? `Bun ${_g.Bun!.version}`
    : `Node.js ${process.version}`;

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  HMR / WebSocket proxy integration tests');
  console.log(`  Runtime: ${runtime}`);
  console.log('═══════════════════════════════════════════════════════');

  const tests = [
    t0_bunHttpRequestEmitsUpgradeFor101,
    t0_bunHttpServerUpgradeSocketWritesReachClient,
    t1_basicBidirectionalFlow,
    t2_upstreamInitiatedPush,
    t3_upstreamHeadBundledWith101,
    t4_browserToUpstreamDirection,
    t5_upstreamClosePropagatesToBrowser,
    t6_browserClosePropagatesToUpstream,
    t7_upstreamConnectionRefused,
    t8_non101UpstreamResponse,
    t9_concurrentConnections,
    t10_previewPathRouting,
    t11_multiFrameSession,
  ];

  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      fail(t.name, err instanceof Error ? err.message : String(err));
    }
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failedLabels.length) {
    console.error('\n  Failed:');
    for (const l of failedLabels) console.error(`    • ${l}`);
  }
  console.log('───────────────────────────────────────────────────────');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

import { spawn } from 'child_process';
import { once } from 'events';
import * as path from 'path';
import { listCliProtocolMethods, type CliCommandDef, type CliProtocolMethodDef } from '@/lib/tiny-cli';

export interface CoreProtocolServeOptions {
  host: string;
  port: number;
  token?: string;
  commandPath?: string;
}

type JsonRecord = Record<string, unknown>;

interface CoreProtocolRequest {
  id?: string | number;
  method?: string;
  params?: {
    args?: string[];
    options?: Record<string, string | boolean | number | null | undefined>;
    cwd?: string;
  };
}

interface ActiveRun {
  child: ReturnType<typeof spawn>;
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

function isAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) return true;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${token}`;
}

function methodMap(root: CliCommandDef): Map<string, CliProtocolMethodDef> {
  return new Map(listCliProtocolMethods(root).map((method) => [method.method, method]));
}

function optionToArg(name: string, value: string | boolean | number | null | undefined): string[] {
  if (value === undefined || value === null || value === false) return [];
  if (value === true) return [`--${name}`];
  return [`--${name}`, String(value)];
}

function buildArgv(method: CliProtocolMethodDef, params: CoreProtocolRequest['params'] = {}): string[] {
  const argv = [...method.commandPath];
  for (const [name, value] of Object.entries(params.options ?? {})) argv.push(...optionToArg(name, value));
  argv.push(...(params.args ?? []).map(String));
  return argv;
}

function normalizeCwd(rawCwd: unknown): string | undefined {
  if (typeof rawCwd !== 'string' || rawCwd.trim() === '') return undefined;
  return path.resolve(rawCwd);
}

function spawnCli(argv: string[], cwd: string | undefined, commandPath: string): ReturnType<typeof spawn> {
  return spawn(process.execPath, [commandPath, ...argv], {
    cwd: cwd ?? process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runBuffered(argv: string[], cwd: string | undefined, commandPath: string): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  const child = spawnCli(argv, cwd, commandPath);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const [code] = await once(child, 'close') as [number | null];
  return {
    ok: code === 0,
    code,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

function parseRequestBody(value: unknown): CoreProtocolRequest {
  if (!value || typeof value !== 'object') throw new Error('request body must be a JSON object');
  return value as CoreProtocolRequest;
}

function resolveProtocolRequest(root: CliCommandDef, value: unknown): { request: CoreProtocolRequest; method: CliProtocolMethodDef; argv: string[]; cwd: string | undefined } {
  const request = parseRequestBody(value);
  if (typeof request.method !== 'string' || !request.method) throw new Error('method is required');
  const method = methodMap(root).get(request.method);
  if (!method) throw new Error(`Unknown Primordia Core method: ${request.method}`);
  return {
    request,
    method,
    argv: buildArgv(method, request.params),
    cwd: normalizeCwd(request.params?.cwd),
  };
}

function sendWs(ws: Bun.ServerWebSocket<{ authorized: boolean; active: Map<string | number, ActiveRun> }>, value: JsonRecord): void {
  ws.send(JSON.stringify(value));
}

export function serveCoreProtocol(root: CliCommandDef, options: CoreProtocolServeOptions): void {
  const commandPath = options.commandPath ?? path.resolve('scripts/primordia.ts');
  const methods = listCliProtocolMethods(root);
  const server = Bun.serve<{ authorized: boolean; active: Map<string | number, ActiveRun> }>({
    hostname: options.host,
    port: options.port,
    fetch: async (request, serverInstance) => {
      const url = new URL(request.url);
      if (url.pathname === '/rpc' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const authorized = isAuthorized(request, options.token);
        if (!authorized) return jsonResponse({ ok: false, error: 'unauthorized' }, { status: 401 });
        const upgraded = serverInstance.upgrade(request, { data: { authorized, active: new Map() } });
        return upgraded ? undefined : jsonResponse({ ok: false, error: 'websocket upgrade failed' }, { status: 400 });
      }

      if (!isAuthorized(request, options.token)) return jsonResponse({ ok: false, error: 'unauthorized' }, { status: 401 });
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/schema')) {
        return jsonResponse({
          protocol: 'primordia-core.v1',
          transports: ['POST /rpc', 'WebSocket /rpc'],
          methods,
        });
      }
      if (request.method === 'POST' && url.pathname === '/rpc') {
        try {
          const { method, argv, cwd } = resolveProtocolRequest(root, await request.json());
          const result = await runBuffered(argv, cwd, commandPath);
          return jsonResponse({ method: method.method, argv, ...result }, { status: result.ok ? 200 : 500 });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return jsonResponse({ ok: false, error: message }, { status: 400 });
        }
      }
      return jsonResponse({ ok: false, error: 'not found' }, { status: 404 });
    },
    websocket: {
      message(ws, rawMessage) {
        let payload: CoreProtocolRequest & { action?: string };
        try {
          payload = JSON.parse(String(rawMessage));
        } catch {
          sendWs(ws, { type: 'error', error: 'message must be JSON' });
          return;
        }

        if (payload.action === 'abort') {
          const id = payload.id;
          if (id === undefined) return sendWs(ws, { type: 'error', error: 'abort requires id' });
          const active = ws.data.active.get(id);
          if (!active) return sendWs(ws, { id, type: 'error', error: 'no active request for id' });
          active.child.kill('SIGTERM');
          return;
        }

        let resolved: ReturnType<typeof resolveProtocolRequest>;
        try {
          resolved = resolveProtocolRequest(root, payload);
        } catch (error) {
          sendWs(ws, { id: payload.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
          return;
        }

        const id = payload.id ?? crypto.randomUUID();
        const child = spawnCli(resolved.argv, resolved.cwd, commandPath);
        ws.data.active.set(id, { child });
        sendWs(ws, { id, type: 'start', method: resolved.method.method, argv: resolved.argv, pid: child.pid ?? null });
        child.stdout?.on('data', (chunk) => sendWs(ws, { id, type: 'stdout', data: Buffer.from(chunk).toString('utf8') }));
        child.stderr?.on('data', (chunk) => sendWs(ws, { id, type: 'stderr', data: Buffer.from(chunk).toString('utf8') }));
        child.on('error', (error) => sendWs(ws, { id, type: 'error', error: error.message }));
        child.on('close', (code, signal) => {
          ws.data.active.delete(id);
          sendWs(ws, { id, type: 'exit', ok: code === 0, code, signal });
        });
      },
      close(ws) {
        for (const { child } of ws.data.active.values()) child.kill('SIGTERM');
        ws.data.active.clear();
      },
    },
  });

  console.log(`Primordia Core protocol server listening on http://${server.hostname}:${server.port}`);
  console.log('Schema: GET /schema. RPC: POST /rpc or WebSocket /rpc.');
}

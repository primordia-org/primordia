import { spawn } from 'child_process';
import { once } from 'events';
import * as path from 'path';
import { resolvePrimordiaCliKey } from '@/lib/cli-keys';
import { listCliProtocolMethods, type CliCommandDef, type CliProtocolMethodDef } from '@/lib/tiny-cli';

export interface CoreProtocolServeOptions {
  host: string;
  port: number;
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

interface CoreAuthContext {
  userId: string;
  aesKeyJwkJson: string;
}

interface RunEvent extends JsonRecord {
  type: string;
  ts: number;
}

interface ActiveRun {
  id: string;
  token: string;
  method: string;
  argv: string[];
  child: ReturnType<typeof spawn>;
  events: RunEvent[];
  done: boolean;
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
}

const encoder = new TextEncoder();
const RUN_TTL_MS = 15 * 60 * 1000;

function corsHeaders(extra: HeadersInit = {}): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    ...extra,
  };
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: corsHeaders({
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    }),
  });
}

function sseChunk(event: RunEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

async function authorize(request: Request): Promise<CoreAuthContext> {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Authorization header must be Bearer <web-api-key>.');
  const resolved = await resolvePrimordiaCliKey(match[1], 'web');
  return { userId: resolved.userId, aesKeyJwkJson: resolved.aesKeyJwkJson };
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

function spawnCli(argv: string[], cwd: string | undefined, commandPath: string, auth: CoreAuthContext): ReturnType<typeof spawn> {
  return spawn(process.execPath, [commandPath, ...argv], {
    cwd: cwd ?? process.cwd(),
    env: {
      ...process.env,
      PRIMORDIA_CORE_USER_ID: auth.userId,
      PRIMORDIA_CORE_AES_KEY: auth.aesKeyJwkJson,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runBuffered(argv: string[], cwd: string | undefined, commandPath: string, auth: CoreAuthContext): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  const child = spawnCli(argv, cwd, commandPath, auth);
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

function addRunEvent(run: ActiveRun, event: RunEvent): void {
  run.events.push(event);
  const chunk = sseChunk(event);
  for (const client of run.clients) client.enqueue(chunk);
}

function finishRun(run: ActiveRun): void {
  run.done = true;
  for (const client of run.clients) client.close();
  run.clients.clear();
}

function createRun(root: CliCommandDef, commandPath: string, requestBody: unknown, auth: CoreAuthContext, activeRuns: Map<string, ActiveRun>): ActiveRun {
  const resolved = resolveProtocolRequest(root, requestBody);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const child = spawnCli(resolved.argv, resolved.cwd, commandPath, auth);
  const run: ActiveRun = {
    id,
    token,
    method: resolved.method.method,
    argv: resolved.argv,
    child,
    events: [],
    done: false,
    clients: new Set(),
  };
  activeRuns.set(id, run);

  addRunEvent(run, { type: 'start', ts: Date.now(), id, method: run.method, argv: run.argv, pid: child.pid ?? null });
  child.stdout?.on('data', (chunk) => addRunEvent(run, { type: 'stdout', ts: Date.now(), id, data: Buffer.from(chunk).toString('utf8') }));
  child.stderr?.on('data', (chunk) => addRunEvent(run, { type: 'stderr', ts: Date.now(), id, data: Buffer.from(chunk).toString('utf8') }));
  child.on('error', (error) => addRunEvent(run, { type: 'error', ts: Date.now(), id, error: error.message }));
  child.on('close', (code, signal) => {
    addRunEvent(run, { type: 'exit', ts: Date.now(), id, ok: code === 0, code, signal });
    finishRun(run);
    setTimeout(() => activeRuns.delete(id), RUN_TTL_MS).unref?.();
  });
  return run;
}

function streamRun(run: ActiveRun): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of run.events) controller.enqueue(sseChunk(event));
      if (run.done) {
        controller.close();
        return;
      }
      run.clients.add(controller);
    },
    cancel() {
      // The command keeps running after an SSE client disconnects. Call /runs/:id/abort to stop it.
    },
  });
  return new Response(stream, {
    headers: corsHeaders({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    }),
  });
}

export function serveCoreProtocol(root: CliCommandDef, options: CoreProtocolServeOptions): void {
  const commandPath = options.commandPath ?? path.resolve('scripts/primordia.ts');
  const methods = listCliProtocolMethods(root);
  const activeRuns = new Map<string, ActiveRun>();
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

      try {
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/schema')) {
          await authorize(request);
          return jsonResponse({
            protocol: 'primordia-core.v1',
            transports: ['POST /rpc', 'POST /runs + GET /runs/:id/events'],
            auth: 'Bearer web API key from /settings/api-keys',
            methods,
          });
        }

        if (request.method === 'POST' && url.pathname === '/rpc') {
          const auth = await authorize(request);
          const { method, argv, cwd } = resolveProtocolRequest(root, await request.json());
          const result = await runBuffered(argv, cwd, commandPath, auth);
          return jsonResponse({ method: method.method, argv, ...result }, { status: result.ok ? 200 : 500 });
        }

        if (request.method === 'POST' && url.pathname === '/runs') {
          const auth = await authorize(request);
          const run = createRun(root, commandPath, await request.json(), auth, activeRuns);
          return jsonResponse({
            ok: true,
            id: run.id,
            method: run.method,
            argv: run.argv,
            eventUrl: `/runs/${run.id}/events?token=${encodeURIComponent(run.token)}`,
          });
        }

        const eventsMatch = url.pathname.match(/^\/runs\/([^/]+)\/events$/);
        if (request.method === 'GET' && eventsMatch) {
          const run = activeRuns.get(eventsMatch[1]);
          if (!run) return jsonResponse({ ok: false, error: 'run not found' }, { status: 404 });
          if (url.searchParams.get('token') !== run.token) return jsonResponse({ ok: false, error: 'unauthorized' }, { status: 401 });
          return streamRun(run);
        }

        const abortMatch = url.pathname.match(/^\/runs\/([^/]+)\/abort$/);
        if (request.method === 'POST' && abortMatch) {
          await authorize(request);
          const run = activeRuns.get(abortMatch[1]);
          if (!run) return jsonResponse({ ok: false, error: 'run not found' }, { status: 404 });
          if (!run.done) run.child.kill('SIGTERM');
          return jsonResponse({ ok: true });
        }

        return jsonResponse({ ok: false, error: 'not found' }, { status: 404 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.toLowerCase().includes('authorization') || message.toLowerCase().includes('restricted to') ? 401 : 400;
        return jsonResponse({ ok: false, error: message }, { status });
      }
    },
  });

  console.log(`Primordia Core protocol server listening on http://${server.hostname}:${server.port}`);
  console.log('Schema: GET /schema. RPC: POST /rpc. Streaming: POST /runs, then GET /runs/:id/events.');
}

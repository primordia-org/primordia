import { spawn } from 'child_process';
import { once } from 'events';
import * as path from 'path';
import { resolvePrimordiaCliKey } from '@/lib/cli-keys';
import { getProcessStatusReport } from '@/lib/process-manager';
import { listCliApiRoutes, type CliApiRouteDef } from '@/lib/tiny-cli';
import { mainCommand } from '@/scripts/primordia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path?: string[] }> };
type CoreOptions = Record<string, string | boolean | undefined>;

interface ParsedBody {
  args: string[];
  options: CoreOptions;
}

interface AuthContext {
  userId: string;
  aesKeyJwkJson: string;
}

type JsonSchema = Record<string, unknown>;
type OpenApiParameter = {
  name: string;
  in: 'path' | 'query';
  required?: boolean;
  schema: JsonSchema;
  description?: string;
};

const encoder = new TextEncoder();
const CORE_ROUTES = listCliApiRoutes(mainCommand);

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, init);
}

async function authorize(request: Request): Promise<AuthContext> {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Authorization header must be Bearer <web-api-key>.');
  const resolved = await resolvePrimordiaCliKey(match[1], 'web');
  return { userId: resolved.userId, aesKeyJwkJson: resolved.aesKeyJwkJson };
}

function parseValue(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

async function parseRequestBody(request: Request): Promise<ParsedBody> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const args: string[] = [];
    const options: CoreOptions = {};
    for (const [key, value] of form.entries()) {
      if (typeof value !== 'string') continue;
      if (key === 'args') {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed)) args.push(...parsed.map(String));
          else args.push(value);
        } catch {
          args.push(value);
        }
      } else if (key === 'request') {
        args.push(value);
      } else {
        options[key] = parseValue(value);
      }
    }
    return { args, options };
  }

  if (!contentType.includes('application/json')) return { args: [], options: {} };
  const body = (await request.json().catch(() => ({}))) as { args?: unknown; options?: Record<string, unknown>; request?: unknown };
  const args = Array.isArray(body.args) ? body.args.map(String) : [];
  if (typeof body.request === 'string') args.unshift(body.request);
  const options: CoreOptions = {};
  for (const [key, value] of Object.entries(body.options ?? {})) {
    if (typeof value === 'string' || typeof value === 'boolean') options[key] = value;
    else if (typeof value === 'number') options[key] = String(value);
  }
  return { args, options };
}

function withQueryOptions(options: CoreOptions, request: Request): CoreOptions {
  const next = { ...options };
  const url = new URL(request.url);
  for (const [key, value] of url.searchParams.entries()) next[key] = parseValue(value);
  return next;
}

function routePatternParts(routePath: string): string[] {
  return routePath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

function matchRoute(requestParts: string[]): { route: CliApiRouteDef; params: Record<string, string> } | null {
  for (const route of CORE_ROUTES) {
    const patternParts = routePatternParts(route.path);
    if (patternParts.length !== requestParts.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const pattern = patternParts[index];
      const actual = requestParts[index];
      const paramMatch = pattern.match(/^\[([^\]]+)\]$/);
      if (paramMatch) params[paramMatch[1]] = decodeURIComponent(actual);
      else if (pattern !== actual) matches = false;
    }
    if (matches) return { route, params };
  }
  return null;
}

function optionToArg(name: string, value: string | boolean | undefined): string[] {
  if (value === undefined || value === false) return [];
  if (value === true) return [`--${name}`];
  return [`--${name}`, value];
}

function hasOption(route: CliApiRouteDef, name: string): boolean {
  return route.options.some((option) => option.name === name || option.alias === name);
}

function resolveThreadCwd(threadId: string): string {
  const report = getProcessStatusReport();
  const worktree = report.worktrees.find((entry) => entry.branch === threadId);
  if (!worktree) throw new Error(`Unknown thread/worktree: ${threadId}`);
  return worktree.path;
}

function buildArgv(route: CliApiRouteDef, params: Record<string, string>, parsed: ParsedBody, request: Request): { argv: string[]; cwd?: string; streaming: boolean } {
  const options = withQueryOptions(parsed.options, request);
  const streaming = route.streaming && options.follow !== false && options.f !== false;
  if (hasOption(route, 'json') && options.json === undefined && !streaming) options.json = true;
  if (route.streaming && hasOption(route, 'follow') && options.follow === undefined && options.f === undefined) options.follow = true;

  const argv = [...route.commandPath];
  for (const [name, value] of Object.entries(options)) argv.push(...optionToArg(name, value));

  const args = [...parsed.args];
  for (const arg of route.arguments) {
    if (route.cwdParam === arg.name) continue;
    const paramValue = params[arg.name];
    if (paramValue && !args.includes(paramValue)) args.unshift(paramValue);
  }
  argv.push(...args);

  const cwdParam = route.cwdParam ? params[route.cwdParam] : undefined;
  return { argv, cwd: cwdParam ? resolveThreadCwd(cwdParam) : undefined, streaming };
}

function spawnCli(argv: string[], cwd: string | undefined, auth: AuthContext) {
  return spawn(process.execPath, [path.join(process.cwd(), 'scripts/primordia.ts'), ...argv], {
    cwd: cwd ?? process.cwd(),
    env: {
      ...process.env,
      PRIMORDIA_CORE_USER_ID: auth.userId,
      PRIMORDIA_CORE_AES_KEY: auth.aesKeyJwkJson,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function openApiPath(routePath: string): string {
  return `/api/core${routePath}`.replace(/\[([^\]]+)\]/g, '{$1}');
}

function routePathParamNames(routePath: string): string[] {
  return [...routePath.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
}

function optionSchema(type: 'boolean' | 'string'): JsonSchema {
  return type === 'boolean' ? { type: 'boolean' } : { type: 'string' };
}

function buildCoreOpenApiSpec(request: Request): Record<string, unknown> {
  const origin = new URL(request.url).origin;
  const paths: Record<string, unknown> = {};

  for (const route of CORE_ROUTES) {
    const pathParamNames = routePathParamNames(route.path);
    const queryParameters: OpenApiParameter[] = route.options.map((option) => ({
      name: option.name,
      in: 'query',
      schema: optionSchema(option.type),
      description: option.alias ? `${option.description} Short alias: -${option.alias}.` : option.description,
    }));
    const pathParameters: OpenApiParameter[] = pathParamNames.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `Value for the ${name} path parameter.`,
    }));
    const requestJsonSchema: JsonSchema = {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'Convenience single request argument, prepended before args when present.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Positional command arguments.' },
        options: {
          type: 'object',
          description: 'Command options. Query parameters with the same names are also accepted.',
          properties: Object.fromEntries(route.options.map((option) => [option.name, optionSchema(option.type)])),
          additionalProperties: { oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }] },
        },
      },
      additionalProperties: false,
    };
    const requestBodyContent: Record<string, unknown> = {
      'application/json': { schema: requestJsonSchema },
    };
    if (route.multipart) {
      requestBodyContent['multipart/form-data'] = {
        schema: {
          type: 'object',
          properties: {
            request: { type: 'string' },
            args: { type: 'string', description: 'JSON-encoded array of positional arguments.' },
            ...Object.fromEntries(route.options.map((option) => [option.name, optionSchema(option.type)])),
          },
        },
      };
    }

    paths[openApiPath(route.path)] = {
      post: {
        operationId: `core_${route.commandPath.join('_').replace(/[^a-zA-Z0-9_]/g, '_')}`,
        summary: route.description,
        description: `Runs \`bun run primordia ${route.commandPath.join(' ')}\` through the Primordia Core route-action API.`,
        tags: ['Primordia Core'],
        security: [{ WebApiKey: [] }],
        parameters: [...pathParameters, ...queryParameters],
        requestBody: {
          required: false,
          content: requestBodyContent,
        },
        responses: {
          200: route.streaming
            ? { description: 'Command output stream.', content: { 'text/plain': { schema: { type: 'string' } } } }
            : { description: 'Command JSON response.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          400: { description: 'Invalid request or command usage.' },
          401: { description: 'Missing or invalid web API key.' },
          404: { description: 'Unknown Core API route.' },
          500: { description: 'Command failed.' },
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Primordia Core API',
      version: '1.0.0',
      description: 'OpenAPI description for Primordia Core route-action endpoints generated from the Primordia CLI command metadata.',
    },
    servers: [{ url: origin, description: 'This Primordia instance' }],
    components: {
      securitySchemes: {
        WebApiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Primordia web API key',
          description: 'Create a revokable web API key in Settings → API Keys and pass it as a Bearer token.',
        },
      },
    },
    paths,
  };
}

async function bufferedResponse(argv: string[], cwd: string | undefined, auth: AuthContext): Promise<Response> {
  const child = spawnCli(argv, cwd, auth);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const [code] = await once(child, 'close') as [number | null];
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

  if (code !== 0) {
    return jsonResponse({ msg: stderr || `Command exited with code ${code ?? 'unknown'}` }, { status: code === 64 ? 400 : 500 });
  }

  try {
    return jsonResponse(JSON.parse(stdout));
  } catch {
    return jsonResponse({ msg: 'Command succeeded but did not print valid JSON.', stdout }, { status: 500 });
  }
}

function streamingResponse(argv: string[], cwd: string | undefined, auth: AuthContext): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawnCli(argv, cwd, auth);
      child.stdout?.on('data', (chunk) => controller.enqueue(Buffer.from(chunk)));
      child.stderr?.on('data', (chunk) => controller.enqueue(Buffer.from(chunk)));
      child.on('error', (error) => controller.enqueue(encoder.encode(`\n[error] ${error.message}\n`)));
      child.on('close', () => controller.close());
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const parts = (await context.params).path ?? [];
  if (parts.length > 0 && parts[0] !== 'schema' && parts[0] !== 'openapi') return jsonResponse({ ok: false, error: 'not found' }, { status: 404 });
  if (parts[0] === 'openapi') return jsonResponse(buildCoreOpenApiSpec(request));
  try {
    await authorize(request);
    return jsonResponse({
      protocol: 'primordia-core.v1',
      style: 'route-actions',
      auth: 'Bearer web API key from /settings/api-keys',
      basePath: '/api/core',
      routes: CORE_ROUTES,
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 401 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authorize(request);
    const parts = (await context.params).path ?? [];
    const matched = matchRoute(parts);
    if (!matched) return jsonResponse({ ok: false, error: 'unknown Core API route' }, { status: 404 });
    const parsed = await parseRequestBody(request);
    const { argv, cwd, streaming } = buildArgv(matched.route, matched.params, parsed, request);
    if (streaming) return streamingResponse(argv, cwd, auth);
    return bufferedResponse(argv, cwd, auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes('authorization') || message.toLowerCase().includes('restricted to') ? 401 : 400;
    return jsonResponse({ ok: false, error: message }, { status });
  }
}

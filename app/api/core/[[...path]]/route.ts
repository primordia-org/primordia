import { spawn } from 'child_process';
import { once } from 'events';
import * as path from 'path';
import { resolvePrimordiaCliKey } from '@/lib/cli-keys';
import { getProcessStatusReport } from '@/lib/process-manager';
import { getPublicOrigin } from '@/lib/public-origin';
import { listCliApiRoutes, type CliApiRouteDef } from '@/lib/tiny-cli';
import { mainCommand } from '@/scripts/primordia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path?: string[] }> };
type CoreOptions = Record<string, string | boolean | undefined>;

interface ParsedBody {
  args: string[];
  options: CoreOptions;
  values: Record<string, string | boolean | undefined>;
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
    const values: Record<string, string | boolean | undefined> = {};
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
      } else if (key === 'options') {
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          for (const [optionKey, optionValue] of Object.entries(parsed)) {
            if (typeof optionValue === 'string' || typeof optionValue === 'boolean') options[optionKey] = optionValue;
            else if (typeof optionValue === 'number') options[optionKey] = String(optionValue);
          }
        } catch {
          // Ignore malformed legacy options payloads; command validation will report missing values as needed.
        }
      } else {
        values[key] = parseValue(value);
      }
    }
    return { args, options, values };
  }

  if (!contentType.includes('application/json')) return { args: [], options: {}, values: {} };
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const args = Array.isArray(body.args) ? body.args.map(String) : [];
  const options: CoreOptions = {};
  for (const [key, value] of Object.entries((body.options as Record<string, unknown> | undefined) ?? {})) {
    if (typeof value === 'string' || typeof value === 'boolean') options[key] = value;
    else if (typeof value === 'number') options[key] = String(value);
  }
  const values: Record<string, string | boolean | undefined> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'args' || key === 'options') continue;
    if (typeof value === 'string' || typeof value === 'boolean') values[key] = value;
    else if (typeof value === 'number') values[key] = String(value);
  }
  return { args, options, values };
}

function withQueryOptions(route: CliApiRouteDef, options: CoreOptions, request: Request): CoreOptions {
  const next = { ...options };
  const url = new URL(request.url);
  for (const option of userFacingOptions(route)) {
    const value = url.searchParams.get(option.name) ?? (option.alias ? url.searchParams.get(option.alias) : null);
    if (value !== null) next[option.name] = parseValue(value);
  }
  return next;
}

function queryValue(request: Request, name: string): string | undefined {
  return new URL(request.url).searchParams.get(name) ?? undefined;
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

function userFacingOptions(route: CliApiRouteDef): CliApiRouteDef['options'] {
  return route.options.filter((option) => option.name !== 'json');
}

function buildArgv(route: CliApiRouteDef, params: Record<string, string>, parsed: ParsedBody, request: Request): { argv: string[]; cwd?: string; streaming: boolean } {
  const options = route.httpMethod === 'GET' ? withQueryOptions(route, parsed.options, request) : { ...parsed.options };
  for (const option of userFacingOptions(route)) {
    const bodyValue = parsed.values[option.name] ?? (option.alias ? parsed.values[option.alias] : undefined);
    if (bodyValue !== undefined) options[option.name] = bodyValue;
  }
  delete options.json;

  const streaming = route.streaming && options.follow !== false && options.f !== false;
  if (hasOption(route, 'json') && !streaming) options.json = true;
  if (route.streaming && hasOption(route, 'follow') && options.follow === undefined && options.f === undefined) options.follow = true;

  for (const option of route.options) {
    if (option.type === 'string' && options[option.name] === '') throw new Error(`--${option.name} requires a value`);
  }

  const argv = [...route.commandPath];
  for (const [name, value] of Object.entries(options)) argv.push(...optionToArg(name, value));

  const args: string[] = [];
  for (const arg of route.arguments) {
    if (route.cwdParam === arg.name) continue;
    const paramValue = params[arg.name];
    if (paramValue) {
      args.push(paramValue);
      continue;
    }
    const bodyValue = parsed.values[arg.name] ?? (route.httpMethod === 'GET' ? queryValue(request, arg.name) : undefined);
    if (bodyValue !== undefined) args.push(String(bodyValue));
  }
  args.push(...parsed.args);
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

function commandTag(route: CliApiRouteDef): string {
  const group = route.commandPath[0] ?? 'core';
  return group === 'status' ? 'status' : group;
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  };
}

function buildCoreOpenApiSpec(request: Request): Record<string, unknown> {
  const basePath = process.env.NEXT_BASE_PATH ?? '';
  const serverUrl = `${getPublicOrigin(request)}${basePath}`;
  const paths: Record<string, unknown> = {};
  const tags = new Map<string, string>();

  for (const route of CORE_ROUTES) {
    const tag = commandTag(route);
    tags.set(tag, `Core API endpoints for \`primordia ${tag}\` commands.`);
    const pathParamNames = routePathParamNames(route.path);
    const options = userFacingOptions(route);
    const queryParameters: OpenApiParameter[] = route.httpMethod === 'GET'
      ? options.map((option) => ({
          name: option.name,
          in: 'query',
          schema: optionSchema(option.type),
          description: option.description,
        }))
      : [];
    const pathParameters: OpenApiParameter[] = pathParamNames.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: `Value for the ${name} path parameter.`,
    }));
    const bodyArguments = route.arguments.filter((arg) => !pathParamNames.includes(arg.name) && route.cwdParam !== arg.name);
    const bodyProperties: Record<string, JsonSchema> = {};
    for (const arg of bodyArguments) {
      bodyProperties[arg.name] = {
        type: 'string',
        description: arg.description,
        ...(arg.valueHint ? { example: arg.valueHint } : {}),
      };
    }
    if (route.httpMethod === 'POST') {
      for (const option of options) {
        bodyProperties[option.name] = {
          ...optionSchema(option.type),
          description: option.description,
        };
      }
    }
    const requiredBodyFields = bodyArguments.filter((arg) => arg.required).map((arg) => arg.name);
    const argumentQueryParameters: OpenApiParameter[] = route.httpMethod === 'GET'
      ? bodyArguments.map((arg) => ({
          name: arg.name,
          in: 'query',
          required: arg.required,
          schema: { type: 'string' },
          description: arg.description,
        }))
      : [];
    const requestBodyContent: Record<string, unknown> = {
      'application/json': {
        schema: {
          type: 'object',
          properties: bodyProperties,
          ...(requiredBodyFields.length > 0 ? { required: requiredBodyFields } : {}),
          additionalProperties: false,
        },
      },
    };
    const hasRequestBody = Object.keys(bodyProperties).length > 0;

    paths[openApiPath(route.path)] = {
      [route.httpMethod.toLowerCase()]: {
        operationId: `core_${route.commandPath.join('_').replace(/[^a-zA-Z0-9_]/g, '_')}`,
        summary: route.commandPath.at(-1) ?? route.path.replace(/^\//, ''),
        description: route.description,
        tags: [tag],
        security: [{ WebApiKey: [] }],
        parameters: [...pathParameters, ...argumentQueryParameters, ...queryParameters],
        ...(route.httpMethod === 'POST' && hasRequestBody
          ? {
              requestBody: {
                required: requiredBodyFields.length > 0,
                content: requestBodyContent,
              },
            }
          : {}),
        responses: {
          200: route.streaming
            ? { description: 'Command output stream.', content: { 'text/plain': { schema: { type: 'string' } } } }
            : { description: 'Command JSON response.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          400: errorResponse('Invalid request or command usage. The msg field contains the command validation error.'),
          401: errorResponse('Missing or invalid web API key.'),
          404: errorResponse('Unknown Core API route.'),
          500: errorResponse('Command failed.'),
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
    servers: [{ url: serverUrl, description: 'This Primordia instance' }],
    tags: [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => ({ name, description })),
    components: {
      securitySchemes: {
        WebApiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Primordia web API key',
          description: 'Create a revokable web API key in Settings → API Keys and pass it as a Bearer token.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            msg: { type: 'string', description: 'Human-readable error message from command validation or execution.' },
          },
          required: ['msg'],
          additionalProperties: false,
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
    let message = stderr;
    if (!message && stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout) as { error?: unknown; msg?: unknown };
        if (typeof parsed.msg === 'string') message = parsed.msg;
        else if (typeof parsed.error === 'string') message = parsed.error;
      } catch {
        message = stdout.trim();
      }
    }
    return jsonResponse({ msg: message || `Command exited with code ${code ?? 'unknown'}` }, { status: code === 64 ? 400 : 500 });
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

async function coreActionResponse(request: Request, parts: string[], method: 'GET' | 'POST'): Promise<Response> {
  try {
    const auth = await authorize(request);
    const matched = matchRoute(parts);
    if (!matched) return jsonResponse({ msg: 'unknown Core API route' }, { status: 404 });
    if (matched.route.httpMethod !== method) {
      return jsonResponse({ msg: `Use ${matched.route.httpMethod} for this Core API route.` }, { status: 405, headers: { allow: matched.route.httpMethod } });
    }
    const parsed = method === 'GET' ? { args: [], options: {}, values: {} } : await parseRequestBody(request);
    const { argv, cwd, streaming } = buildArgv(matched.route, matched.params, parsed, request);
    if (streaming) return streamingResponse(argv, cwd, auth);
    return bufferedResponse(argv, cwd, auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes('authorization') || message.toLowerCase().includes('restricted to') ? 401 : 400;
    return jsonResponse({ msg: message }, { status });
  }
}

export async function GET(request: Request, context: RouteContext) {
  const parts = (await context.params).path ?? [];
  if (parts[0] === 'openapi') return jsonResponse(buildCoreOpenApiSpec(request));
  if (parts.length > 0 && parts[0] !== 'schema') return coreActionResponse(request, parts, 'GET');
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
  const parts = (await context.params).path ?? [];
  return coreActionResponse(request, parts, 'POST');
}

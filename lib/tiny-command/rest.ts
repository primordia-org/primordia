import { Readable, Writable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { CliUsageError, ProcessExit, listCliApiRoutes, type CliApiRouteDef, type CliCommandDef, type CommandContext } from './common';
import { runCli } from './cli';

export interface TinyRestApiOptions {
  command: CliCommandDef;
  protocol: string;
  authDescription: string;
  basePath: string;
  openApiTitle: string;
  openApiDescription: string;
  bearerFormat: string;
  bearerDescription: string;
  authorize(request: Request): Promise<TinyRestAuthContext>;
  createContext(options: TinyRestCreateContextOptions): CommandContext;
  resolveCwd(paramValue: string): string;
  serverUrl(request: Request): string;
}

export type TinyRestRouteContext = { params: Promise<{ path?: string[] }> };
type CoreOptions = Record<string, string | string[] | boolean | undefined>;

interface ParsedBody {
  args: string[];
  options: CoreOptions;
  values: Record<string, string | boolean | undefined>;
}

export interface TinyRestAuthContext {
  env: Record<string, string | undefined>;
}

export interface TinyRestCreateContextOptions {
  cwd?: string;
  auth: TinyRestAuthContext;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadStream;
  abortSignal?: AbortSignal;
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

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, init);
}

function terminalJsonResponse(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('connection', 'close');
  return Response.json(value, { ...init, headers });
}

function parseValue(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

async function parseRequestBody(request: Request, uploadDirOverride?: string): Promise<ParsedBody> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const args: string[] = [];
    const options: CoreOptions = {};
    const values: Record<string, string | boolean | undefined> = {};
    const uploadDir = uploadDirOverride ?? path.join('/tmp', `primordia-core-upload-${crypto.randomUUID()}`);
    let wroteUpload = false;
    for (const [key, value] of form.entries()) {
      if (typeof value !== 'string') {
        const file = value as File;
        if (file.size === 0) continue;
        fs.mkdirSync(uploadDir, { recursive: true });
        let safeName = path.basename(file.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!safeName) safeName = 'attachment';
        const ext = path.extname(safeName);
        const stem = safeName.slice(0, safeName.length - ext.length);
        let candidate = safeName;
        let counter = 1;
        while (fs.existsSync(path.join(uploadDir, candidate))) {
          candidate = `${stem}_${counter}${ext}`;
          counter += 1;
        }
        const filePath = path.join(uploadDir, candidate);
        fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));
        wroteUpload = true;
        const existing = options.attach;
        options.attach = Array.isArray(existing) ? [...existing, filePath] : typeof existing === 'string' ? [existing, filePath] : [filePath];
        continue;
      }
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
      } else if (key === 'attach') {
        const existing = options.attach;
        options.attach = Array.isArray(existing) ? [...existing, value] : typeof existing === 'string' ? [existing, value] : [value];
      } else {
        values[key] = parseValue(value);
      }
    }
    if (!wroteUpload && !uploadDirOverride) {
      try { fs.rmdirSync(uploadDir); } catch { /* non-fatal */ }
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
    const value = url.searchParams.get(option.name);
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

function matchRoute(requestParts: string[], routes: CliApiRouteDef[]): { route: CliApiRouteDef; params: Record<string, string> } | null {
  for (const route of routes) {
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

function optionToArg(name: string, value: string | string[] | boolean | undefined): string[] {
  if (value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => [`--${name}`, entry]);
  if (value === true) return [`--${name}`];
  return [`--${name}`, value];
}

function hasOption(route: CliApiRouteDef, name: string): boolean {
  return route.options.some((option) => option.name === name || option.alias === name);
}

function userFacingOptions(route: CliApiRouteDef): CliApiRouteDef['options'] {
  return route.options.filter((option) => option.name !== 'json');
}

function buildArgv(route: CliApiRouteDef, params: Record<string, string>, parsed: ParsedBody, request: Request, resolveCwd: (paramValue: string) => string): { argv: string[]; cwd?: string; streaming: boolean; ndjson: boolean } {
  const options = route.httpMethod === 'GET' ? withQueryOptions(route, parsed.options, request) : { ...parsed.options };
  if (hasOption(route, 'json')) {
    const jsonValue = new URL(request.url).searchParams.get('json');
    if (jsonValue !== null) options.json = parseValue(jsonValue);
  }
  for (const option of userFacingOptions(route)) {
    const bodyValue = parsed.values[option.name];
    if (bodyValue !== undefined) options[option.name] = option.type === 'string' && typeof bodyValue === 'boolean' ? String(bodyValue) : bodyValue;
  }
  const explicitFollow = options.follow === true || options.f === true;
  if (hasOption(route, 'json') && options.json !== false) options.json = true;
  const ndjson = route.streaming && options.json === true;
  const streaming = route.streaming && (explicitFollow || ndjson);
  if (hasOption(route, 'json') && streaming && !ndjson) delete options.json;

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
  return { argv, cwd: cwdParam ? resolveCwd(cwdParam) : undefined, streaming, ndjson };
}

async function runCliDirect(options: TinyRestApiOptions, argv: string[], cwd: string | undefined, auth: TinyRestAuthContext, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, abortSignal?: AbortSignal): Promise<number> {
  const stdin = Readable.from([]) as NodeJS.ReadStream;
  stdin.isTTY = true;
  try {
    await runCli(options.command, argv, options.createContext({ cwd, auth, stdout, stderr, stdin, abortSignal }));
    return 0;
  } catch (error) {
    if (error instanceof ProcessExit) return error.code;
    throw error;
  }
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

function buildCoreOpenApiSpec(request: Request, routes: CliApiRouteDef[], options: TinyRestApiOptions): Record<string, unknown> {
  const serverUrl = options.serverUrl(request);
  const paths: Record<string, unknown> = {};
  const tags = new Map<string, string>();

  for (const route of routes) {
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
    const jsonBodySchema = {
      type: 'object',
      properties: bodyProperties,
      ...(requiredBodyFields.length > 0 ? { required: requiredBodyFields } : {}),
      additionalProperties: false,
    };
    const requestBodyContent: Record<string, unknown> = {
      'application/json': { schema: jsonBodySchema },
      ...(route.multipart ? {
        'multipart/form-data': {
          schema: {
            ...jsonBodySchema,
            properties: {
              ...bodyProperties,
              attach: {
                type: 'array',
                items: { type: 'string', format: 'binary' },
                description: 'One or more files to attach to the thread request.',
              },
            },
          },
        },
      } : {}),
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
            ? {
                description: 'Command output stream. For log commands, `json=true` means machine-formatted newline-delimited JSON rather than human-readable text.',
                content: {
                  'text/plain': { schema: { type: 'string' } },
                  'application/x-ndjson': { schema: { type: 'string' } },
                },
              }
            : { description: 'Command machine-formatted response.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
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
      title: options.openApiTitle,
      version: '1.0.0',
      description: options.openApiDescription,
    },
    servers: [{ url: serverUrl, description: 'This Primordia instance' }],
    tags: [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => ({ name, description })),
    components: {
      securitySchemes: {
        WebApiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: options.bearerFormat,
          description: options.bearerDescription,
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

async function bufferedResponse(options: TinyRestApiOptions, argv: string[], cwd: string | undefined, auth: TinyRestAuthContext): Promise<Response> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(Buffer.from(chunk));
      callback();
    },
  });

  try {
    const code = await runCliDirect(options, argv, cwd, auth, stdout, stderr);
    const stdoutText = Buffer.concat(stdoutChunks).toString('utf8');
    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();

    if (code !== 0) {
      let message = stderrText;
      if (!message && stdoutText.trim()) {
        try {
          const parsed = JSON.parse(stdoutText) as { error?: unknown; msg?: unknown };
          if (typeof parsed.msg === 'string') message = parsed.msg;
          else if (typeof parsed.error === 'string') message = parsed.error;
        } catch {
          message = stdoutText.trim();
        }
      }
      return terminalJsonResponse({ msg: message || `Command exited with code ${code}` }, { status: code === 64 ? 400 : 500 });
    }

    try {
      return jsonResponse(JSON.parse(stdoutText));
    } catch {
      return terminalJsonResponse({ msg: 'Command succeeded but did not print valid JSON.', stdout: stdoutText }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return terminalJsonResponse({ msg: message }, { status: error instanceof CliUsageError ? 400 : 500 });
  }
}

function streamingResponse(options: TinyRestApiOptions, argv: string[], cwd: string | undefined, auth: TinyRestAuthContext, contentType = 'text/plain; charset=utf-8'): Response {
  const abortController = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          controller.enqueue(Buffer.from(chunk));
          callback();
        },
      });
      runCliDirect(options, argv, cwd, auth, sink, sink, abortController.signal)
        .catch((error) => controller.enqueue(encoder.encode(`\n[error] ${error instanceof Error ? error.message : String(error)}\n`)))
        .finally(() => controller.close());
    },
    cancel() {
      abortController.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': contentType,
      'cache-control': 'no-cache, no-transform',
    },
  });
}

async function coreActionResponse(request: Request, parts: string[], method: 'GET' | 'POST', routes: CliApiRouteDef[], options: TinyRestApiOptions): Promise<Response> {
  try {
    const matched = matchRoute(parts, routes);
    if (!matched) return terminalJsonResponse({ msg: 'unknown Core API route' }, { status: 404 });
    if (matched.route.httpMethod !== method) {
      return terminalJsonResponse({ msg: `Use ${matched.route.httpMethod} for this Core API route.` }, { status: 405, headers: { allow: matched.route.httpMethod } });
    }
    const uploadDir = method === 'POST' && matched.route.cwdParam
      ? path.join(options.resolveCwd(matched.params[matched.route.cwdParam]), 'attachments')
      : undefined;
    const parsed = method === 'GET' ? { args: [], options: {}, values: {} } : await parseRequestBody(request, uploadDir);
    const auth = await options.authorize(request);
    const { argv, cwd, streaming, ndjson } = buildArgv(matched.route, matched.params, parsed, request, options.resolveCwd);
    if (streaming) return streamingResponse(options, argv, cwd, auth, ndjson ? 'application/x-ndjson' : 'text/plain; charset=utf-8');
    return bufferedResponse(options, argv, cwd, auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes('authorization') || message.toLowerCase().includes('restricted to') ? 401 : 400;
    return terminalJsonResponse({ msg: message }, { status });
  }
}

export function createTinyCommandRestApi(options: TinyRestApiOptions) {
  const routes = listCliApiRoutes(options.command);
  return {
    routes,
    async GET(request: Request, context: TinyRestRouteContext) {
      const parts = (await context.params).path ?? [];
      if (parts[0] === 'openapi') return jsonResponse(buildCoreOpenApiSpec(request, routes, options));
      if (parts.length > 0 && parts[0] !== 'schema') return coreActionResponse(request, parts, 'GET', routes, options);
      try {
        await options.authorize(request);
        return jsonResponse({
          protocol: options.protocol,
          style: 'route-actions',
          auth: options.authDescription,
          basePath: options.basePath,
          routes,
        });
      } catch (error) {
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 401 });
      }
    },
    async POST(request: Request, context: TinyRestRouteContext) {
      const parts = (await context.params).path ?? [];
      return coreActionResponse(request, parts, 'POST', routes, options);
    },
  };
}

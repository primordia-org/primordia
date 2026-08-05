export type CliValue = string | string[] | boolean | undefined;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export interface CliParsedArgs {
  _: string[];
  [key: string]: CliValue | string[];
}

export interface ProcessConsole {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
  warn(...values: unknown[]): void;
}

export interface ProcessApi {
  cwd(): string;
  env: Record<string, string | undefined>;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream | NodeJS.WritableStream;
  stderr: NodeJS.WriteStream | NodeJS.WritableStream;
  pid: number;
  abortSignal?: AbortSignal;
  kill(pid: number, signal?: NodeJS.Signals | number): void;
  exit(code?: number): never;
}

export interface CommandContext {
  process: ProcessApi;
  console: ProcessConsole;
}

export class ProcessExit extends Error {
  constructor(public readonly code: number) {
    super(`Process exited with code ${code}`);
    this.name = 'ProcessExit';
  }
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

export function createProcessConsole(stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream = stdout): ProcessConsole {
  const writeLine = (stream: NodeJS.WritableStream, values: unknown[]) => {
    stream.write(`${values.map(formatConsoleValue).join(' ')}\n`);
  };
  return {
    log: (...values) => writeLine(stdout, values),
    error: (...values) => writeLine(stderr, values),
    warn: (...values) => writeLine(stderr, values),
  };
}


export interface CliCompletionContext {
  words: string[];
  current: string;
  previous: string | undefined;
  commandPath: string[];
}

export type CliCompletionSource = (context: CliCompletionContext) => string[] | Promise<string[]>;

export interface CliOptionDef {
  name: string;
  alias?: string;
  type: 'boolean' | 'string';
  valueHint?: string;
  description: string;
  complete?: CliCompletionSource;
  /** Allow the option to be provided more than once. Repeated values are exposed as string[]. */
  multiple?: boolean;
}

export interface CliArgumentDef {
  name: string;
  required?: boolean;
  valueHint?: string;
  description: string;
  complete?: CliCompletionSource;
}

export interface CliApiDef {
  /** Expose this runnable command through the generated Core API. Defaults to false until a route is assigned. */
  expose?: boolean;
  /** Route path relative to the Core API root, e.g. /status or /thread/[threadId]/followup. */
  path?: string;
  /** HTTP method for this action. Use GET for read-only query commands and POST for mutations. */
  method?: 'GET' | 'POST';
  /** Whether callers should expect the response body to stream by default. */
  streaming?: boolean;
  /** Whether this action accepts multipart/form-data request bodies. */
  multipart?: boolean;
  /** Path parameter whose value should resolve the command cwd to that thread worktree. */
  cwdParam?: string;
}

export interface CliCommandDef {
  name: string;
  description: string;
  options?: CliOptionDef[];
  arguments?: CliArgumentDef[];
  subcommands?: CliCommandDef[];
  complete?: CliCompletionSource;
  hidden?: boolean;
  api?: CliApiDef;
  run?: (context: { args: CliParsedArgs; rawArgs: string[]; commandPath: string[]; context: CommandContext }) => unknown | Promise<unknown>;
}

export interface CliApiRouteDef {
  path: string;
  httpMethod: 'GET' | 'POST';
  commandPath: string[];
  description: string;
  streaming: boolean;
  multipart: boolean;
  cwdParam?: string;
  options: Array<Pick<CliOptionDef, 'name' | 'alias' | 'type' | 'valueHint' | 'description' | 'multiple'>>;
  arguments: Array<Pick<CliArgumentDef, 'name' | 'required' | 'valueHint' | 'description'>>;
}

function flattenCommandEntries(command: CliCommandDef, path: string[] = [command.name]): Array<{ path: string[]; command: CliCommandDef }> {
  const rows: Array<{ path: string[]; command: CliCommandDef }> = [{ path, command }];
  for (const subcommand of command.subcommands ?? []) {
    rows.push(...flattenCommandEntries(subcommand, [...path, subcommand.name]));
  }
  return rows;
}

export function listCliApiRoutes(root: CliCommandDef): CliApiRouteDef[] {
  return flattenCommandEntries(root)
    .filter(({ command }) => Boolean(command.run) && Boolean(command.api?.path) && command.api?.expose !== false && !command.hidden)
    .map(({ path, command }) => ({
      path: command.api?.path ?? `/${path.slice(1).join('/')}`,
      httpMethod: command.api?.method ?? 'POST',
      commandPath: path.slice(1),
      description: command.description,
      streaming: command.api?.streaming ?? false,
      multipart: command.api?.multipart ?? false,
      cwdParam: command.api?.cwdParam,
      options: (command.options ?? []).map(({ name, alias, type, valueHint, description, multiple }) => ({ name, alias, type, valueHint, description, multiple })),
      arguments: (command.arguments ?? []).map(({ name, required, valueHint, description }) => ({ name, required, valueHint, description })),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}


#!/usr/bin/env bun

import { spawn, type ChildProcessByStdio } from 'child_process';
import * as fs from 'fs';
import type { Readable } from 'stream';

interface Config {
  worktreePath: string;
  branch: string;
  mode: 'dev' | 'prod';
  port: number;
  logPath: string;
  pidPath: string;
  env: NodeJS.ProcessEnv;
}

function writeJsonLine(stream: fs.WriteStream, value: Record<string, unknown>): void {
  stream.write(`${JSON.stringify({ ts: new Date().toISOString(), ...value })}\n`);
}

function pipeLines(stream: fs.WriteStream, source: 'stdout' | 'stderr', chunk: Buffer, pending: { text: string }): void {
  pending.text += chunk.toString('utf8');
  const lines = pending.text.split(/\r?\n/);
  pending.text = lines.pop() ?? '';
  for (const line of lines) {
    if (line.length > 0) writeJsonLine(stream, { source: 'nextjs', stream: source, message: line });
  }
}

async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) throw new Error('Usage: bun scripts/next-server-logger.ts <config-file>');

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Config;
  fs.writeFileSync(config.pidPath, String(process.pid), 'utf8');
  fs.mkdirSync(config.worktreePath, { recursive: true });
  const log = fs.createWriteStream(config.logPath, { flags: 'a' });
  const args = ['exec', '-C', config.worktreePath, '--', 'bun', 'run', config.mode === 'dev' ? 'dev' : 'start'];

  writeJsonLine(log, {
    source: 'process-manager',
    event: 'start',
    branch: config.branch,
    mode: config.mode,
    port: config.port,
    command: ['mise', ...args].join(' '),
  });

  const child = spawn('mise', args, {
    cwd: config.worktreePath,
    env: config.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessByStdio<null, Readable, Readable>;

  const stdoutPending = { text: '' };
  const stderrPending = { text: '' };
  child.stdout?.on('data', (chunk: Buffer) => pipeLines(log, 'stdout', chunk, stdoutPending));
  child.stderr?.on('data', (chunk: Buffer) => pipeLines(log, 'stderr', chunk, stderrPending));

  const forward = (signal: NodeJS.Signals) => {
    try { child.kill(signal); } catch { /* already gone */ }
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));

  child.on('error', (err: Error) => {
    writeJsonLine(log, { source: 'process-manager', event: 'error', message: err.message });
  });

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (stdoutPending.text) writeJsonLine(log, { source: 'nextjs', stream: 'stdout', message: stdoutPending.text });
    if (stderrPending.text) writeJsonLine(log, { source: 'nextjs', stream: 'stderr', message: stderrPending.text });
    writeJsonLine(log, { source: 'process-manager', event: 'exit', code, signal });
    try { fs.rmSync(config.pidPath, { force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(configFile, { force: true }); } catch { /* best-effort */ }
    log.end(() => process.exit(code ?? (signal ? 1 : 0)));
  });
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

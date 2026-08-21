#!/usr/bin/env bun
// Smoke-test the installed-service runtime path: the systemd-facing supervisor is
// started through `mise exec -C <primordia-root> -- bun ...`, then it spawns the
// reverse proxy and scheduled-jobs daemons by resolving `bun` from that same
// mise-managed environment.

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(import.meta.dir, '..');
const expectedBunVersion = '1.4.0';
const timeoutMs = 15_000;

type Cleanup = () => void;
const cleanups: Cleanup[] = [];

function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate a TCP port')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function readFileIfExists(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readPid(file: string): number | null {
  const value = Number.parseInt(readFileIfExists(file).trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isAlive(pid: number | null): pid is number {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number | null): void {
  if (!isAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

async function waitFor(label: string, predicate: () => boolean, diagnostic?: () => string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(100);
  }
  const details = diagnostic?.();
  fail(`timed out waiting for ${label}${details ? `\n${details}` : ''}`);
}

async function httpStatus(port: number): Promise<number> {
  return await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/__primordia-runtime-smoke', timeout: 2_000 }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode ?? 0));
    });
    req.once('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.once('error', reject);
    req.end();
  });
}

async function waitForHttpStatus(port: number): Promise<number> {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await httpStatus(port);
      if (status >= 400 && status < 600) return status;
      lastError = `HTTP ${status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(100);
  }
  fail(`timed out waiting for reverse proxy HTTP response: ${lastError}`);
}

async function main(): Promise<void> {
  if (Bun.version !== expectedBunVersion) {
    fail(`service runtime smoke test must run under Bun ${expectedBunVersion}; got ${Bun.version}`);
  }

  const miseToml = fs.readFileSync(path.join(repoRoot, 'mise.toml'), 'utf8');
  if (!miseToml.includes(`bun = "${expectedBunVersion}"`)) {
    fail(`mise.toml does not pin Bun ${expectedBunVersion}`);
  }

  const installScript = fs.readFileSync(path.join(repoRoot, 'scripts/install.sh'), 'utf8');
  if (!installScript.includes('ExecStart=${MISE_BIN} exec -C ${PRIMORDIA_DIR} -- bun ${PRIMORDIA_DIR}/${service_name}.js')) {
    fail('install.sh systemd unit no longer starts the supervisor through mise exec -C ${PRIMORDIA_DIR}');
  }
  if (!installScript.includes('MISE_CONFIG_SOURCE="${INSTALL_DIR}/mise.toml"') || !installScript.includes('MISE_CONFIG_DEST="${PRIMORDIA_DIR}/mise.toml"')) {
    fail('install.sh no longer copies the worktree mise.toml to the installed Primordia root');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'primordia-service-runtime-'));
  cleanups.push(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const sourceGit = path.join(tempRoot, 'source.git');
  const worktreesDir = path.join(tempRoot, 'worktrees');
  const productionWorktree = path.join(worktreesDir, 'main');
  fs.mkdirSync(worktreesDir, { recursive: true });
  run('git', ['init', '--bare', sourceGit], tempRoot);
  fs.mkdirSync(productionWorktree, { recursive: true });
  run('git', ['init'], productionWorktree);
  run('git', ['config', 'primordia.productionBranch', 'main'], sourceGit);
  run('git', ['config', 'branch.main.port', '9'], sourceGit);
  fs.copyFileSync(path.join(repoRoot, 'mise.toml'), path.join(tempRoot, 'mise.toml'));

  const build = spawnSync(process.execPath, [
    'build',
    path.join(repoRoot, 'scripts/service-supervisor.ts'),
    path.join(repoRoot, 'scripts/reverse-proxy.ts'),
    path.join(repoRoot, 'scripts/scheduled-jobs.ts'),
    '--target=bun',
    '--outdir', tempRoot,
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (build.status !== 0) fail(`bun build core launchers failed\n${build.stdout}${build.stderr}`);

  const port = await freePort();
  const trustedConfigPaths = `${tempRoot}:${worktreesDir}`;
  const miseBin = process.env.PRIMORDIA_MISE_BIN || run('which', ['mise'], repoRoot).trim();
  const miseShimsDir = path.join(os.homedir(), '.local/share/mise/shims');
  const systemdLikePath = `${miseShimsDir}:${path.dirname(miseBin)}:/usr/local/bin:/usr/bin:/bin`;
  const supervisor = spawn(miseBin, ['exec', '-C', tempRoot, '--', 'bun', path.join(tempRoot, 'service-supervisor.js')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PRIMORDIA_DIR: tempRoot,
      REVERSE_PROXY_PORT: String(port),
      MISE_TRUSTED_CONFIG_PATHS: trustedConfigPaths,
      PATH: systemdLikePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let supervisorOutput = '';
  supervisor.stdout?.on('data', (chunk) => { supervisorOutput += String(chunk); });
  supervisor.stderr?.on('data', (chunk) => { supervisorOutput += String(chunk); });
  cleanups.push(() => {
    killPid(readPid(path.join(tempRoot, '.primordia-reverse-proxy.pid')));
    killPid(readPid(path.join(tempRoot, '.primordia-scheduled-jobs.pid')));
    if (supervisor.pid) killPid(supervisor.pid);
  });

  const reverseProxyLog = path.join(tempRoot, '.primordia-reverse-proxy.log');
  const scheduledJobsLog = path.join(tempRoot, '.primordia-scheduled-jobs.log');

  await waitFor(
    'supervisor Bun 1.4 startup',
    () => supervisorOutput.includes(`[supervisor] runtime Bun ${expectedBunVersion}`),
    () => `supervisor output:\n${supervisorOutput}`,
  );
  await waitFor(
    'reverse proxy Bun 1.4 startup',
    () => readFileIfExists(reverseProxyLog).includes(`[proxy] runtime Bun ${expectedBunVersion}`),
    () => `reverse proxy log:\n${readFileIfExists(reverseProxyLog)}`,
  );
  await waitFor(
    'scheduled jobs Bun 1.4 startup',
    () => readFileIfExists(scheduledJobsLog).includes(`[scheduled-jobs] runtime Bun ${expectedBunVersion}`),
    () => `scheduled jobs log:\n${readFileIfExists(scheduledJobsLog)}`,
  );
  await waitFor('reverse proxy pid', () => isAlive(readPid(path.join(tempRoot, '.primordia-reverse-proxy.pid'))));
  await waitFor('scheduled jobs pid', () => isAlive(readPid(path.join(tempRoot, '.primordia-scheduled-jobs.pid'))));

  await waitForHttpStatus(port);

  console.log(`✓ service supervisor, reverse proxy, and scheduled-jobs launched under Bun ${expectedBunVersion} via mise.toml`);
}

try {
  await main();
} finally {
  for (const cleanup of cleanups.reverse()) {
    try { cleanup(); } catch { /* best-effort cleanup */ }
  }
}

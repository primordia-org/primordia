import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { renderTable } from './cli-utils';
import {
  getGitRepoRoot,
  listGitWorktrees,
  readBranchPorts,
  readProductionBranch,
} from './git-runtime';

export type ServerEnv = 'prod' | 'dev' | 'unknown';
export type ServerStartMode = 'dev' | 'prod';
export type ProcessAction = 'start' | 'stop' | 'restart';

export interface ProcessActionResult {
  action: ProcessAction;
  worktree: string;
  branch: string;
  port: number;
  mode?: ServerStartMode;
  pids: number[];
  logPath?: string;
  message: string;
}

export interface ManagedProcessStatus {
  pid: number;
  env: ServerEnv;
  state: string;
  childPids: number[];
}

export interface ReverseProxyStatus {
  pid: number;
  state: string;
  port: number | null;
  childPids: number[];
}

export interface ProcessStatusReport {
  reverseProxy: ReverseProxyStatus[];
  worktrees: WorktreeProcessStatus[];
}

export interface WorktreeProcessStatus {
  path: string;
  branch: string | null;
  port: number | null;
  servers: ManagedProcessStatus[];
  agents: Array<{
    kind: string;
    pid: number;
  }>;
}

interface ProcessInfo {
  pid: number;
  ppid: number | null;
  command: string;
  cwd: string | null;
  env: Record<string, string>;
  state: string;
}

function readProcText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readProcBuffer(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function parseProcEnv(pid: number): Record<string, string> {
  const buf = readProcBuffer(`/proc/${pid}/environ`);
  if (!buf) return {};
  const env: Record<string, string> = {};
  for (const entry of buf.toString('utf8').split('\0')) {
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

function readProcess(pid: number): ProcessInfo | null {
  const cmdBuf = readProcBuffer(`/proc/${pid}/cmdline`);
  const stat = readProcText(`/proc/${pid}/stat`);
  if (!cmdBuf || !stat) return null;

  const command = cmdBuf.toString('utf8').split('\0').filter(Boolean).join(' ');
  const statClose = stat.lastIndexOf(')');
  const afterComm = statClose >= 0 ? stat.slice(statClose + 2).split(' ') : [];
  const stateCode = afterComm[0] ?? '?';
  const ppid = afterComm.length >= 2 ? Number.parseInt(afterComm[1], 10) : null;
  let cwd: string | null = null;
  try {
    cwd = fs.realpathSync(`/proc/${pid}/cwd`);
  } catch {
    cwd = null;
  }
  return {
    pid,
    ppid: Number.isFinite(ppid) ? ppid : null,
    command,
    cwd,
    env: parseProcEnv(pid),
    state: linuxProcessStateName(stateCode),
  };
}

function linuxProcessStateName(code: string): string {
  switch (code) {
    case 'R': return 'running';
    case 'S': return 'sleeping';
    case 'D': return 'disk-sleep';
    case 'Z': return 'zombie';
    case 'T': return 'stopped';
    case 't': return 'tracing-stop';
    case 'W': return 'paging';
    case 'X':
    case 'x': return 'dead';
    case 'K': return 'wakekill';
    case 'P': return 'parked';
    case 'I': return 'idle';
    default: return 'unknown';
  }
}

function listProcesses(): ProcessInfo[] {
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => readProcess(Number.parseInt(entry, 10)))
    .filter((proc): proc is ProcessInfo => Boolean(proc));
}

function parseProcNetTcp(file: string): Array<{ localPort: number; inode: string }> {
  const text = readProcText(file);
  if (!text) return [];
  const rows: Array<{ localPort: number; inode: string }> = [];
  for (const line of text.trim().split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    // sl local_address rem_address st ... inode
    if (parts.length < 10 || parts[3] !== '0A') continue; // LISTEN
    const localAddress = parts[1] ?? '';
    const portHex = localAddress.split(':')[1];
    const port = Number.parseInt(portHex, 16);
    const inode = parts[9];
    if (Number.isFinite(port) && inode) rows.push({ localPort: port, inode });
  }
  return rows;
}

function buildPortOwners(): Map<number, Set<number>> {
  const socketInodesByPort = new Map<number, Set<string>>();
  for (const row of [...parseProcNetTcp('/proc/net/tcp'), ...parseProcNetTcp('/proc/net/tcp6')]) {
    const set = socketInodesByPort.get(row.localPort) ?? new Set<string>();
    set.add(row.inode);
    socketInodesByPort.set(row.localPort, set);
  }

  const owners = new Map<number, Set<number>>();
  if (socketInodesByPort.size === 0) return owners;

  let procEntries: string[];
  try {
    procEntries = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry));
  } catch {
    return owners;
  }

  for (const pidText of procEntries) {
    const pid = Number.parseInt(pidText, 10);
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let target = '';
      try {
        target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = target.match(/^socket:\[(\d+)\]$/);
      if (!match) continue;
      for (const [port, inodes] of socketInodesByPort) {
        if (!inodes.has(match[1])) continue;
        const set = owners.get(port) ?? new Set<number>();
        set.add(pid);
        owners.set(port, set);
      }
    }
  }

  return owners;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLivePidFile(filePath: string): number | null {
  const text = readProcText(filePath);
  if (!text) return null;
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isFinite(pid) && isPidAlive(pid) ? pid : null;
}

function readAgentPidFile(worktreePath: string): number | null {
  return readLivePidFile(path.join(worktreePath, '.primordia-worker.pid'));
}

function readServerLauncherPidFile(worktreePath: string): number | null {
  return readLivePidFile(path.join(worktreePath, '.primordia-server.pid'));
}

function agentKindFromCommand(command: string): string {
  const script = command.split(/\s+/).find((part) => part.endsWith('.ts'));
  return script ? path.basename(script) : 'agent';
}

function readConfigWorktree(command: string): string | null {
  const configPath = command.split(/\s+/).find((part) => part.startsWith('/tmp/primordia-worker-') && part.endsWith('.json'));
  if (!configPath) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { worktreePath?: unknown };
    return typeof config.worktreePath === 'string' ? config.worktreePath : null;
  } catch {
    return null;
  }
}

function getAgentsForWorktree(worktreePath: string, processes: ProcessInfo[]): Array<{ kind: string; pid: number }> {
  const agents = new Map<number, string>();
  const pidFilePid = readAgentPidFile(worktreePath);
  if (pidFilePid !== null) {
    const proc = processes.find((candidate) => candidate.pid === pidFilePid);
    agents.set(pidFilePid, proc ? agentKindFromCommand(proc.command) : 'agent');
  }

  for (const proc of processes) {
    const configWorktree = readConfigWorktree(proc.command);
    if (!configWorktree) continue;
    if (path.resolve(configWorktree) === path.resolve(worktreePath)) {
      agents.set(proc.pid, agentKindFromCommand(proc.command));
    }
  }

  return [...agents.entries()]
    .map(([pid, kind]) => ({ pid, kind }))
    .sort((a, b) => a.pid - b.pid);
}

function inferServerEnv(proc: ProcessInfo, branch: string | null, productionBranch: string | null): ServerEnv {
  if (proc.env.NODE_ENV === 'development' || proc.command.includes('next dev')) return 'dev';
  if (proc.env.NODE_ENV === 'production' || proc.command.includes('next start')) return 'prod';
  if (branch && productionBranch && branch === productionBranch) return 'prod';
  return 'unknown';
}

function buildChildrenByParent(processes: ProcessInfo[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const proc of processes) {
    if (proc.ppid === null) continue;
    const childPids = children.get(proc.ppid) ?? [];
    childPids.push(proc.pid);
    children.set(proc.ppid, childPids);
  }
  for (const childPids of children.values()) childPids.sort((a, b) => a - b);
  return children;
}

function getDescendantPids(pid: number, childrenByParent: Map<number, number[]>): number[] {
  const descendants: number[] = [];
  const stack = [...(childrenByParent.get(pid) ?? [])];
  while (stack.length > 0) {
    const childPid = stack.shift();
    if (childPid === undefined) continue;
    descendants.push(childPid);
    stack.push(...(childrenByParent.get(childPid) ?? []));
  }
  return descendants.sort((a, b) => a - b);
}

function isReverseProxyProcess(proc: ProcessInfo): boolean {
  return /(^|\s)(?:\S*\/)?reverse-proxy\.ts(?:\s|$)/.test(proc.command);
}

function getReverseProxyStatuses(processes: ProcessInfo[], childrenByParent: Map<number, number[]>): ReverseProxyStatus[] {
  return processes
    .filter(isReverseProxyProcess)
    .map((proc) => {
      const childPids = getDescendantPids(proc.pid, childrenByParent);
      const port = Number.parseInt(proc.env.REVERSE_PROXY_PORT ?? proc.env.PORT ?? '', 10);
      return {
        pid: proc.pid,
        state: proc.state,
        port: Number.isFinite(port) ? port : null,
        childPids,
      };
    })
    .sort((a, b) => a.pid - b.pid);
}

export function getProcessStatusReport(cwd = process.cwd()): ProcessStatusReport {
  const repoRoot = getGitRepoRoot(cwd);
  const worktrees = listGitWorktrees(repoRoot);
  const branchPorts = readBranchPorts(repoRoot);
  const productionBranch = readProductionBranch(repoRoot);
  const portOwners = buildPortOwners();
  const processes = listProcesses();
  const childrenByParent = buildChildrenByParent(processes);

  const worktreeStatuses = worktrees.map((worktree) => {
    const port = worktree.branch ? branchPorts.get(worktree.branch) ?? null : null;
    const pids = port ? [...(portOwners.get(port) ?? [])].sort((a, b) => a - b) : [];
    const serverProcesses = pids
      .map((pid) => processes.find((proc) => proc.pid === pid) ?? readProcess(pid))
      .filter((proc): proc is ProcessInfo => Boolean(proc));

    return {
      path: worktree.path,
      branch: worktree.branch,
      port,
      servers: serverProcesses.map((proc) => {
        const childPids = getDescendantPids(proc.pid, childrenByParent);
        return {
          pid: proc.pid,
          env: inferServerEnv(proc, worktree.branch, productionBranch),
          state: proc.state,
          childPids,
        };
      }),
      agents: getAgentsForWorktree(worktree.path, processes),
    };
  }).sort((a, b) => {
    if (a.port === null && b.port === null) return (a.branch ?? '').localeCompare(b.branch ?? '');
    if (a.port === null) return 1;
    if (b.port === null) return -1;
    return a.port - b.port;
  });

  return {
    reverseProxy: getReverseProxyStatuses(processes, childrenByParent),
    worktrees: worktreeStatuses,
  };
}

export function getProcessStatuses(cwd = process.cwd()): WorktreeProcessStatus[] {
  return getProcessStatusReport(cwd).worktrees;
}

type ManageableWorktreeProcessStatus = WorktreeProcessStatus & { branch: string; port: number };

function findWorktree(report: ProcessStatusReport, name: string): ManageableWorktreeProcessStatus {
  const match = report.worktrees.find((worktree) =>
    worktree.branch === name || path.basename(worktree.path) === name || worktree.path === name,
  );
  if (!match) throw new Error(`No worktree found for '${name}'`);
  if (!match.branch) throw new Error(`Worktree '${name}' is detached and cannot be managed by branch port`);
  if (match.port === null) throw new Error(`Worktree '${name}' has no assigned branch port`);
  return match as ManageableWorktreeProcessStatus;
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(pid, signal); } catch { /* process already gone */ }
}

async function waitForPidsToExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pids.every((pid) => !isPidAlive(pid));
}

export async function stopWorktreeServer(name: string, cwd = process.cwd()): Promise<ProcessActionResult> {
  const report = getProcessStatusReport(cwd);
  const worktree = findWorktree(report, name);
  const launcherPid = readServerLauncherPidFile(worktree.path);
  const pids = [...new Set([
    ...worktree.servers.flatMap((server) => [...server.childPids, server.pid]),
    ...(launcherPid === null ? [] : [launcherPid]),
  ])].sort((a, b) => b - a);
  if (pids.length === 0) {
    return {
      action: 'stop',
      worktree: worktree.path,
      branch: worktree.branch,
      port: worktree.port,
      pids: [],
      message: `${worktree.branch} has no running server`,
    };
  }

  for (const pid of pids) signalPid(pid, 'SIGTERM');
  const stopped = await waitForPidsToExit(pids, 5000);
  if (!stopped) {
    for (const pid of pids) signalPid(pid, 'SIGKILL');
    await waitForPidsToExit(pids, 1000);
  }
  return {
    action: 'stop',
    worktree: worktree.path,
    branch: worktree.branch,
    port: worktree.port,
    pids,
    message: `stopped ${worktree.branch} server process(es): ${pids.join(', ')}`,
  };
}

export function getWorktreeLogPath(name: string, cwd = process.cwd()): string {
  const report = getProcessStatusReport(cwd);
  return path.join(findWorktree(report, name).path, '.primordia-next-server.log');
}

export function readWorktreeLogLines(name: string, cwd = process.cwd()): string[] {
  const logPath = getWorktreeLogPath(name, cwd);
  const text = readProcText(logPath);
  if (!text) return [];
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

export function startWorktreeServer(name: string, mode: ServerStartMode = 'dev', cwd = process.cwd()): ProcessActionResult {
  const report = getProcessStatusReport(cwd);
  const worktree = findWorktree(report, name);
  if (worktree.servers.length > 0) {
    throw new Error(`Worktree '${worktree.branch}' already has running server process(es): ${worktree.servers.map((server) => server.pid).join(', ')}`);
  }

  const port = worktree.port;
  const baseEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: '0.0.0.0',
  };
  const env: NodeJS.ProcessEnv = mode === 'dev'
    ? {
      ...baseEnv,
      NODE_ENV: 'development',
      ...(process.env.REVERSE_PROXY_PORT ? { NEXT_BASE_PATH: `/preview/${worktree.branch}` } : {}),
    }
    : {
      ...baseEnv,
      NODE_ENV: 'production',
    };

  const logPath = getWorktreeLogPath(name, cwd);
  const pidPath = path.join(worktree.path, '.primordia-server.pid');
  const logFd = fs.openSync(logPath, 'a');
  const args = ['exec', '-C', worktree.path, '--', 'bun', 'run', mode === 'dev' ? 'dev' : 'start'];
  const proc = spawn('mise', args, {
    cwd: worktree.path,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  if (!proc.pid) throw new Error(`Failed to start ${worktree.branch} server`);
  fs.writeFileSync(pidPath, String(proc.pid), 'utf8');
  proc.unref();
  return {
    action: 'start',
    worktree: worktree.path,
    branch: worktree.branch,
    port,
    mode,
    pids: [proc.pid],
    logPath,
    message: `started ${worktree.branch} ${mode} server on port ${port} (PID ${proc.pid}, log ${logPath})`,
  };
}

export async function restartWorktreeServer(name: string, mode: ServerStartMode = 'dev', cwd = process.cwd()): Promise<ProcessActionResult> {
  await stopWorktreeServer(name, cwd);
  const result = startWorktreeServer(name, mode, cwd);
  return {
    ...result,
    action: 'restart',
    message: `restarted ${result.branch} ${mode} server on port ${result.port} (PID ${result.pids.join(', ')}, log ${result.logPath})`,
  };
}

export function formatProcessStatusReport(report: ProcessStatusReport): string {
  const proxyHeaders = ['Proxy', 'Port', 'State', 'PID', 'Children'] as const;
  const proxyRows = report.reverseProxy.length > 0
    ? report.reverseProxy.map((proxy) => [
      'reverse-proxy',
      proxy.port === null ? '—' : String(proxy.port),
      proxy.state,
      String(proxy.pid),
      String(proxy.childPids.length),
    ])
    : [['reverse-proxy', '—', 'not-running', '—', '—']];

  const worktreeHeaders = ['Worktree', 'Port', 'State', 'Env', 'PID', 'Children', 'Agents'] as const;
  const worktreeRows = report.worktrees.map((status) => [
    status.branch ?? '(detached)',
    status.port === null ? '—' : String(status.port),
    status.servers.length > 0 ? status.servers.map((server) => server.state).join(',') : '—',
    status.servers.length > 0 ? status.servers.map((server) => server.env).join(',') : '—',
    status.servers.length > 0 ? status.servers.map((server) => String(server.pid)).join(',') : '—',
    status.servers.length > 0 ? status.servers.map((server) => String(server.childPids.length)).join(',') : '—',
    status.agents.length > 0
      ? status.agents.map((agent) => `${agent.kind}:${agent.pid}`).join(', ')
      : '—',
  ]);

  return [
    'Reverse proxy',
    renderTable(proxyHeaders, proxyRows),
    '',
    'Worktrees',
    renderTable(worktreeHeaders, worktreeRows),
  ].join('\n');
}

export function formatProcessStatusTable(statuses: WorktreeProcessStatus[]): string {
  return formatProcessStatusReport({ reverseProxy: [], worktrees: statuses }).split('\n').slice(3).join('\n');
}

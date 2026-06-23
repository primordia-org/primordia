import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type ServerMode = 'prod' | 'dev' | 'unknown';

export interface WorktreeProcessStatus {
  path: string;
  branch: string | null;
  head: string | null;
  port: number | null;
  server: {
    active: boolean;
    mode: ServerMode;
    pids: number[];
  };
  agents: Array<{
    kind: string;
    pid: number;
  }>;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
}

interface ProcessInfo {
  pid: number;
  ppid: number | null;
  command: string;
  cwd: string | null;
  env: Record<string, string>;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function getRepoRoot(cwd: string): string {
  const commonDir = runGit(['rev-parse', '--git-common-dir'], cwd).trim();
  return path.resolve(cwd, commonDir);
}

function parseWorktrees(porcelain: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;

  const flush = () => {
    if (current && !current.bare) worktrees.push(current);
    current = null;
  };

  for (const line of porcelain.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length), branch: null, head: null, bare: false };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (current && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    } else if (current && line === 'detached') {
      current.branch = null;
    } else if (current && line === 'bare') {
      current.bare = true;
    }
  }
  flush();
  return worktrees;
}

function readBranchPorts(repoRoot: string): Map<string, number> {
  const ports = new Map<string, number>();
  let out = '';
  try {
    out = runGit(['config', '--get-regexp', '^branch\\.[^.]+\\.port$'], repoRoot);
  } catch {
    return ports;
  }

  for (const line of out.trim().split('\n')) {
    if (!line) continue;
    const firstSpace = line.indexOf(' ');
    if (firstSpace === -1) continue;
    const key = line.slice(0, firstSpace);
    const value = line.slice(firstSpace + 1).trim();
    const match = key.match(/^branch\.([^.]+)\.port$/);
    const port = Number.parseInt(value, 10);
    if (match && Number.isFinite(port)) ports.set(match[1], port);
  }
  return ports;
}

function readProductionBranch(repoRoot: string): string | null {
  try {
    const value = runGit(['config', '--get', 'primordia.productionBranch'], repoRoot).trim();
    return value || null;
  } catch {
    return null;
  }
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
  const ppid = afterComm.length >= 2 ? Number.parseInt(afterComm[1], 10) : null;
  let cwd: string | null = null;
  try {
    cwd = fs.realpathSync(`/proc/${pid}/cwd`);
  } catch {
    cwd = null;
  }
  return { pid, ppid: Number.isFinite(ppid) ? ppid : null, command, cwd, env: parseProcEnv(pid) };
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

function isPathInside(child: string | null, parent: string): boolean {
  if (!child) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readAgentPidFile(worktreePath: string): number | null {
  const text = readProcText(path.join(worktreePath, '.primordia-worker.pid'));
  if (!text) return null;
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isFinite(pid) && isPidAlive(pid) ? pid : null;
}

function agentKindFromCommand(command: string): string {
  if (command.includes('claude-worker.ts')) return 'claude-code';
  if (command.includes('pi-worker.ts')) return 'pi';
  if (command.includes('codex-worker.ts')) return 'codex';
  return 'agent';
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
    if (!/\b(claude-worker|pi-worker|codex-worker)\.ts\b/.test(proc.command)) continue;
    const configWorktree = readConfigWorktree(proc.command);
    if (configWorktree ? path.resolve(configWorktree) === path.resolve(worktreePath) : isPathInside(proc.cwd, worktreePath)) {
      agents.set(proc.pid, agentKindFromCommand(proc.command));
    }
  }

  return [...agents.entries()]
    .map(([pid, kind]) => ({ pid, kind }))
    .sort((a, b) => a.pid - b.pid);
}

function inferServerMode(branch: string | null, productionBranch: string | null, serverProcesses: ProcessInfo[]): ServerMode {
  for (const proc of serverProcesses) {
    if (proc.env.NODE_ENV === 'development' || proc.command.includes('next dev')) return 'dev';
    if (proc.env.NODE_ENV === 'production' || proc.command.includes('next start')) return 'prod';
  }
  if (branch && productionBranch && branch === productionBranch) return 'prod';
  return serverProcesses.length > 0 ? 'unknown' : 'unknown';
}

export function getProcessStatuses(cwd = process.cwd()): WorktreeProcessStatus[] {
  const repoRoot = getRepoRoot(cwd);
  const worktrees = parseWorktrees(runGit(['worktree', 'list', '--porcelain'], repoRoot));
  const branchPorts = readBranchPorts(repoRoot);
  const productionBranch = readProductionBranch(repoRoot);
  const portOwners = buildPortOwners();
  const processes = listProcesses();

  return worktrees.map((worktree) => {
    const port = worktree.branch ? branchPorts.get(worktree.branch) ?? null : null;
    const pids = port ? [...(portOwners.get(port) ?? [])].sort((a, b) => a - b) : [];
    const serverProcesses = pids
      .map((pid) => processes.find((proc) => proc.pid === pid) ?? readProcess(pid))
      .filter((proc): proc is ProcessInfo => Boolean(proc));

    return {
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
      port,
      server: {
        active: pids.length > 0,
        mode: inferServerMode(worktree.branch, productionBranch, serverProcesses),
        pids,
      },
      agents: getAgentsForWorktree(worktree.path, processes),
    };
  });
}

export function formatProcessStatusTable(statuses: WorktreeProcessStatus[]): string {
  const rows = statuses.map((status) => ({
    Worktree: status.branch ?? '(detached)',
    Port: status.port === null ? '—' : String(status.port),
    Running: status.server.active ? 'yes' : 'no',
    Env: status.server.active ? status.server.mode : '—',
    PID: status.server.pids.length > 0 ? status.server.pids.join(',') : '—',
    Agents: status.agents.length > 0
      ? status.agents.map((agent) => `${agent.kind}:${agent.pid}`).join(', ')
      : '—',
  }));

  const headers = ['Worktree', 'Port', 'Running', 'Env', 'PID', 'Agents'] as const;
  const widths = headers.map((header) => Math.max(header.length, ...rows.map((row) => row[header].length)));
  const border = `┌${widths.map((width) => '─'.repeat(width + 2)).join('┬')}┐`;
  const separator = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `└${widths.map((width) => '─'.repeat(width + 2)).join('┴')}┘`;
  const renderRow = (values: string[]) => `│${values.map((value, i) => ` ${value.padEnd(widths[i])} `).join('│')}│`;

  return [
    border,
    renderRow([...headers]),
    separator,
    ...rows.map((row) => renderRow(headers.map((header) => row[header]))),
    bottom,
  ].join('\n');
}

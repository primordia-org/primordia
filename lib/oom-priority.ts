// lib/oom-priority.ts
// Linux OOM-killer priority helpers. Lower oom_score_adj means more protected;
// higher means a process is selected sooner under memory pressure.

import * as fs from 'fs';

export type PrimordiaOomRole = 'supervisor' | 'reverse-proxy' | 'scheduled-jobs' | 'production-server' | 'agent-worker' | 'dev-server' | 'command';

export const OOM_SCORE_ADJ: Record<PrimordiaOomRole, number> = {
  // The systemd unit should start at -1000. Unprivileged child processes can
  // then increase their own value to become easier OOM targets, but cannot make
  // themselves more protected than the inherited baseline.
  'supervisor': -1000,
  'reverse-proxy': -900,
  'scheduled-jobs': -850,
  'production-server': -700,
  'agent-worker': 300,
  // Dev servers are intentionally easiest to kill. startWorktreeServer adds a
  // small newest-first offset so newer previews are killed before older ones.
  'dev-server': 800,
  'command': 500,
};

export interface OomScoreAdjustResult {
  ok: boolean;
  pid: number;
  requested: number;
  actual: number | null;
  error?: string;
}

export function readOomScoreAdj(pid: number): number | null {
  try {
    const value = Number.parseInt(fs.readFileSync(`/proc/${pid}/oom_score_adj`, 'utf8').trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function setOomScoreAdj(pid: number, value: number): OomScoreAdjustResult {
  const requested = Math.max(-1000, Math.min(1000, Math.round(value)));
  try {
    fs.writeFileSync(`/proc/${pid}/oom_score_adj`, `${requested}\n`, 'utf8');
    return { ok: readOomScoreAdj(pid) === requested, pid, requested, actual: readOomScoreAdj(pid) };
  } catch (err) {
    return {
      ok: false,
      pid,
      requested,
      actual: readOomScoreAdj(pid),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function applyOomScoreAdj(pid: number, value: number, label: string, log: (message: string) => void = console.warn): void {
  const result = setOomScoreAdj(pid, value);
  if (!result.ok) {
    log(`[oom-priority] could not set ${label} pid ${pid} oom_score_adj=${result.requested} (actual ${result.actual ?? 'unknown'}): ${result.error ?? 'write did not stick'}`);
  }
}

export function applyCurrentProcessOomRole(role: PrimordiaOomRole, log: (message: string) => void = console.warn): void {
  applyOomScoreAdj(process.pid, OOM_SCORE_ADJ[role], role, log);
}

export function devServerOomScoreAdj(startedAtMs = Date.now()): number {
  // Newer dev servers get larger scores. This gives the kernel a stable bias
  // toward killing new previews first while keeping all dev servers above agents.
  const ageMinutes = Math.max(0, Math.floor((Date.now() - startedAtMs) / 60_000));
  return Math.max(700, OOM_SCORE_ADJ['dev-server'] + 150 - Math.min(ageMinutes, 250));
}

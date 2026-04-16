// app/api/admin/proxy-settings/route.ts
// Admin-only API for reading and updating proxy configuration stored in git config.
//
// GET  — returns current proxy settings (with defaults if not set).
// PATCH — updates one or more proxy settings.
//
// Settings are stored as git config keys under the primordia.* namespace so the
// reverse proxy picks them up automatically via its git config file watcher.

import { spawnSync } from 'child_process';
import { getSessionUser, isAdmin } from '@/lib/auth';

export interface ProxySettings {
  /** Minutes of inactivity before a preview server is stopped. Default: 30. */
  previewInactivityMin: number;
  /** Disk usage % at which automatic worktree cleanup is triggered. Default: 90. */
  diskCleanupThresholdPct: number;
}

const DEFAULTS: ProxySettings = {
  previewInactivityMin: 30,
  diskCleanupThresholdPct: 90,
};

function readGitConfigInt(key: string, repoRoot: string): number | null {
  const result = spawnSync('git', ['config', '--get', key], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const v = parseInt(result.stdout.trim(), 10);
  return isNaN(v) ? null : v;
}

function writeGitConfig(key: string, value: string, repoRoot: string): boolean {
  const result = spawnSync('git', ['config', key, value], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  const repoRoot = process.cwd();
  const settings: ProxySettings = {
    previewInactivityMin:
      readGitConfigInt('primordia.previewInactivityMin', repoRoot) ?? DEFAULTS.previewInactivityMin,
    diskCleanupThresholdPct:
      readGitConfigInt('primordia.diskCleanupThresholdPct', repoRoot) ?? DEFAULTS.diskCleanupThresholdPct,
  };

  return Response.json(settings);
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: 'Admin required' }, { status: 403 });

  let body: Partial<ProxySettings>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const errors: string[] = [];

  if (body.previewInactivityMin !== undefined) {
    const v = Number(body.previewInactivityMin);
    if (!Number.isInteger(v) || v < 1 || v > 1440) {
      errors.push('previewInactivityMin must be an integer between 1 and 1440');
    } else {
      writeGitConfig('primordia.previewInactivityMin', String(v), repoRoot);
    }
  }

  if (body.diskCleanupThresholdPct !== undefined) {
    const v = Number(body.diskCleanupThresholdPct);
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      errors.push('diskCleanupThresholdPct must be an integer between 1 and 100');
    } else {
      writeGitConfig('primordia.diskCleanupThresholdPct', String(v), repoRoot);
    }
  }

  if (errors.length > 0) {
    return Response.json({ error: errors.join('; ') }, { status: 400 });
  }

  // Return updated settings
  const updated: ProxySettings = {
    previewInactivityMin:
      readGitConfigInt('primordia.previewInactivityMin', repoRoot) ?? DEFAULTS.previewInactivityMin,
    diskCleanupThresholdPct:
      readGitConfigInt('primordia.diskCleanupThresholdPct', repoRoot) ?? DEFAULTS.diskCleanupThresholdPct,
  };

  return Response.json(updated);
}

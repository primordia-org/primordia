// app/api/evolve/local/restart/route.ts
// Runs `bun install` then asks Next.js to restart the dev server.
//
// Called by the parent tab's AcceptRejectBar after it receives a
// "primordia:preview-accepted" postMessage from the closing preview window.
// Only available in development (NODE_ENV=development).

import { spawn } from 'child_process';

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (d: Buffer) => outChunks.push(d));
    proc.stderr?.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(outChunks).toString(),
        stderr: Buffer.concat(errChunks).toString(),
      });
    });
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Only available in development mode' },
      { status: 403 },
    );
  }

  const { origin } = new URL(request.url);
  const diagnostics: string[] = [];

  const log = (msg: string) => {
    console.log(msg);
    diagnostics.push(msg);
  };

  // Install any new/updated packages introduced by the merged changes.
  log(`[restart] cwd: ${process.cwd()}`);
  log(`[restart] Running bun install…`);
  const install = await runCommand('bun', ['install'], process.cwd());
  log(`[restart] bun install exit code: ${install.code}`);
  if (install.stdout.trim()) log(`[restart] bun install stdout:\n${install.stdout.trim()}`);
  if (install.stderr.trim()) log(`[restart] bun install stderr:\n${install.stderr.trim()}`);

  // Ask Next.js to restart the dev server. The response may never arrive if
  // the server restarts quickly enough — that's expected, so errors are swallowed.
  log(`[restart] Calling POST ${origin}/__nextjs_restart_dev`);
  try {
    const res = await fetch(`${origin}/__nextjs_restart_dev`, { method: 'POST' });
    log(`[restart] __nextjs_restart_dev responded: ${res.status}`);
  } catch (err) {
    // Server restarted before responding — normal behaviour.
    log(`[restart] __nextjs_restart_dev error (may be normal if server restarted): ${String(err)}`);
  }

  return Response.json({ ok: true, diagnostics });
}

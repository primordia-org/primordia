// app/api/prune-branches/route.ts
// Deletes all local git branches that are already merged into main,
// excluding main itself. Streams all output as SSE so the UI can
// display progress in real time.
//
// POST — no body required.
// SSE lines: data: { text: string }
// Final line: data: { done: true, outcome: "success" | "error" }

import { spawnSync } from 'child_process';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runGit(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    code: result.status ?? 1,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST() {
  const cwd = process.cwd();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(text: string): void {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
        );
      }

      function sendDone(outcome: 'success' | 'error'): void {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, outcome })}\n\n`),
        );
        controller.close();
      }

      try {
        // ── 1. Find branches merged into main ──────────────────────────────────
        send('🔍 Finding branches merged into main…\n');
        const mergedResult = runGit(['branch', '--merged', 'main'], cwd);
        if (mergedResult.code !== 0) {
          send(`❌ git branch --merged main failed:\n${mergedResult.stderr}\n`);
          sendDone('error');
          return;
        }

        // Parse branch names — strip leading whitespace and the "* " current-branch marker
        // or the "+ " worktree marker (git uses "+" for branches checked out in another worktree)
        const candidates = mergedResult.stdout
          .split('\n')
          .map((line) => line.replace(/^[*+]?\s+/, '').trim())
          .filter(Boolean)
          .filter((name) => name !== 'main');

        if (candidates.length === 0) {
          send('✅ No merged branches to delete (only main is merged into main).\n');
          sendDone('success');
          return;
        }

        send(`📋 Found ${candidates.length} merged branch${candidates.length === 1 ? '' : 'es'}:\n`);
        for (const name of candidates) {
          send(`   • ${name}\n`);
        }
        send('\n');

        // ── 2. Delete each merged branch ───────────────────────────────────────
        let deleted = 0;
        let failed = 0;

        for (const name of candidates) {
          send(`🗑️  Deleting ${name}…\n`);
          const deleteResult = runGit(['branch', '-d', name], cwd);
          if (deleteResult.code !== 0) {
            send(`   ❌ Failed: ${deleteResult.stderr || deleteResult.stdout}\n`);
            failed++;
          } else {
            send(`   ✅ Deleted.\n`);
            deleted++;
          }
        }

        send(`\n📊 Done: ${deleted} deleted, ${failed} failed.\n`);
        sendDone(failed === 0 ? 'success' : 'error');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send(`\n❌ Unexpected error: ${msg}\n`);
        sendDone('error');
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

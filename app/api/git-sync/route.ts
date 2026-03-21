// app/api/git-sync/route.ts
// Synchronises the current branch with GitHub: git pull (merge) then git push.
// Authenticates using GITHUB_TOKEN as the username (blank password).
// On merge conflicts, launches Claude Code to resolve them automatically.
// Streams all output as SSE so the UI can display progress in real time.
//
// POST — no body required.
// SSE lines: data: { text: string }
// Final line: data: { done: true, outcome: "success" | "error" }

import { spawn } from 'child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnGit(
  args: string[],
  cwd: string,
  onData?: (text: string) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      stdout += text;
      onData?.(text);
    });
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      onData?.(text);
    });
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    proc.on('error', (err) => resolve({ stdout: '', stderr: err.message, code: 1 }));
  });
}

/** Build an authenticated https remote URL from GITHUB_TOKEN + GITHUB_REPO.
 *  Returns null if either env var is missing. */
function buildAuthRemoteUrl(): string | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  // username = token, password = blank (empty string after the colon)
  return `https://${token}:@github.com/${repo}.git`;
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
        // ── 1. Determine current branch ───────────────────────────────────────
        const branchResult = await spawnGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        const branch = branchResult.stdout.trim();
        if (!branch || branch === 'HEAD') {
          send('❌ Cannot determine current branch (detached HEAD state).\n');
          sendDone('error');
          return;
        }
        send(`📌 Branch: ${branch}\n\n`);

        // ── 2. Build remote URL ───────────────────────────────────────────────
        const remoteUrl = buildAuthRemoteUrl();
        // For display purposes, strip the token from the URL shown to the user.
        const displayRemote = remoteUrl
          ? `https://***:@github.com/${process.env.GITHUB_REPO}.git`
          : 'origin';

        send(`🔗 Remote: ${displayRemote}\n\n`);

        // ── 3. Check whether the branch already exists on the remote ──────────
        send('🔍 Checking remote for existing branch…\n');
        const lsArgs = remoteUrl
          ? ['ls-remote', '--heads', remoteUrl, branch]
          : ['ls-remote', '--heads', 'origin', branch];
        const lsResult = await spawnGit(lsArgs, cwd);
        if (lsResult.code !== 0) {
          send(`⚠️  ls-remote warning (continuing): ${lsResult.stderr.trim()}\n`);
        }
        const remoteBranchExists = lsResult.stdout.trim().length > 0;
        send(
          remoteBranchExists
            ? `✅ Remote branch exists.\n\n`
            : `ℹ️  Remote branch does not exist yet — will skip pull and push directly.\n\n`,
        );

        // ── 4. Pull (merge, not rebase) if remote branch exists ───────────────
        if (remoteBranchExists) {
          send('📥 Pulling from remote (merge)…\n');
          const pullArgs = remoteUrl
            ? ['pull', '--no-rebase', remoteUrl, branch]
            : ['pull', '--no-rebase', 'origin', branch];
          const pullResult = await spawnGit(pullArgs, cwd, (t) => send(t));

          if (pullResult.code !== 0) {
            // Detect merge conflicts via git status --porcelain
            const statusResult = await spawnGit(['status', '--porcelain'], cwd);
            const conflictLines = statusResult.stdout
              .split('\n')
              .filter((line) =>
                line.startsWith('UU') ||
                line.startsWith('AA') ||
                line.startsWith('DD') ||
                line.startsWith('AU') ||
                line.startsWith('UA') ||
              false,
              );

            if (conflictLines.length > 0) {
              const conflictFiles = conflictLines.map((l) => l.slice(3).trim());
              send(
                `\n⚠️  Merge conflict in:\n${conflictFiles.map((f) => `  • ${f}`).join('\n')}\n\n`,
              );
              send('🤖 Launching Claude Code to resolve conflicts…\n\n');

              const claudePrompt =
                `There are git merge conflicts in the following files:\n` +
                `${conflictFiles.map((f) => `  - ${f}`).join('\n')}\n\n` +
                `Resolve all merge conflicts, combining the best of both sides. ` +
                `After resolving every conflict marker, stage the files with \`git add\` ` +
                `and complete the merge with \`git commit\` (no extra message needed — ` +
                `accept the default merge commit message).`;

              try {
                const run = query({
                  prompt: claudePrompt,
                  options: {
                    cwd,
                    permissionMode: 'bypassPermissions',
                    allowDangerouslySkipPermissions: true,
                  },
                });

                for await (const message of run) {
                  if (message.type === 'assistant') {
                    for (const block of message.message.content) {
                      if (block.type === 'text' && block.text.trim()) {
                        send(block.text.trimEnd() + '\n');
                      } else if (block.type === 'tool_use') {
                        const inputStr = JSON.stringify(block.input).slice(0, 120);
                        send(`  🔧 ${block.name}: ${inputStr}\n`);
                      }
                    }
                  } else if (message.type === 'result') {
                    if (message.subtype !== 'success') {
                      send(`\n❌ Claude Code ended with: ${message.subtype}\n`);
                      sendDone('error');
                      return;
                    }
                  }
                }

                send('\n✅ Claude Code finished resolving conflicts.\n\n');
              } catch (claudeErr) {
                const msg =
                  claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
                send(`\n❌ Claude Code error: ${msg}\n`);
                sendDone('error');
                return;
              }
            } else {
              // Some other pull failure (not a conflict)
              send(`\n❌ git pull failed:\n${pullResult.stderr.trim()}\n`);
              sendDone('error');
              return;
            }
          } else {
            send('✅ Pull successful.\n\n');
          }
        }

        // ── 5. Push ───────────────────────────────────────────────────────────
        send('📤 Pushing to remote…\n');
        const pushArgs: string[] = remoteUrl
          ? remoteBranchExists
            ? ['push', remoteUrl, `${branch}:${branch}`]
            : ['push', '--set-upstream', remoteUrl, branch]
          : remoteBranchExists
            ? ['push', 'origin', branch]
            : ['push', '--set-upstream', 'origin', branch];

        const pushResult = await spawnGit(pushArgs, cwd, (t) => send(t));
        if (pushResult.code !== 0) {
          send(`\n❌ git push failed:\n${pushResult.stderr.trim()}\n`);
          sendDone('error');
          return;
        }

        send('\n✅ Sync complete!\n');
        sendDone('success');
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

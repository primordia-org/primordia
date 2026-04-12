# Use `continue` option for Claude agent follow-up sessions

## What changed

- `scripts/claude-worker.ts`: Added `useContinue?: boolean` to `WorkerConfig`. When set, passes `continue: true` to the `query()` call so Claude Code resumes the most recent session in the worktree directory instead of starting a fresh conversation.

- `lib/evolve-sessions.ts` (`runFollowupInWorktree`): Simplified follow-up prompt by removing the manually-built session context block (original request, prior follow-ups, git commit log). This context is now provided automatically by the SDK via session continuation. Added `useContinue: true` to the worker config for all follow-up runs.

## Why

The Claude agent SDK's `continue` option finds and resumes the most recent session in the current directory — Claude already knows what it said and did, so there's no need to re-inject conversation history via a large prompt prefix. This produces faster, better results: the model has the actual conversation history rather than a summarised reconstruction, and the prompt sent for each follow-up is much shorter.

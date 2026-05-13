# Convert `require()` calls to ES imports

Replaced all dynamic `require('child_process')` calls with top-level ES `import` statements to satisfy the `@typescript-eslint/no-require-imports` ESLint rule.

## What changed

- **`lib/session-events.ts`**: Added `import { execFileSync } from 'child_process'` at the top of the file. Removed three inline `const { execFileSync } = require('child_process') as typeof import('child_process')` declarations inside `buildSessionFromWorktreePath`, `getSessionFromFilesystem`, and `listSessionsFromFilesystem`.

- **`lib/evolve-sessions.ts`**: Extended the existing `import { spawn } from 'child_process'` to also import `execFileSync`. Removed two inline `const { execFileSync } = require('child_process') as typeof import('child_process')` declarations inside `getRepoRoot` and `getOrAssignBranchPort`.

## Why

These `require()` calls were originally written as lazy imports inside functions, possibly to avoid TypeScript module resolution issues or as a defensive pattern. Since `child_process` is a Node.js built-in available unconditionally in this server-side context, there is no reason to defer the import — a top-level static import is cleaner and satisfies the ESLint rule.

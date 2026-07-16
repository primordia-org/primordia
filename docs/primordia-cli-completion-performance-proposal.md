# Primordia CLI Completion Performance Proposal

## Implementation status

Implemented on the `citty-cli-refactor` branch. The CLI entrypoint now stays on a lightweight command-metadata path for `--help`, `completion bash`, and `__complete`; runtime command implementations live in `scripts/primordia-command-handlers.ts` and are loaded only when a real command runs or when an explicitly dynamic completion hook (such as `--user`) needs them.

Measured after the split:

```sh
$ for i in 1 2 3 4 5; do /usr/bin/time -f '%e' bun ./scripts/primordia.ts __complete sta >/dev/null; done
0.02
0.01
0.01
0.01
0.01

$ bun build ./scripts/primordia.ts --outfile /tmp/primordia.js --target bun --metafile=/tmp/meta.json
Bundled 2 modules in 5ms
primordia.js 16.11 KB

$ for i in 1 2 3 4 5; do /usr/bin/time -f '%e' bun /tmp/primordia.js __complete sta >/dev/null; done
0.01
0.01
0.01
0.01
0.01
```

The bundled completion artifact now includes only `scripts/primordia.ts` and `lib/tiny-cli.ts`. One important implementation detail: handler and dynamic completion imports use opaque module specifier constants. Bun bundles literal dynamic imports, so `import('./primordia-command-handlers')` still included the heavy handler graph in the bundle; `import(COMMAND_HANDLERS_MODULE)` keeps it out of the help/completion bundle.

## Problem

`bun run primordia __complete ...` is too slow for interactive tab completion. A representative run currently takes roughly half a second:

```sh
$ time bun ./scripts/primordia.ts __complete sta
status

real    0m0.560s
```

Bundling improves startup somewhat, but still leaves completion too slow and creates a very large artifact:

```sh
$ bun build ./scripts/primordia.ts --outfile ./cli.js --target bun
Bundled 2630 modules in ~500ms
cli.js 10.7 MB

$ time bun ./cli.js __complete sta
status

real    0m0.327s
```

For completion, the CLI should ideally start in well under 100ms and should not load agent workers, AI SDKs, Next.js helpers, SQLite migrations, or the full thread orchestration layer.

## Findings

The large bundle is not caused by the tiny CLI helper. It is caused by `scripts/primordia.ts` statically importing runtime-heavy modules at process startup, especially `lib/threads.ts`:

```ts
import { createThread, followupThread, manageThread, updateThread } from '@/lib/threads';
```

`lib/threads.ts` is a broad orchestration module. Its top-level imports pull in the pi coding agent, pi-ai, agent model registry, DB/auth helpers, process management, session event parsing, presets, and related utilities. In a Bun metafile build of `scripts/primordia.ts`, that single static import pulls the bundle up to 2630 modules and about 10.7 MB.

Largest bundle contributors from the metafile include:

| Input | Approx size |
|---|---:|
| `@earendil-works/pi-coding-agent/node_modules/jiti/dist/babel.cjs` | 1.5 MB |
| `@google/genai/dist/node/index.mjs` | 0.8 MB |
| `@earendil-works/pi-ai/dist/models.generated.js` | 0.6 MB |
| `@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` | 0.2 MB |
| `lib/threads.ts` | 0.09 MB |

A quick bundle experiment shows the impact:

```sh
$ bun build ./scripts/primordia.ts --outfile /tmp/cli.js --target bun
# /tmp/cli.js: ~10.7 MB

$ bun build ./scripts/primordia.ts --outfile /tmp/cli.js --target bun --external '@/lib/threads'
# /tmp/cli.js: ~83 KB
```

So the completion path is paying to parse and initialize code that is only needed when a real `primordia thread create|followup|update|accept|reject` command runs.

## Proposed fix

Split the CLI into a lightweight command-definition layer and lazy command handlers.

### 1. Keep command metadata import-safe and tiny

Create a small module, for example `scripts/primordia-cli-definition.ts`, that exports only the command tree metadata:

- command names
- descriptions
- options
- arguments
- static completion definitions
- handler module names or handler keys, but not handler imports

This module should import only `lib/tiny-cli.ts` types/helpers and small static data. It must not import `lib/threads.ts`, `lib/process-manager.ts`, `lib/db`, model registries, or worker harness packages.

### 2. Use lazy imports inside command handlers

Move runtime command implementations into focused modules loaded only after parsing determines that a real command should run:

- `scripts/primordia-thread-commands.ts`
  - imports `lib/threads.ts`, `lib/db`, `lib/cli-keys`, presets, etc.
- `scripts/primordia-server-commands.ts`
  - imports `lib/process-manager.ts`, `lib/production-db-copy.ts`, etc.
- `scripts/primordia-status-command.ts`
  - imports only process status/reporting code.

Then define handlers as dynamic imports:

```ts
run(context) {
  return import('./primordia-thread-commands').then((m) => m.createThreadCommand(context));
}
```

The tiny CLI runner should not evaluate those dynamic imports for `--help`, `completion bash`, or `__complete` unless a dynamic completion hook explicitly needs them.

### 3. Make completions cheap by default

Completion should use command metadata only for:

- subcommand names (`status`, `thread`, `server`, etc.)
- static option names (`--json`, `--user`, `--preset`, `--prod`, etc.)
- static argument hints

Dynamic completion hooks should be opt-in and should document their cost. Expensive hooks should be avoided on hot paths. For example:

- Keep `--preset` completion static for built-in presets, or move custom preset completion behind an explicit env gate later.
- Consider dropping `--user` dynamic DB completion if it keeps startup above the target. User completion is nice-to-have; fast tab completion is required.

### 4. Optional: add a tiny dedicated completion entrypoint

If lazy imports are not enough, add `scripts/primordia-complete.ts` as a dedicated completion-only entrypoint. The bash completion function would call:

```sh
bun run --silent primordia-complete -- "${COMP_WORDS[@]:1}"
```

This keeps the interactive shell path permanently separate from full CLI runtime concerns. The normal `bun run primordia completion bash` command can still generate that function.

### 5. Add a completion performance guard

Add a lightweight benchmark script or test that measures cold-ish completion latency and fails/warns if it regresses past a threshold, for example:

```sh
bun scripts/primordia.ts __complete sta
```

Target thresholds:

- unbundled completion: under 150ms if practical
- bundled or dedicated completion entrypoint: under 75ms if practical
- bundled completion artifact: under 250 KB unless a deliberate exception is documented

## Recommended implementation order

1. Move current command handlers out of `scripts/primordia.ts` into lazy-loaded command modules.
2. Keep `scripts/primordia.ts` as the tiny command tree + `runCli(...)` entrypoint.
3. Ensure `bun run primordia --help`, `completion bash`, and `__complete sta` do not import `lib/threads.ts`.
4. Re-run `bun build ./scripts/primordia.ts --target bun --outfile /tmp/primordia-cli.js --metafile=/tmp/meta.json` and confirm the bundle shrinks from ~10.7 MB toward the ~83 KB observed when `lib/threads.ts` is externalized.
5. Measure tab completion latency before considering the dedicated completion entrypoint.

## Expected outcome

The CLI remains organized around the internal tiny CLI helper, keeps the detailed handwritten-style help, and keeps bash completion support. The completion path becomes fast because it loads only command metadata instead of the full Primordia thread orchestration and AI provider stack.

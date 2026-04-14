// scripts/conflict-worker.ts
// Standalone conflict-resolution worker. Spawned by resolveConflictsWithClaude()
// to resolve git merge conflicts using the Pi coding agent via the exe.dev LLM
// gateway (no ANTHROPIC_API_KEY required).
//
// Usage: bun scripts/conflict-worker.ts <config-file>
//
// Config file JSON:
//   { prompt: string; worktreePath: string; repoRoot: string; resultFile: string; model?: string }
//
// Writes a JSON result to `resultFile`:
//   { success: boolean; log: string }

import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createCodingTools,
  getAgentDir,
  type ExtensionFactory,
} from '@mariozechner/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';

const GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';

interface ConflictWorkerConfig {
  prompt: string;
  worktreePath: string;
  repoRoot: string;
  resultFile: string;
  model?: string;
}

async function main(): Promise<void> {
  const configFile = process.argv[2];
  if (!configFile) {
    process.stderr.write('Usage: bun scripts/conflict-worker.ts <config-file>\n');
    process.exit(1);
  }

  let config: ConflictWorkerConfig;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as ConflictWorkerConfig;
  } catch (err) {
    process.stderr.write(`Failed to read config file: ${err}\n`);
    process.exit(1);
  }

  const { prompt, worktreePath, repoRoot, resultFile, model: modelId } = config;
  let log = '';
  let success = false;

  function writeResult(): void {
    try {
      fs.writeFileSync(resultFile, JSON.stringify({ success, log }), 'utf8');
    } catch (err) {
      process.stderr.write(`Warning: could not write result file: ${err}\n`);
    }
  }

  try {
    const authStorage = AuthStorage.create();
    // Always use gateway for system operations — no user key for conflict resolution.
    authStorage.setRuntimeApiKey('anthropic', 'gateway');
    process.stderr.write('Conflict worker: using exe.dev LLM gateway\n');

    const modelRegistry = ModelRegistry.create(authStorage);

    let model: ReturnType<typeof modelRegistry.find> | undefined;
    if (modelId) {
      model = modelRegistry.find('anthropic', modelId) ?? undefined;
      if (!model) {
        process.stderr.write(`Warning: model '${modelId}' not found in registry, using default\n`);
      }
    }

    const sessionMgr = SessionManager.create(worktreePath);

    const extensionFactories: ExtensionFactory[] = [
      (pi: Parameters<ExtensionFactory>[0]) => {
        pi.registerProvider('anthropic', { baseUrl: GATEWAY_BASE_URL });
      },
    ];

    const loader = new DefaultResourceLoader({
      cwd: worktreePath,
      agentDir: getAgentDir(),
      appendSystemPrompt: `The current working directory is: ${worktreePath}`,
      noExtensions: true,
      extensionFactories,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd: worktreePath,
      ...(model ? { model } : {}),
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager: sessionMgr,
      tools: createCodingTools(worktreePath),
    });

    // Collect text output for the log.
    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta' && ae.delta) {
          log += ae.delta;
        }
      } else if (event.type === 'tool_execution_start') {
        log += `\n- 🔧 ${event.toolName}\n`;
      }
    });

    await session.prompt(prompt);

    success = true;
    writeResult();
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log += `\nError during conflict resolution: ${msg}`;
    success = false;
    writeResult();
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled conflict worker error: ${err}\n`);
  process.exit(1);
});

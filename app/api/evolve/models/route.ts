// app/api/evolve/models/route.ts
// GET — returns the available model options for each coding agent harness.
//
// The list is hard-coded in lib/agent-config.ts so this route never imports
// @mariozechner/pi-coding-agent (an ESM-only package that caused Turbopack
// external-module resolution failures in fresh worktrees).
//
// Response shape: Record<harnessId, ModelOption[]>
//   e.g. { "pi": [...], "claude-code": [...] }

import { MODEL_OPTIONS } from '@/lib/agent-config';

/**
 * List available AI models
 * @description Returns the available model options grouped by agent harness. Cached for 60 seconds.
 * @tag Evolve
 */
export async function GET() {
  return Response.json(MODEL_OPTIONS, {
    headers: {
      // Cache for 60 s on the client; update lib/agent-config.ts when the model list changes.
      'Cache-Control': 'public, max-age=60',
    },
  });
}

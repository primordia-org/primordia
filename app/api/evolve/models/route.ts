// app/api/evolve/models/route.ts
// GET — returns the available model options for each coding agent harness.
//
// The list is built from the pi ModelRegistry at request time, so it stays
// current when the pi SDK is updated without any code changes.
//
// Response shape: Record<harnessId, ModelOption[]>
//   e.g. { "pi": [...], "claude-code": [...] }

import { getModelOptionsByHarness } from '@/lib/pi-model-registry.server';

/**
 * List available AI models
 * @description Returns the available model options grouped by agent harness. Cached for 60 seconds.
 * @tag Evolve
 */
export async function GET() {
  const models = getModelOptionsByHarness();
  return Response.json(models, {
    headers: {
      // Cache for 60 s on the client; the model list changes only on SDK upgrades.
      'Cache-Control': 'public, max-age=60',
    },
  });
}

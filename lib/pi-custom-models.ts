// lib/pi-custom-models.ts
// Custom pi model entries Primordia needs before they are available in the
// bundled @mariozechner/pi-coding-agent registry.

import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export const GEMINI_3_5_FLASH_MODEL_ID = 'gemini-3.5-flash';

const PRIMORDIA_PI_MODELS_JSON = {
  providers: {
    google: {
      models: [
        {
          id: GEMINI_3_5_FLASH_MODEL_ID,
          name: 'Gemini 3.5 Flash',
          api: 'google-generative-ai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          reasoning: true,
          thinkingLevelMap: { off: null },
          input: ['text', 'image'],
          cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 65536,
        },
      ],
    },
  },
} as const;

/**
 * Write a small pi models.json overlay and return its path.
 *
 * ModelRegistry merges this file with built-in models, so this lets Primordia
 * use newly announced provider models while waiting for the pi package registry
 * to publish matching built-in entries.
 */
export function ensurePrimordiaPiModelsJson(): string {
  const filePath = join(tmpdir(), 'primordia-pi-models.json');
  writeFileSync(filePath, JSON.stringify(PRIMORDIA_PI_MODELS_JSON, null, 2) + '\n');
  return filePath;
}

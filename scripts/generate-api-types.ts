#!/usr/bin/env bun
// scripts/generate-api-types.ts
//
// Generates lib/api-types.ts from the OpenAPI spec.
//
// Run with: bun run generate:api-types
//
// This script:
//   1. Generates public/openapi.json via next-openapi-gen (same as `bun run generate-api-docs`)
//   2. Applies a post-processing patch to fix any broken $ref entries that the
//      spec generator produces for certain TypeScript generics (e.g. Record<K,V>)
//   3. Runs openapi-typescript on the patched spec to produce lib/api-types.ts
//
// The patched spec is written to public/openapi.json so the fix persists for
// the Scalar API docs UI as well.

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const root = process.cwd();
const specPath = path.join(root, 'public', 'openapi.json');
const typesPath = path.join(root, 'lib', 'api-types.ts');

// ── Step 1: Generate the OpenAPI spec ────────────────────────────────────────

console.log('⚙️  Generating OpenAPI spec…');
execFileSync('bun', ['run', 'generate-api-docs'], { cwd: root, stdio: 'inherit' });

// ── Step 2: Patch broken $refs ────────────────────────────────────────────────

console.log('🔧 Patching OpenAPI spec…');
const spec = JSON.parse(readFileSync(specPath, 'utf-8'));

// Fix GET /evolve/models: next-openapi-gen generates a $ref to a non-existent
// "Record" schema for Record<string, ModelOption[]> return types.
// Replace with an equivalent inline schema.
const evolveModels =
  spec?.paths?.['/evolve/models']?.get?.responses?.['200']?.content?.[
    'application/json'
  ];
if (evolveModels?.schema?.$ref === '#/components/schemas/Record') {
  evolveModels.schema = {
    type: 'object',
    description:
      'Map of harness ID to array of available model options, e.g. { "pi": [...], "claude-code": [...] }',
    additionalProperties: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          pricingLabel: { type: 'string' },
          inputPriceLabel: { type: 'string' },
        },
        required: ['id', 'label', 'description'],
      },
    },
  };
  console.log('  ✔ Patched GET /evolve/models response schema');
}

writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

// ── Step 3: Generate TypeScript types ────────────────────────────────────────

console.log('📝 Generating lib/api-types.ts…');
execFileSync('bunx', ['openapi-typescript', specPath, '-o', typesPath], {
  cwd: root,
  stdio: 'inherit',
});

console.log('✅ Done — lib/api-types.ts is up to date.');

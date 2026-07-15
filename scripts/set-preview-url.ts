#!/usr/bin/env bun
/**
 * Explicitly selects the page opened by the thread preview panel.
 *
 * Usage from an agent running inside a session worktree:
 *   bun run set-preview-url /admin
 *
 * This appends a structured event to .primordia-session.ndjson so the UI does
 * not have to guess a route from free-form final text.
 */
import * as fs from 'fs';
import * as path from 'path';
import { appendSessionEvent, getSessionNdjsonPath, type SessionEvent } from '@/lib/session-events';

function usage(message?: string): never {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write('Usage: bun run set-preview-url <route-path>\n');
  process.stderr.write('Example: bun run set-preview-url /admin\n');
  process.stderr.write('Use / for the preview landing page. The path must be an app route, not a filesystem path or full URL.\n');
  process.exit(1);
}

const rawPath = process.argv[2]?.trim();
if (!rawPath) usage('Missing route path.');
if (process.argv.length > 3) usage('Expected exactly one route path argument.');

let routePath = rawPath;
if (!routePath.startsWith('/')) routePath = `/${routePath}`;

if (/^https?:\/\//i.test(rawPath)) {
  usage('Provide only the in-app route path, not a full URL.');
}
if (routePath.includes('..')) {
  usage('Route paths may not contain .. segments.');
}
if (/\s/.test(routePath)) {
  usage('Route paths may not contain whitespace.');
}
if (!/^\/[A-Za-z0-9/_?=&.#%-]*$/.test(routePath)) {
  usage('Route path contains unsupported characters.');
}

const worktreePath = process.cwd();
const ndjsonPath = getSessionNdjsonPath(worktreePath);
if (!fs.existsSync(ndjsonPath)) {
  usage(`Could not find session log at ${path.relative(process.cwd(), ndjsonPath) || ndjsonPath}. Run this from an thread worktree.`);
}

const event: SessionEvent = {
  type: 'preview_path',
  path: routePath,
  ts: Date.now(),
};
appendSessionEvent(ndjsonPath, event);
process.stdout.write(`Preview path set to ${routePath}\n`);

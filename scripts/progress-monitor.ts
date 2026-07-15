import * as fs from 'fs';
import { appendSessionEvent, getSessionNdjsonPath, readSessionEvents, type SessionEvent } from '@/lib/session-events';
import { progressSummary, reduceProgressEventsAcrossRuns, validateProgressSteps } from '@/lib/progress-monitor';

function say(message: string, code = 0): never {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  process.exit(code);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sessionLogPath(): string | null {
  const explicit = process.env.PRIMORDIA_SESSION_NDJSON;
  if (explicit) return explicit;
  const candidate = getSessionNdjsonPath(process.cwd());
  return fs.existsSync(candidate) ? candidate : null;
}

function currentProgress(ndjsonPath: string) {
  const { events } = readSessionEvents(ndjsonPath);
  return reduceProgressEventsAcrossRuns(events);
}

function ensureActive(ndjsonPath: string) {
  const state = currentProgress(ndjsonPath);
  if (state.currentIndex == null) {
    say('no active step. all steps are terminal; no future steps can be changed for this run.', 1);
  }
  return { state, currentIndex: state.currentIndex };
}

const [, , family, action, payload] = process.argv;
const ndjsonPath = sessionLogPath();
if (!ndjsonPath) say('session log not found. run this command from an thread worktree with .primordia-session.ndjson.', 1);

if (family === 'plan') {
  if (action !== 'insert' && action !== 'replace') {
    say('usage: bun run progress plan <insert|replace> <steps-json>', 1);
  }
  if (!payload) say(`usage: bun run progress plan ${action} ${shellQuote('[{"label":"Inspect relevant files","weight":1}]')}`, 1);
  const validated = validateProgressSteps(payload);
  if (!validated.ok) say(validated.error, 1);
  const state = currentProgress(ndjsonPath);
  const currentLabel = state.currentIndex == null ? 'Wrap-up' : state.steps[state.currentIndex].label;
  const event: SessionEvent = {
    type: 'progress_plan',
    mode: action === 'insert' ? 'insert' : 'replace_future',
    steps: validated.steps,
    ts: Date.now(),
  };
  appendSessionEvent(ndjsonPath, event);
  const verb = action === 'insert' ? 'inserted' : 'replaced';
  const nextState = reduceProgressEventsAcrossRuns(readSessionEvents(ndjsonPath).events);
  const activeLabel = nextState.currentIndex == null ? currentLabel : nextState.steps[nextState.currentIndex]?.label ?? currentLabel;
  say(`${verb} ${validated.steps.length} future steps after '${currentLabel}'. current step '${activeLabel}'.`);
}

if (family === 'step') {
  if (action !== 'done' && action !== 'failed') {
    if (action) say(`status '${action}' is invalid. use one of: done, failed.`, 1);
    say('usage: bun run progress step <done|failed>', 1);
  }
  const { state, currentIndex } = ensureActive(ndjsonPath);
  const currentLabel = state.steps[currentIndex].label;
  const previewEvent: SessionEvent = { type: 'progress_step', status: action, ts: Date.now() };
  const nextState = reduceProgressEventsAcrossRuns([...readSessionEvents(ndjsonPath).events, previewEvent]);
  const nextLabel = nextState.currentIndex == null ? null : nextState.steps[nextState.currentIndex]?.label ?? null;
  appendSessionEvent(ndjsonPath, { ...previewEvent, activatedNextLabel: nextLabel });
  const summary = progressSummary(nextState);
  const nextText = nextLabel ? `step '${nextLabel}' active.` : 'no next step.';
  say(`step '${currentLabel}' ${action}. ${nextText} ${summary.completeSteps}/${summary.totalSteps} complete, ${summary.weightedPercent}% weighted.`);
}

say('usage: bun run progress <plan|step> ...', 1);

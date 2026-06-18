import { describe, expect, test } from 'bun:test';
import {
  initialProgressState,
  reduceProgressEvent,
  progressSummary,
  validateProgressSteps,
  shouldRenderAgentProgressPanel,
  shouldRenderFinalSummaryOutsideProgress,
  type ProgressState,
} from '../lib/progress-monitor';

describe('dead simple progress monitor reducer', () => {
  test('starts each run with Make a plan active', () => {
    expect(initialProgressState()).toEqual({
      steps: [{ label: 'Make a plan', weight: 1, status: 'active' }],
      currentIndex: 0,
    });
  });

  test('inserts future steps after current step and advances with weighted progress', () => {
    let state: ProgressState = initialProgressState();
    state = reduceProgressEvent(state, {
      type: 'progress_plan',
      mode: 'insert',
      steps: [
        { label: 'Inspect relevant files', weight: 1 },
        { label: 'Implement changes', weight: 4 },
        { label: 'Validate changes', weight: 2 },
        { label: 'Finish up', weight: 1 },
      ],
      ts: 1,
    });

    expect(state.steps.map((step) => step.label)).toEqual([
      'Make a plan',
      'Inspect relevant files',
      'Implement changes',
      'Validate changes',
      'Finish up',
    ]);
    expect(state.steps.filter((step) => step.status === 'active')).toHaveLength(1);

    state = reduceProgressEvent(state, { type: 'progress_step', status: 'done', ts: 2 });
    expect(state.steps[0].status).toBe('done');
    expect(state.steps[1].status).toBe('active');
    expect(progressSummary(state)).toMatchObject({
      completeSteps: 1,
      totalSteps: 5,
      completeWeight: 1,
      totalWeight: 9,
      weightedPercent: 11,
    });
  });

  test('replace_future preserves terminal steps and replaces only pending future work', () => {
    let state = initialProgressState();
    state = reduceProgressEvent(state, {
      type: 'progress_plan',
      mode: 'insert',
      steps: [{ label: 'Old next' }, { label: 'Old later' }],
      ts: 1,
    });
    state = reduceProgressEvent(state, { type: 'progress_step', status: 'done', ts: 2 });
    state = reduceProgressEvent(state, {
      type: 'progress_plan',
      mode: 'replace_future',
      steps: [{ label: 'New later', weight: 3 }],
      ts: 3,
    });

    expect(state.steps).toEqual([
      { label: 'Make a plan', weight: 1, status: 'done' },
      { label: 'Old next', weight: 1, status: 'active' },
      { label: 'New later', weight: 3, status: 'pending' },
    ]);
  });

  test('failed steps do not count as complete and activate inserted repair work', () => {
    let state = initialProgressState();
    state = reduceProgressEvent(state, {
      type: 'progress_plan',
      mode: 'insert',
      steps: [{ label: 'Validate changes' }],
      ts: 1,
    });
    state = reduceProgressEvent(state, { type: 'progress_step', status: 'done', ts: 2 });
    state = reduceProgressEvent(state, {
      type: 'progress_plan',
      mode: 'insert',
      steps: [{ label: 'Fix type import errors' }, { label: 'Validate changes' }],
      ts: 3,
    });
    state = reduceProgressEvent(state, { type: 'progress_step', status: 'failed', ts: 4 });

    expect(state.steps.map((step) => [step.label, step.status])).toEqual([
      ['Make a plan', 'done'],
      ['Validate changes', 'failed'],
      ['Fix type import errors', 'active'],
      ['Validate changes', 'pending'],
    ]);
    expect(progressSummary(state).completeSteps).toBe(1);
    expect(state.steps.filter((step) => step.status === 'active')).toHaveLength(1);
  });

  test('terminal agent sections still render a progress panel without tool calls', () => {
    expect(shouldRenderAgentProgressPanel({ isAgentSection: true, hasProgressEvents: false, toolCallCount: 0 })).toBe(true);
    expect(shouldRenderAgentProgressPanel({ isAgentSection: false, hasProgressEvents: true, toolCallCount: 0 })).toBe(true);
    expect(shouldRenderAgentProgressPanel({ isAgentSection: false, hasProgressEvents: false, toolCallCount: 2 })).toBe(true);
    expect(shouldRenderAgentProgressPanel({ isAgentSection: false, hasProgressEvents: false, toolCallCount: 0 })).toBe(false);
  });

  test('final summaries render outside the progress panel', () => {
    expect(shouldRenderFinalSummaryOutsideProgress({ finalEventCount: 1, hasReloginReason: false })).toBe(true);
    expect(shouldRenderFinalSummaryOutsideProgress({ finalEventCount: 0, hasReloginReason: false })).toBe(false);
    expect(shouldRenderFinalSummaryOutsideProgress({ finalEventCount: 1, hasReloginReason: true })).toBe(false);
  });

  test('validation rejects bad step JSON shape', () => {
    expect(validateProgressSteps('[{"label":"ok","weight":2}]').ok).toBe(true);
    expect(validateProgressSteps('{"label":"not array"}')).toEqual({
      ok: false,
      error: 'step JSON is invalid: expected an array of steps with label and optional positive integer weight.',
    });
    expect(validateProgressSteps('[{"label":"bad","priority":"high"}]')).toEqual({
      ok: false,
      error: 'step JSON has unsupported fields. use only label and optional weight.',
    });
    expect(validateProgressSteps('[{"label":"bad","weight":0}]').ok).toBe(false);
  });
});

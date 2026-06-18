import type { ProgressPlanStep, ProgressStepStatus, SessionEvent } from './session-events';

export interface ProgressStateStep {
  label: string;
  weight: number;
  status: ProgressStepStatus;
}

export interface ProgressState {
  steps: ProgressStateStep[];
  currentIndex: number | null;
}

export interface ProgressSummary {
  completeSteps: number;
  totalSteps: number;
  completeWeight: number;
  totalWeight: number;
  weightedPercent: number;
}

export interface ProgressPanelVisibilityInput {
  isAgentSection: boolean;
  hasProgressEvents: boolean;
  toolCallCount: number;
}

export interface FinalSummaryVisibilityInput {
  finalEventCount: number;
  hasReloginReason: boolean;
}

export type ProgressStepValidation =
  | { ok: true; steps: ProgressPlanStep[] }
  | { ok: false; error: string };

const INVALID_STEPS_MESSAGE = 'step JSON is invalid: expected an array of steps with label and optional positive integer weight.';
const UNSUPPORTED_FIELDS_MESSAGE = 'step JSON has unsupported fields. use only label and optional weight.';

export function initialProgressState(): ProgressState {
  return {
    steps: [{ label: 'Make a plan', weight: 1, status: 'active' }],
    currentIndex: 0,
  };
}

function normalizeWeight(weight: number | undefined): number {
  return weight == null ? 1 : weight;
}

function nextPendingIndex(steps: ProgressStateStep[], afterIndex: number): number | null {
  const index = steps.findIndex((step, idx) => idx > afterIndex && step.status === 'pending');
  return index >= 0 ? index : null;
}

function withSingleActiveStep(steps: ProgressStateStep[], currentIndex: number | null): ProgressState {
  return {
    steps: steps.map((step, index) => {
      if (step.status === 'done' || step.status === 'failed') return step;
      return { ...step, status: currentIndex === index ? 'active' : 'pending' };
    }),
    currentIndex,
  };
}

export function reduceProgressEvent(state: ProgressState, event: SessionEvent): ProgressState {
  if (event.type === 'progress_plan') {
    if (state.currentIndex == null) return state;
    const currentIndex = state.currentIndex;
    const newSteps = event.steps.map((step) => ({
      label: step.label,
      weight: normalizeWeight(step.weight),
      status: 'pending' as const,
    }));
    const prefix = state.steps.slice(0, currentIndex + 1);
    const suffix = event.mode === 'insert'
      ? state.steps.slice(currentIndex + 1)
      : state.steps.slice(currentIndex + 1).filter((step) => step.status !== 'pending');
    return withSingleActiveStep([...prefix, ...newSteps, ...suffix], currentIndex);
  }

  if (event.type === 'progress_step') {
    if (state.currentIndex == null) return state;
    const currentIndex = state.currentIndex;
    const steps = state.steps.map((step, index) => index === currentIndex ? { ...step, status: event.status } : step);
    const nextIndex = nextPendingIndex(steps, currentIndex);
    return withSingleActiveStep(steps, nextIndex);
  }

  return state;
}

export function reduceProgressEvents(events: SessionEvent[]): ProgressState {
  return events.reduce(reduceProgressEvent, initialProgressState());
}

export function progressSummary(state: ProgressState): ProgressSummary {
  const completeSteps = state.steps.filter((step) => step.status === 'done').length;
  const completeWeight = state.steps.reduce((sum, step) => sum + (step.status === 'done' ? step.weight : 0), 0);
  const totalWeight = state.steps.reduce((sum, step) => sum + step.weight, 0);
  return {
    completeSteps,
    totalSteps: state.steps.length,
    completeWeight,
    totalWeight,
    weightedPercent: totalWeight > 0 ? Math.round((completeWeight / totalWeight) * 100) : 0,
  };
}

export function shouldRenderAgentProgressPanel(input: ProgressPanelVisibilityInput): boolean {
  return input.isAgentSection || input.hasProgressEvents || input.toolCallCount > 0;
}

export function shouldRenderFinalSummaryOutsideProgress(input: FinalSummaryVisibilityInput): boolean {
  return input.finalEventCount > 0 && !input.hasReloginReason;
}

export function progressTickMarks(state: ProgressState): number[] {
  return state.steps.slice(0, -1).reduce<number[]>((marks, step) => {
    const previous = marks.at(-1) ?? 0;
    marks.push(previous + step.weight);
    return marks;
  }, []);
}

export function validateProgressSteps(input: string): ProgressStepValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { ok: false, error: INVALID_STEPS_MESSAGE };
  }

  if (!Array.isArray(parsed)) return { ok: false, error: INVALID_STEPS_MESSAGE };

  const steps: ProgressPlanStep[] = [];
  for (const raw of parsed) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: INVALID_STEPS_MESSAGE };
    }
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => key !== 'label' && key !== 'weight')) {
      return { ok: false, error: UNSUPPORTED_FIELDS_MESSAGE };
    }
    if (typeof record.label !== 'string' || !record.label.trim()) {
      return { ok: false, error: INVALID_STEPS_MESSAGE };
    }
    let weight: number | undefined;
    if (record.weight != null) {
      const rawWeight = record.weight;
      if (typeof rawWeight !== 'number' || !Number.isInteger(rawWeight) || rawWeight <= 0) {
        return { ok: false, error: INVALID_STEPS_MESSAGE };
      }
      weight = rawWeight;
    }
    steps.push({ label: record.label.trim(), ...(weight == null ? {} : { weight }) });
  }

  return { ok: true, steps };
}

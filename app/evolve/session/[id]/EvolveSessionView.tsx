"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Streams live Claude Code progress via SSE from /api/evolve/stream.

import { useState, useRef, useEffect, useCallback } from "react";
import { GitBranch, Loader2, FileText, Copy, Check, RotateCw, Key, FileKey } from "lucide-react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { MarkdownContent } from "@/components/MarkdownContent";
import { NavHeader } from "@/components/NavHeader";

import { FloatingEvolveDialog, EvolveSubmitToast } from "@/components/FloatingEvolveDialog";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";
import { useSessionUser } from "@/lib/hooks";
import { withBasePath } from "@/lib/base-path";
import { encryptStoredApiKey } from "@/lib/api-key-client";
import { useSounds } from "@/lib/sounds";
import { encryptStoredCredentials } from "@/lib/credentials-client";
import { EvolveRequestForm } from "@/components/EvolveRequestForm";
import Link from "next/link";
import type { DiffFileSummary } from "./page";
import { DiffFileExpander } from "./DiffFileExpander";
import { WebPreviewPanel, type ElementSelection } from "./WebPreviewPanel";
import HorizontalResizeHandle from "./HorizontalResizeHandle";
import type { SessionEvent, AgentAuthInfo } from "@/lib/session-events";
import { HARNESS_OPTIONS, type ModelOption } from "@/lib/agent-config";
import { deriveSmartPreviewUrl } from "@/lib/smart-preview-url";

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface SectionMetrics {
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function MetricsRow({ metrics }: { metrics: SectionMetrics }) {
  const { durationMs, costUsd, inputTokens, outputTokens } = metrics;
  const hasAny = durationMs != null || costUsd != null || inputTokens != null || outputTokens != null;
  if (!hasAny) return null;
  return (
    <div className="px-4 py-2 border-t border-gray-800 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
      {durationMs != null && (
        <span>
          <span className="text-gray-600">Time</span>{" "}
          <span className="text-gray-300 font-mono">{formatDuration(durationMs)}</span>
        </span>
      )}
      {costUsd != null && (
        <span>
          <span className="text-gray-600">Cost</span>{" "}
          <span className="text-gray-300 font-mono">${costUsd.toFixed(4)}</span>
        </span>
      )}
      {(inputTokens != null || outputTokens != null) && (
        <span>
          <span className="text-gray-600">Tokens</span>{" "}
          <span className="text-gray-300 font-mono">
            {inputTokens != null ? inputTokens.toLocaleString() : "?"} in
            {" / "}
            {outputTokens != null ? outputTokens.toLocaleString() : "?"} out
          </span>
        </span>
      )}
    </div>
  );
}

// ─── Structured event rendering ───────────────────────────────────────────────

/** A logical section derived from structured session events. */
interface SectionGroup {
  type: 'setup' | 'agent' | 'claude' | 'type_fix' | 'auto_commit' | 'followup' | 'deploy' | 'conflict_resolution';
  label: string;
  harness?: string;
  model?: string;
  /** Stable IDs for harness/model — used by the follow-up form to populate selects correctly. */
  harnessId?: string;
  modelId?: string;
  /** Auth source recorded in the section_start event for this agent run. */
  auth?: AgentAuthInfo;
  /** Unix ms timestamp from the section_start event — used for live elapsed-time display. */
  startTs?: number;
  events: SessionEvent[];
}

/** Group a flat list of SessionEvents into display sections. */
function groupEventsIntoSections(events: SessionEvent[]): SectionGroup[] {
  const sections: SectionGroup[] = [{ type: 'setup', label: 'Setup', events: [] }];
  for (const event of events) {
    if (event.type === 'section_start') {
      const group: SectionGroup = { type: event.sectionType, label: event.label, events: [], startTs: event.ts };
      if (event.sectionType === 'agent') {
        group.harness = event.harness;
        group.model = event.model;
        group.harnessId = event.harnessId;
        group.modelId = event.modelId;
        group.auth = event.auth;
      }
      sections.push(group);
    } else {
      sections[sections.length - 1].events.push(event);
    }
  }
  return sections;
}

/** Render a TodoWrite tool call as a structured todo list. */
function TodoWriteDisplay({ input }: { input: Record<string, unknown> }) {
  const todos = (input.todos as Array<{ content: string; status: string; priority?: string }> | undefined) ?? [];
  if (!todos.length) return <span className="text-gray-600">Update todo list</span>;
  const statusIcon = (status: string) =>
    status === 'completed' ? '✅' : status === 'in_progress' ? '🔄' : '⬜';
  return (
    <span className="inline-flex flex-col gap-0.5">
      {todos.map((t, i) => (
        <span key={i} className={`flex items-start gap-1 ${t.status === 'completed' ? 'text-gray-600 line-through' : t.status === 'in_progress' ? 'text-yellow-400' : 'text-gray-400'}`}>
          <span className="shrink-0">{statusIcon(t.status)}</span>
          <span>{t.content}</span>
        </span>
      ))}
    </span>
  );
}

/** Generate a short human-readable description of a tool call's primary argument. */
function summarizeToolInput(name: string, input: Record<string, unknown>, worktreePath?: string): string {
  const shorten = (p: string): string => {
    if (!worktreePath || !p) return p;
    const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';
    if (p === worktreePath) return '.';
    if (p.startsWith(prefix)) return './' + p.slice(prefix.length);
    return p;
  };

  const lname = name.toLowerCase();
  if (lname === 'bash') {
    const rawCmd = typeof input.command === 'string' ? input.command : '';
    let cmd = rawCmd;
    if (worktreePath) {
      const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';
      cmd = cmd.split(prefix).join('./');
      cmd = cmd.split(worktreePath).join('.');
    }
    return cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd;
  }
  if (lname === 'grep') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    const path = typeof input.path === 'string' ? shorten(input.path) : null;
    const glob = typeof input.glob === 'string' ? input.glob : null;
    const type = typeof input.type === 'string' ? input.type : null;
    const parts: string[] = [`"${pattern.length > 50 ? pattern.slice(0, 50) + '…' : pattern}"`];
    if (path && path !== '.') parts.push(`in ${path}`);
    if (glob) parts.push(`[${glob}]`);
    else if (type) parts.push(`[${type}]`);
    return parts.join(' ');
  }
  if (lname === 'glob') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    const path = typeof input.path === 'string' ? shorten(input.path) : null;
    const parts: string[] = [pattern.length > 60 ? '…' + pattern.slice(-60) : pattern];
    if (path && path !== '.') parts.push(`in ${path}`);
    return parts.join(' ');
  }
  // For file tools, show the path (with optional line range for Read)
  for (const key of ['file_path', 'path', 'pattern', 'glob']) {
    if (typeof input[key] === 'string') {
      const val = shorten(input[key] as string);
      const shortened = val.length > 80 ? '…' + val.slice(-80) : val;
      if (lname === 'read' && typeof input.offset === 'number') {
        const end = typeof input.limit === 'number' ? input.offset + input.limit - 1 : null;
        return end != null ? `${shortened}:${input.offset}-${end}` : `${shortened}:${input.offset}`;
      }
      if (lname === 'edit' && typeof input.new_string === 'string') {
        const preview = input.new_string.trim().split('\n')[0].trim();
        const clipped = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
        return `${shortened} "${clipped}"`;
      }
      return shortened;
    }
  }
  // Generic fallback: first key=value pair
  const entries = Object.entries(input).slice(0, 1);
  if (entries.length === 0) return '';
  const [k, v] = entries[0];
  const val = typeof v === 'string' ? v : JSON.stringify(v);
  return `${k}=${val.length > 60 ? val.slice(0, 60) + '…' : val}`;
}

/**
 * Collapse runs of consecutive text events into single events by concatenating
 * their content. This is necessary because Pi streams text as many small delta
 * chunks — each stored as a separate { type: 'text' } event — which would
 * otherwise each render as their own block element, fragmenting the prose.
 */
type RenderableEvent = Extract<SessionEvent, { type: 'tool_use' }>
  | Extract<SessionEvent, { type: 'text' }>
  | Extract<SessionEvent, { type: 'log_line' }>
  | Extract<SessionEvent, { type: 'thinking' }>;

function mergeConsecutiveTextEvents(events: RenderableEvent[]): RenderableEvent[] {
  const merged: RenderableEvent[] = [];
  for (const event of events) {
    const last = merged[merged.length - 1];
    if (event.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { ...last, content: last.content + event.content };
      continue;
    }
    // Merge consecutive thinking deltas into a single thinking block.
    if (event.type === 'thinking' && last?.type === 'thinking') {
      merged[merged.length - 1] = { ...last, content: last.content + event.content };
      continue;
    }
    merged.push(event);
  }
  return merged;
}

/**
 * Render an extended thinking / reasoning block as a collapsible details element.
 * Empty content (start-marker event before any deltas arrive) shows an animated
 * "Reasoning in progress..." indicator instead of a blank block.
 */
function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <details className="group/thinking my-1">
      <summary className="flex items-center gap-1.5 text-xs cursor-pointer select-none list-none">
        <span className="inline-block group-open/thinking:rotate-90 transition-transform text-gray-600">▶</span>
        <span className="text-gray-500">🧠 Thinking</span>
      </summary>
      {content ? (
        <div className="mt-1 ml-4 pl-3 border-l border-gray-800 text-xs text-gray-500 font-mono whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">
          {content}
        </div>
      ) : (
        <div className="mt-1 ml-4 pl-3 border-l border-gray-800 text-xs text-gray-600 italic">
          {isStreaming ? 'Thinking...' : 'No content'}
        </div>
      )}
    </details>
  );
}

/** Split content events into "detail" events (before/including last tool_use) and "final" events. */
function splitAgentEventsForDisplay(events: SessionEvent[]): {
  detailEvents: RenderableEvent[];
  finalEvents: RenderableEvent[];
  toolCallCount: number;
} {
  const content = events.filter(
    (e): e is RenderableEvent => e.type === 'tool_use' || e.type === 'text' || e.type === 'thinking' || e.type === 'log_line',
  );
  let lastToolIdx = -1;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'tool_use') { lastToolIdx = i; break; }
  }
  const toolCallCount = content.filter((e) => e.type === 'tool_use').length;
  if (lastToolIdx === -1) {
    return { detailEvents: [], finalEvents: content.filter((e): e is RenderableEvent => e.type !== 'tool_use'), toolCallCount: 0 };
  }
  return {
    detailEvents: content.slice(0, lastToolIdx + 1),
    finalEvents: content.slice(lastToolIdx + 1).filter((e): e is RenderableEvent => e.type !== 'tool_use'),
    toolCallCount,
  };
}

/**
 * Small icon badge shown next to the agent name indicating which auth source
 * was used for the run. Nothing is rendered for the exe.dev gateway (default).
 */
function AgentAuthBadge({ auth }: { auth?: AgentAuthInfo }) {
  if (!auth || auth.source === 'llm-gateway') return null;
  if (auth.source === 'api-key') {
    return (
      <span title="Used API Key" className="inline-flex items-center text-amber-400/70 hover:text-amber-400 transition-colors cursor-default">
        <Key size={11} strokeWidth={2.5} aria-label="Used API Key" />
      </span>
    );
  }
  if (auth.source === 'claude-credentials') {
    return (
      <span title="Used Claude Credentials" className="inline-flex items-center text-sky-400/70 hover:text-sky-400 transition-colors cursor-default">
        <FileKey size={11} strokeWidth={2.5} aria-label="Used Claude Credentials" />
      </span>
    );
  }
  return null;
}

/** Render a running agent/type-fix/auto-commit section (streaming events live). */
function RunningAgentSection({ events, label, isTypeFixSection, isAutoCommitSection, worktreePath, harness, model, auth, startTs }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  isAutoCommitSection: boolean;
  worktreePath?: string;
  harness?: string;
  model?: string;
  auth?: AgentAuthInfo;
  startTs?: number;
}) {
  const borderClass = isAutoCommitSection ? "border-green-700/50" : isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isAutoCommitSection ? "text-green-300" : isTypeFixSection ? "text-orange-300" : "text-blue-300";
  const agentLabel = harness ? (model ? `${harness} (${model})` : harness) : 'Claude Code';
  const runningLabel = (isTypeFixSection || isAutoCommitSection) ? label : `🤖 ${agentLabel} running…`;

  // Live elapsed-time counter updated every second.
  const [elapsed, setElapsed] = useState<number>(startTs ? Date.now() - startTs : 0);
  useEffect(() => {
    if (!startTs) return;
    setElapsed(Date.now() - startTs);
    const id = setInterval(() => setElapsed(Date.now() - startTs), 1000);
    return () => clearInterval(id);
  }, [startTs]);

  // Most-recent partial metrics emitted by the worker (if any).
  const latestMetrics = [...events].reverse().find((e): e is Extract<SessionEvent, { type: 'metrics' }> => e.type === 'metrics');

  return (
    <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className={`font-semibold text-xs ${headingClass}`}>{runningLabel}</span>
        {!isTypeFixSection && !isAutoCommitSection && <AgentAuthBadge auth={auth} />}
        <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs">
          <span className="flex items-center gap-1.5 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
          </span>
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {mergeConsecutiveTextEvents(
          events.filter((e): e is RenderableEvent => e.type === 'tool_use' || e.type === 'text' || e.type === 'log_line' || e.type === 'thinking')
        ).map((event, i) => {
          if (event.type === 'tool_use') {
            if (event.name.toLowerCase() === 'todowrite') {
              return (
                <div key={i} className="text-xs font-mono">
                  <span className="text-gray-400">📋 TodoWrite</span>
                  <div className="mt-1 ml-4"><TodoWriteDisplay input={event.input} /></div>
                </div>
              );
            }
            const summary = summarizeToolInput(event.name, event.input, worktreePath);
            return (
              <p key={i} className="text-gray-400 text-xs font-mono">
                🔧 {event.name}{summary ? <span className="text-gray-600"> {summary}</span> : null}
              </p>
            );
          }
          if (event.type === 'text') {
            return <MarkdownContent key={i} text={event.content} className="[&>*:last-child]:mb-0" />;
          }
          if (event.type === 'log_line') {
            return <p key={i} className="text-gray-500 text-xs">{event.content}</p>;
          }
          if (event.type === 'thinking') {
            return <ThinkingBlock key={i} content={event.content} isStreaming />;
          }
          return null;
        })}
      </div>
      {latestMetrics && (
        <MetricsRow metrics={{
          durationMs: elapsed > 0 ? elapsed : (latestMetrics.durationMs ?? undefined),
          costUsd: latestMetrics.costUsd ?? undefined,
          inputTokens: latestMetrics.inputTokens ?? undefined,
          outputTokens: latestMetrics.outputTokens ?? undefined,
        }} />
      )}
    </div>
  );
}

/** Render a completed agent/type-fix/auto-commit section with tool calls collapsed. */
function DoneAgentSection({ events, label, isTypeFixSection, isAutoCommitSection, worktreePath, harness, model, auth, startTs }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  isAutoCommitSection: boolean;
  worktreePath?: string;
  harness?: string;
  model?: string;
  auth?: AgentAuthInfo;
  startTs?: number;
}) {
  const resultEvent = events.find((e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result');
  // Use the LAST metrics event — the final one written after the result event
  // contains accurate totals, while earlier intermediate events are partial
  // snapshots emitted after each assistant turn.
  const metricsEvent = [...events].reverse().find((e): e is Extract<SessionEvent, { type: 'metrics' }> => e.type === 'metrics');
  const hasError = resultEvent?.subtype === 'error' || resultEvent?.subtype === 'timeout' || resultEvent?.subtype === 'aborted';

  const borderClass = isAutoCommitSection ? "border-green-700/50" : isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isAutoCommitSection ? "text-green-300" : isTypeFixSection ? "text-orange-300" : "text-blue-300";
  const doneBorderClass = hasError ? "border-red-700/50" : borderClass;
  const doneHeadingClass = hasError ? "text-red-400" : headingClass;
  const agentLabel = harness ? (model ? `${harness} (${model})` : harness) : 'Claude Code';
  const doneTitle = hasError
    ? (isAutoCommitSection ? "❌ Auto-commit failed" : isTypeFixSection ? "❌ Auto-fix failed" : `❌ ${agentLabel} errored`)
    : (isAutoCommitSection ? "📦 Unstaged changes committed" : isTypeFixSection ? "🔧 Type errors fixed" : `🤖 ${agentLabel} finished`);

  const { detailEvents, finalEvents, toolCallCount } = splitAgentEventsForDisplay(events);

  return (
    <div className={`rounded-lg border ${doneBorderClass} bg-gray-900 text-sm overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className={`font-semibold text-xs ${doneHeadingClass}`}>{doneTitle}</span>
        {!isTypeFixSection && !isAutoCommitSection && <AgentAuthBadge auth={auth} />}
      </div>
      {toolCallCount > 0 && (
        <details className="group border-b border-gray-800">
          <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
            <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
            <span className="text-gray-500">🔧 {toolCallCount} tool call{toolCallCount !== 1 ? "s" : ""} made</span>
          </summary>
          <div className="px-4 py-3 border-t border-gray-800 space-y-2">
            {mergeConsecutiveTextEvents(detailEvents).map((event, i) => {
              if (event.type === 'tool_use') {
                if (event.name.toLowerCase() === 'todowrite') {
                  return (
                    <div key={i} className="text-xs font-mono">
                      <span className="text-gray-400">📋 TodoWrite</span>
                      <div className="mt-1 ml-4"><TodoWriteDisplay input={event.input} /></div>
                    </div>
                  );
                }
                const summary = summarizeToolInput(event.name, event.input, worktreePath);
                return (
                  <p key={i} className="text-gray-400 text-xs font-mono">
                    🔧 {event.name}{summary ? <span className="text-gray-600"> {summary}</span> : null}
                  </p>
                );
              }
              if (event.type === 'text') {
                return <MarkdownContent key={i} text={event.content} className="[&>*:last-child]:mb-0" />;
              }
              if (event.type === 'thinking') {
                return <ThinkingBlock key={i} content={event.content} />;
              }
              return null;
            })}
          </div>
        </details>
      )}
      {finalEvents.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          {mergeConsecutiveTextEvents(finalEvents).map((event, i) => {
            if (event.type === 'thinking') {
              return <ThinkingBlock key={i} content={event.content} />;
            }
            if (event.type === 'text') {
              return <MarkdownContent key={i} text={event.content} />;
            }
            return null;
          })}
        </div>
      )}
      {hasError && resultEvent?.message && (
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-xs font-semibold text-red-400 mb-1">Error details</p>
          <pre className="text-xs text-red-300 whitespace-pre-wrap break-all font-mono bg-red-950/30 rounded p-2">{resultEvent.message}</pre>
        </div>
      )}
      {metricsEvent && (
        <MetricsRow metrics={{
          // Prefer the recorded durationMs; fall back to computing from
          // section_start → result timestamps when durationMs is null/0.
          durationMs: (metricsEvent.durationMs != null && metricsEvent.durationMs > 0)
            ? metricsEvent.durationMs
            : (startTs != null && resultEvent != null ? resultEvent.ts - startTs : undefined),
          costUsd: metricsEvent.costUsd ?? undefined,
          inputTokens: metricsEvent.inputTokens ?? undefined,
          outputTokens: metricsEvent.outputTokens ?? undefined,
        }} />
      )}
    </div>
  );
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

function AttachmentChip({ name, sessionId }: { name: string; sessionId: string }) {
  const url = withBasePath(`/api/evolve/attachment/${encodeURIComponent(sessionId)}?file=${encodeURIComponent(name)}`);
  const ext = name.includes('.') ? ('.' + name.split('.').pop()!.toLowerCase()) : '';
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300 font-mono hover:bg-gray-700 hover:border-gray-600 transition-colors max-w-[200px]"
      title={name}
    >
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-4 w-4 rounded object-cover flex-shrink-0" />
      )}
      {isMarkdown && (
        <FileText size={12} className="flex-shrink-0 text-gray-400" aria-hidden="true" />
      )}
      <span className="truncate">{name}</span>
    </a>
  );
}

/** Render a single non-setup, non-legacy section. */
function StructuredSection({
  section,
  isActive,
  sessionId,
  worktreePath,
}: {
  section: SectionGroup;
  isActive: boolean;
  sessionId: string;
  worktreePath?: string;
}) {
  const { type, label, harness, model, events, startTs } = section;

  // ── Follow-up request ────────────────────────────────────────────────────
  if (type === 'followup') {
    const requestEvent = events.find((e): e is Extract<SessionEvent, { type: 'followup_request' }> => e.type === 'followup_request');
    const agentEvents = events.filter((e) => e.type !== 'followup_request');
    const hasResult = agentEvents.some((e) => e.type === 'result');
    return (
      <>
        {requestEvent && (
          <div className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm overflow-x-auto">
            <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Follow-up request</p>
            <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{requestEvent.request}</p>
            {requestEvent.attachments && requestEvent.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {requestEvent.attachments.map((name) => (
                  <AttachmentChip key={name} name={name} sessionId={sessionId} />
                ))}
              </div>
            )}
          </div>
        )}
        {agentEvents.length > 0 && (
          isActive && !hasResult
            ? <RunningAgentSection events={agentEvents} label={label} isTypeFixSection={false} isAutoCommitSection={false} worktreePath={worktreePath} harness={harness} model={model} auth={section.auth} startTs={startTs} />
            : <DoneAgentSection events={agentEvents} label={label} isTypeFixSection={false} isAutoCommitSection={false} worktreePath={worktreePath} harness={harness} model={model} auth={section.auth} startTs={startTs} />
        )}
      </>
    );
  }

  // ── Agent / Claude Code (legacy) / type_fix / auto_commit / conflict_resolution ──
  if (type === 'agent' || type === 'claude' || type === 'type_fix' || type === 'auto_commit' || type === 'conflict_resolution') {
    const hasResult = events.some((e) => e.type === 'result');
    if (isActive && !hasResult) {
      return <RunningAgentSection events={events} label={label} isTypeFixSection={type === 'type_fix'} isAutoCommitSection={type === 'auto_commit'} worktreePath={worktreePath} harness={harness} model={model} auth={section.auth} startTs={startTs} />;
    }
    return <DoneAgentSection events={events} label={label} isTypeFixSection={type === 'type_fix'} isAutoCommitSection={type === 'auto_commit'} worktreePath={worktreePath} harness={harness} model={model} auth={section.auth} startTs={startTs} />;
  }

  // ── Deploy ───────────────────────────────────────────────────────────────
  if (type === 'deploy') {
    // Concatenate log_line chunks verbatim — no added separators — so that
    // \r and ANSI erase-EOL sequences in the ANSI-mode install.sh output are
    // preserved for AnsiRenderer to process into the correct final lines.
    const rawLog = events
      .filter((e): e is Extract<SessionEvent, { type: 'log_line' }> => e.type === 'log_line')
      .map((e) => e.content)
      .join('');
    const resultEvent = events.find((e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result');
    const decisionEvent = events.find((e): e is Extract<SessionEvent, { type: 'decision' }> => e.type === 'decision');
    const isProduction = label.includes("production");
    const mergedIntoBranch = !isProduction ? (label.match(/into `([^`]+)`/) ?? [])[1] ?? null : null;

    const hasDeployError = resultEvent?.subtype === 'error' || resultEvent?.subtype === 'timeout';
    // A deploy section is only truly successful when a decision:accepted event
    // is present in its events. Without one, the section was interrupted
    // (e.g. type errors found mid-deploy, triggering a type_fix pass).
    const hasDeploySuccess = !hasDeployError && decisionEvent?.action === 'accepted';

    if (isActive && !hasDeploySuccess && !hasDeployError) {
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-gray-300">{label}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Running…
            </span>
          </div>
          {rawLog && <div className="px-4 py-3"><AnsiRenderer text={rawLog} /></div>}
        </div>
      );
    }

    if (hasDeployError) {
      const errorMessage = (resultEvent?.message ?? 'The deploy failed with an unknown error.').replace(/^❌\s*/, '');
      return (
        <div className="rounded-lg bg-red-900/40 border border-red-700/50 text-sm overflow-hidden">
          <div className="px-4 py-4">
            <p className="text-red-200 font-semibold">❌ Deploy failed</p>
            <p className="text-red-300/80 text-xs mt-1">{errorMessage}</p>
          </div>
          {rawLog && (
            <details className="group border-t border-red-800/50">
              <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-red-900/30 transition-colors list-none text-xs">
                <span className="text-red-700 group-open:rotate-90 transition-transform">▶</span>
                <span className="text-red-700/80">Deploy log</span>
              </summary>
              <div className="px-4 py-3 border-t border-red-800/50">
                <AnsiRenderer text={rawLog} />
              </div>
            </details>
          )}
        </div>
      );
    }

    if (!hasDeploySuccess) {
      // Deploy section was interrupted before completion (type errors triggered
      // an auto-fix pass). Show partial logs in a neutral style — the
      // subsequent deploy section will show the final outcome.
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-gray-400">{label}</span>
            <span className="ml-auto text-gray-600 text-xs">paused — fixing type errors</span>
          </div>
          {rawLog && <div className="px-4 py-3"><AnsiRenderer text={rawLog} className="opacity-60" /></div>}
        </div>
      );
    }

    const doneTitle = isProduction ? "🚀 Deployed to production" : label.replace(/🚀\s*Merging into/, "✅ Merged into").replace(/🚀\s*Deploying into/, "✅ Merged into");
    return (
      <div className="rounded-lg bg-green-900/40 border border-green-700/50 text-sm overflow-hidden">
        <div className="px-4 py-4">
          <p className="text-green-200 font-semibold">{doneTitle}</p>
          <p className="text-green-300/80 text-xs mt-1">
            {isProduction ? "The branch was deployed to production."
              : mergedIntoBranch
                ? <>The branch was merged into <code className="bg-green-950/60 px-1 rounded">{mergedIntoBranch}</code> and the worktree has been removed.</>
                : "The branch was accepted and the worktree has been removed."}
          </p>
        </div>
        {rawLog && (
          <details className="group border-t border-green-800/50">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-green-900/30 transition-colors list-none text-xs">
              <span className="text-green-700 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-green-700/80">Deploy log</span>
            </summary>
            <div className="px-4 py-3 border-t border-green-800/50">
              <AnsiRenderer text={rawLog} />
            </div>
          </details>
        )}
      </div>
    );
  }

  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

// Shared web-preview card: iframe/placeholder + server logs in one unit.
// Used for both the inline (mobile) position and the desktop sidebar so the
// two places are literally the same component.
function WebPreviewCard({
  fullHeight,
  previewUrl,
  proxyServerStatus,
  serverLogs,
  canEvolve,
  isRestartingServer,
  restartError,
  onRestartServer,
  onElementSelected,
}: {
  fullHeight: boolean;
  previewUrl: string | null;
  proxyServerStatus: 'starting' | 'running' | 'stopped' | 'unknown';
  serverLogs: string;
  canEvolve: boolean;
  isRestartingServer: boolean;
  restartError: string | null;
  onRestartServer: () => void;
  onElementSelected: (info: ElementSelection) => void;
}) {
  return (
    <div className={`rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden flex flex-col${fullHeight ? ' h-full' : ''}`}>
      {restartError && (
        <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-800 flex-shrink-0">{restartError}</p>
      )}

      {/* Iframe / placeholder area */}
      <div className={fullHeight ? 'flex-1 min-h-0' : ''}>
        {proxyServerStatus === 'running' && previewUrl ? (
          <WebPreviewPanel
            src={previewUrl}
            fullHeight={fullHeight}
            onElementSelected={onElementSelected}
          />
        ) : (
          <div className={`flex flex-col items-center justify-center gap-4${fullHeight ? ' h-full' : ' h-[600px]'}`}>
            {proxyServerStatus === 'starting' ? (
              <>
                <div className="w-20 h-20 rounded-full border-2 border-yellow-600 text-yellow-400 flex items-center justify-center animate-pulse">
                  <span className="text-3xl ml-1">▶</span>
                </div>
                <span className="text-sm text-yellow-600 animate-pulse">Starting preview…</span>
              </>
            ) : (
              <>
                <button
                  data-id="session/start-preview"
                  type="button"
                  onClick={onRestartServer}
                  disabled={isRestartingServer}
                  className="w-20 h-20 rounded-full border-2 border-gray-500 hover:border-white text-gray-400 hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-3xl ml-1">▶</span>
                </button>
                <span className="text-sm text-gray-400">Start Preview</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Server logs — always collapsible; auto-open when stopped */}
      <details className="group flex-shrink-0 border-t border-emerald-700/50" open={proxyServerStatus === 'stopped'}>
        <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
          <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
          <span className="text-gray-500">🪵 Server logs</span>
          {canEvolve && proxyServerStatus === 'running' && (
            <button
              data-id="session/restart-preview"
              type="button"
              onClick={(e) => { e.preventDefault(); onRestartServer(); }}
              className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              <RotateCw size={12} />Restart
            </button>
          )}
        </summary>
        <div className="px-4 py-3 border-t border-gray-800">
          {serverLogs ? (
            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono overflow-x-auto max-h-48 overflow-y-auto">{serverLogs}</pre>
          ) : (
            <p className="text-xs text-gray-600 italic">No logs yet…</p>
          )}
        </div>
      </details>
    </div>
  );
}

interface EvolveSessionViewProps {
  sessionId: string;
  initialRequest: string;
  /** Initial structured events loaded server-side (empty for new sessions with no NDJSON yet). */
  initialEvents: SessionEvent[];
  /** Number of NDJSON lines already included in initialEvents, for SSE reconnection offset. */
  initialLineCount: number;
  initialStatus: string;
  initialPreviewUrl: string | null;
  /** The currently checked-out branch in this instance. Used in confirmation copy and NavHeader. */
  branch?: string | null;
  /** The branch this session was branched from (from git config). Used in upstream-changes display. */
  parentBranch?: string | null;
  /** The preview branch name created for this session. */
  sessionBranch: string;
  /** True when the session branch is a direct child of the current branch, so Accept/Reject are safe to show. */
  canAcceptReject: boolean;
  /** Number of commits on the parent branch not yet in the session branch. */
  upstreamCommitCount: number;
  /** Per-file diff summary for files changed in this session branch vs its parent. */
  diffSummary: DiffFileSummary[];
  /** True when the current user has the can_evolve (or admin) permission. Actions are hidden when false. */
  canEvolve: boolean;
  /** True when running in production mode (NODE_ENV=production). Changes accept confirmation copy to describe blue/green cutover instead of a merge. */
  isProduction: boolean;
  /** Absolute path to the session's worktree, used to shorten file paths in tool call display. */
  worktreePath: string;
  /** Sticky harness preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialHarness?: string;
  /** Sticky model preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialModel?: string;
  /** Sticky caveman mode preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialCavemanMode?: boolean;
  /** Sticky caveman intensity preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialCavemanIntensity?: import("@/lib/user-prefs").CavemanIntensity;
}

// ─── CopyBranchName ──────────────────────────────────────────────────────────

function CopyBranchName({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(branch).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <code className="font-mono text-amber-200 text-sm">{branch}</code>
      <button
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy branch name"}
        className="flex-shrink-0 p-1 rounded text-amber-500 hover:text-amber-200 hover:bg-amber-700/40 transition-colors"
        aria-label={copied ? "Copied!" : "Copy branch name"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvolveSessionView({
  sessionId,
  initialRequest,
  initialEvents,
  initialLineCount,
  initialStatus,
  initialPreviewUrl,
  branch,
  parentBranch,
  sessionBranch,
  canAcceptReject,
  upstreamCommitCount,
  diffSummary,
  canEvolve,
  isProduction,
  worktreePath,
  initialHarness,
  initialModel,
  initialCavemanMode,
  initialCavemanIntensity,
}: EvolveSessionViewProps) {
  const [modelOptionsByHarness, setModelOptionsByHarness] = useState<Record<string, ModelOption[]>>({});
  useEffect(() => {
    fetch(withBasePath('/api/evolve/models'))
      .then((r) => r.json())
      .then((data: Record<string, ModelOption[]>) => setModelOptionsByHarness(data))
      .catch(() => { /* silently fall back to empty list */ });
  }, []);

  const [events, setEvents] = useState<SessionEvent[]>(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  /** Status of the preview server as reported by the proxy management API. */
  const [proxyServerStatus, setProxyServerStatus] = useState<'starting' | 'running' | 'stopped' | 'unknown'>('unknown');
  /** Accumulated log lines from the proxy's server log SSE stream. */
  const [serverLogs, setServerLogs] = useState<string>('');

  const sounds = useSounds();
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const [toastSessionId, setToastSessionId] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const { sessionUser, handleLogout } = useSessionUser();
  const [acceptRejectLoading, setAcceptRejectLoading] = useState(false);
  const [acceptRejectError, setAcceptRejectError] = useState<string | null>(null);
  /** Session ID of a stuck 'accepting' session that is blocking this accept (from a 409 response). */
  const [stuckBlockingSessionId, setStuckBlockingSessionId] = useState<string | null>(null);
  const [isResettingStuck, setIsResettingStuck] = useState(false);
  const [forceResetError, setForceResetError] = useState<string | null>(null);
  /** Timestamp of the last NDJSON event received from the SSE stream (ms since epoch). */
  const lastNdjsonEventTimeRef = useRef<number>(Date.now());
  /** Whether the "Stuck?" button should be visible (30 s since last NDJSON event). */
  const [showStuckButton, setShowStuckButton] = useState(false);
  /** Whether the stuck-reset confirmation dialog is open. */
  const [stuckConfirmOpen, setStuckConfirmOpen] = useState(false);
  /** Which of the three action panels is currently expanded, or null if all collapsed. */
  const [activeAction, setActiveAction] = useState<"accept" | "reject" | "followup" | null>(null);
  /** Element selected via the WebPreviewPanel inspector tool, to be attached as context to a follow-up. */
  const [elementContext, setElementContext] = useState<ElementSelection | null>(null);
  const [isRestartingServer, setIsRestartingServer] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  const [remainingUpstream, setRemainingUpstream] = useState(upstreamCommitCount);
  const [upstreamSyncLoading, setUpstreamSyncLoading] = useState<"merge" | null>(null);
  const [upstreamSyncError, setUpstreamSyncError] = useState<string | null>(null);
  const [liveDiffSummary, setLiveDiffSummary] = useState<DiffFileSummary[]>(diffSummary);
  const abortControllerRef = useRef<AbortController | null>(null);
  const proxyLogsControllerRef = useRef<AbortController | null>(null);
  /** Tracks how many NDJSON lines the client has received, for SSE reconnection offset. */
  const lineCountRef = useRef(initialLineCount);
  /** Mirrors current status so the visibilitychange handler can read it without a stale closure. */
  const statusRef = useRef(initialStatus);
  /** Mirrors current events so the status-change sound effect can inspect the last result
   *  event without adding `events` to that effect’s dependency array. */
  const eventsRef = useRef(initialEvents);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /**
   * True when the user is scrolled to (or near) the bottom.
   * Updated by a scroll listener so we capture position *before* new content
   * is rendered — checking scrollHeight inside the events effect would
   * be wrong because the DOM has already grown by then.
   */
  const wasAtBottomRef = useRef(true);

  // Track scroll position so we know whether to auto-scroll on new content.
  useEffect(() => {
    function onScroll() {
      wasAtBottomRef.current =
        window.scrollY + document.documentElement.clientHeight >=
        document.documentElement.scrollHeight - 40;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Auto-scroll to bottom as events grow, but only if the user is already at the bottom.
  useEffect(() => {
    if (wasAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [events]);

  // Stop the SSE stream on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Keep refs in sync so event handlers and effects always see the latest values.
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Central sound-on-status-change effect.
  // Using a single effect with prevStatusRef avoids duplicate sounds when
  // status is set both by handleAccept() and the SSE stream.
  const prevStatusRef = useRef(initialStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    // Agent finished — running → ready
    const wasRunning = prev === "running-claude" || prev === "starting" || prev === "fixing-types";
    if (status === "ready" && wasRunning) {
      // Check the most-recent result event to distinguish success from failure.
      // eventsRef.current is up-to-date (synced via its own useEffect) without
      // needing to add `events` as a dep here.
      const lastResult = [...eventsRef.current].reverse()
        .find((e): e is Extract<import("@/lib/session-events").SessionEvent, { type: "result" }> => e.type === "result");
      const isError = lastResult != null &&
        (lastResult.subtype === "error" || lastResult.subtype === "timeout" || lastResult.subtype === "aborted");
      if (isError) sounds.agentError();
      else sounds.agentDone();
    }

    // Accepted — fanfare for production deploy, merge chime for dev merge
    if (status === "accepted" && prev !== "accepted") {
      if (isProduction) sounds.deploy();
      else sounds.merge();
    }
  }, [status, sounds, isProduction]);

  // Show the "Stuck?" button if no new NDJSON events have arrived for 30 seconds
  // while the session is in a long-running pipeline state.
  useEffect(() => {
    const STUCK_THRESHOLD_MS = 30_000;
    const isLongRunning = status === "accepting" || status === "fixing-types";
    if (!isLongRunning) {
      setShowStuckButton(false);
      return;
    }
    // Reset timer whenever we enter a long-running state.
    lastNdjsonEventTimeRef.current = Date.now();
    setShowStuckButton(false);

    const interval = setInterval(() => {
      if (Date.now() - lastNdjsonEventTimeRef.current >= STUCK_THRESHOLD_MS) {
        setShowStuckButton(true);
      }
    }, 2_000);
    return () => clearInterval(interval);
  }, [status]);

  // When the session becomes ready (e.g. after Claude finishes), refresh the
  // diff summary so the "Files changed" section reflects the latest commits.
  useEffect(() => {
    if (status !== "ready") return;
    void fetch(withBasePath(`/api/evolve/diff-summary?sessionId=${sessionId}`))
      .then((res) => res.ok ? res.json() : null)
      .then((data: { files?: DiffFileSummary[] } | null) => {
        if (data?.files) setLiveDiffSummary(data.files);
      })
      .catch(() => {/* leave existing summary unchanged on error */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Reconnect / restart streaming when the tab regains focus, in case the
  // browser paused the SSE connection while the tab was in the background.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      const s = statusRef.current;
      const isTerminalStatus = s === "accepted" || s === "rejected";
      if (!isTerminalStatus) {
        void startStreaming();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // startStreaming only uses sessionId + stable refs/setters

  // Extracted streaming logic — can be called on mount and after follow-up / restart.
  async function startStreaming() {
    // Abort any in-flight stream before opening a new one.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const offset = lineCountRef.current;

    try {
      const response = await fetch(
        withBasePath(`/api/evolve/stream?sessionId=${sessionId}&offset=${offset}`),
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as {
              events?: SessionEvent[];
              lineCount?: number;
              status?: string;
              previewUrl?: string | null;
              done?: boolean;
            };

            if (parsed.events && parsed.events.length > 0) {
              setEvents((prev) => [...prev, ...parsed.events!]);
              if (parsed.lineCount != null) lineCountRef.current = parsed.lineCount;
              // Reset the stuck-button timer whenever new events arrive.
              lastNdjsonEventTimeRef.current = Date.now();
              setShowStuckButton(false);
            } else if (parsed.lineCount != null) {
              lineCountRef.current = parsed.lineCount;
            }
            if (parsed.status != null) {
              setStatus(parsed.status);
            }
            if ("previewUrl" in parsed) setPreviewUrl(parsed.previewUrl ?? null);
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Network error — leave the UI in its last known state
    }
  }

  // Start streaming if the session isn't already in a terminal state.
  useEffect(() => {
    const alreadyTerminal =
      initialStatus === "accepted" ||
      initialStatus === "rejected";
    if (alreadyTerminal) return;

    void startStreaming();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // intentionally omit initialStatus — run once on mount

  // Poll the proxy for the real-time preview server status whenever the session is ready.
  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const res = await fetch(`/_proxy/preview/${sessionId}/status`);
          if (res.ok && !cancelled) {
            const data = (await res.json()) as { devServerStatus?: string };
            const s = data.devServerStatus;
            if (s === 'starting' || s === 'running' || s === 'stopped') {
              setProxyServerStatus(s);
            }
          }
        } catch { /* network error — keep polling */ }
        if (!cancelled) await new Promise<void>((r) => setTimeout(r, 5_000));
      }
    }

    void poll();
    return () => { cancelled = true; };
  }, [sessionId, status]);

  // Stream server logs from the proxy when the session is ready.
  async function startServerLogsStream() {
    proxyLogsControllerRef.current?.abort();
    const controller = new AbortController();
    proxyLogsControllerRef.current = controller;

    try {
      const res = await fetch(`/_proxy/preview/${sessionId}/logs`, { signal: controller.signal });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as { text?: string; snapshot?: boolean; done?: boolean };
            if (parsed.snapshot) {
              setServerLogs(parsed.text ?? '');
            } else if (parsed.text) {
              setServerLogs((prev) => prev + parsed.text);
            }
            if (parsed.done) return;
          } catch { /* malformed line */ }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  useEffect(() => {
    if (status !== "ready") return;
    void startServerLogsStream();
    return () => { proxyLogsControllerRef.current?.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, status]);

  async function handleRestartServer() {
    setIsRestartingServer(true);
    setRestartError(null);

    try {
      const res = await fetch(`/_proxy/preview/${sessionId}/restart`, { method: 'POST' });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      setProxyServerStatus('starting');
      void startServerLogsStream();
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRestartingServer(false);
    }
  }

  async function handleAbort() {
    setIsAborting(true);
    setAbortError(null);

    try {
      const res = await fetch(withBasePath('/api/evolve/abort'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      void startStreaming();
    } catch (err) {
      setAbortError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAborting(false);
    }
  }

  async function handleUpstreamSync() {
    setUpstreamSyncLoading("merge");
    setUpstreamSyncError(null);
    try {
      const res = await fetch(withBasePath('/api/evolve/upstream-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: "merge" }),
      });
      const data = (await res.json()) as { outcome?: string; log?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error: ${res.status}`);
      setRemainingUpstream(0);
      // Restart the SSE stream so any new events written during conflict
      // resolution (or the merge itself) are picked up immediately.
      void startStreaming();
    } catch (err) {
      setUpstreamSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpstreamSyncLoading(null);
    }
  }

  async function handleAccept() {
    if (acceptRejectLoading) return;
    setAcceptRejectLoading(true);
    setAcceptRejectError(null);
    try {
      const res = await fetch(withBasePath('/api/evolve/manage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', sessionId }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string; stashWarning?: string; stuckSessionId?: string; stuckSessionBranch?: string };
      if (!res.ok) {
        if (res.status === 409 && data.stuckSessionId) {
          setStuckBlockingSessionId(data.stuckSessionId);
        }
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }
      setStuckBlockingSessionId(null);
      if (data.outcome === 'accepting') {
        sounds.sparkle();
        setStatus('accepting');
        setActiveAction(null);
        void startStreaming();
        return;
      }
      if (data.outcome === 'auto-fixing-types') {
        setStatus('fixing-types');
        setActiveAction(null);
        void startStreaming();
        return;
      }
      if (data.outcome === 'auto-committing') {
        setStatus('running-claude');
        setActiveAction(null);
        void startStreaming();
        return;
      }
      setStatus('accepted'); // deploy/merge sound fires via the prevStatusRef useEffect
      abortControllerRef.current?.abort();
    } catch (err) {
      setAcceptRejectError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptRejectLoading(false);
    }
  }

  async function handleReject() {
    if (acceptRejectLoading) return;
    setAcceptRejectLoading(true);
    setAcceptRejectError(null);
    try {
      const res = await fetch(withBasePath('/api/evolve/manage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', sessionId }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      sounds.reject();
      setStatus('rejected');
      abortControllerRef.current?.abort();
    } catch (err) {
      sounds.error();
      setAcceptRejectError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptRejectLoading(false);
    }
  }

  /**
   * Force-reset a session that is stuck in 'accepting' or 'fixing-types'.
   * Writes a result:error event to unblock the session.
   */
  async function handleForceReset(targetSessionId: string) {
    if (isResettingStuck) return;
    setIsResettingStuck(true);
    setForceResetError(null);
    try {
      const res = await fetch(withBasePath('/api/evolve/reset-stuck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: targetSessionId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      // If resetting our own session, update local status to ready
      if (targetSessionId === sessionId) {
        setStatus('ready');
        void startStreaming();
      }
      // Clear the blocking session indicator
      setStuckBlockingSessionId(null);
    } catch (err) {
      setForceResetError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResettingStuck(false);
    }
  }

  // Toggle an action panel open/closed. Clicking the active button collapses the panel.
  const toggleAction = useCallback((action: "accept" | "reject" | "followup") => {
    setActiveAction(prev => (prev === action ? null : action));
    setAcceptRejectError(null);
  }, []);

  // Called by WebPreviewPanel when the user picks an element with the inspector tool.
  const handleElementSelected = useCallback((info: ElementSelection) => {
    setActiveAction('followup');
    setElementContext(info);
  }, []);

  const isTerminal =
    status === "accepted" ||
    status === "rejected" ||
    status === "ready";

  /** Whether to show the preview as a desktop sidebar. */
  const showPreviewSidebar = status === "ready" && !!previewUrl;

  /**
   * The URL to open in the Web Preview panel when it first becomes available.
   * Derived once from the initial request so the preview starts on the most
   * relevant page rather than always defaulting to the landing page.
   */
  const smartPreviewUrl = previewUrl
    ? deriveSmartPreviewUrl(events, previewUrl)
    : null;

  /** Width of the session (left) panel in pixels when sidebar is visible. */
  const [mainWidthPx, setMainWidthPx] = useState(560);
  const containerRef = useRef<HTMLDivElement>(null);

  /** True while the session pipeline is actively running (not yet ready for action). */
  const isAgentRunning = status === "starting" || status === "running-claude" || status === "fixing-types";

  // ─── Derive setup/content sections from events ───────────────────────────

  const sections = groupEventsIntoSections(events);
  const setupSection = sections[0] ?? null;
  const contentSections = sections.slice(1);

  // Find the harness/model from the most-recent agent section so the follow-up
  // form can default to the same agent run config, making it easy to continue
  // work without accidentally switching harness.
  const lastAgentSection = [...sections].reverse().find(
    (s): s is SectionGroup & { harness: string; model: string } =>
      s.type === 'agent' && s.harness !== undefined,
  );
  // Prefer stored IDs (new sessions); fall back to label-based reverse lookup for old sessions.
  const sessionHarness = lastAgentSection?.harnessId
    ?? (lastAgentSection?.harness
      ? HARNESS_OPTIONS.find((h) => h.label === lastAgentSection.harness)?.id
      : undefined);
  const sessionModel = lastAgentSection?.modelId
    ?? (lastAgentSection?.model && sessionHarness
      ? modelOptionsByHarness[sessionHarness]?.find((m) => m.label === lastAgentSection.model)?.id
      : undefined);
  // Human-readable agent label for UI messages like "Waiting for X to finish…"
  // Label for the *currently running* agent — derived from the active section
  // (last content section while the pipeline is running). This is correct even
  // for follow-up requests that use a different harness/model than the original.
  // Note: activeSection.harness / .model are human-readable labels, not IDs.
  const activeSection = isAgentRunning ? contentSections[contentSections.length - 1] : undefined;
  const activeHarnessLabel = activeSection?.harness ?? undefined;
  const activeModelLabel = activeSection?.model ?? undefined;
  const agentRunningLabel = activeHarnessLabel
    ? (activeModelLabel ? `${activeHarnessLabel} (${activeModelLabel})` : activeHarnessLabel)
    : 'the agent';

  // Setup is active while it's the only section and session isn't terminal
  const isSetupActive = !isTerminal && contentSections.length === 0;
  const setupStepCount = setupSection
    ? setupSection.events.filter((e): e is Extract<SessionEvent, { type: 'setup_step' }> => e.type === 'setup_step' && e.done).length
    : 0;

  return (
    <div ref={containerRef} className={`flex min-h-dvh w-full${showPreviewSidebar ? ' xl:flex-row xl:items-start' : ''}`}>
    <main
      className={`flex flex-col w-full px-4 py-6${showPreviewSidebar ? ' max-w-full xl:max-w-none' : ' max-w-3xl mx-auto'}`}
      style={showPreviewSidebar ? { width: mainWidthPx, flexShrink: 0 } : undefined}
    >
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Session" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          containerRef={hamburgerRef}
          items={buildStandardMenuItems({
            onEvolveClick: () => {
              setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
              setEvolveDialogOpen(true);
            },
            isAdmin: sessionUser?.isAdmin ?? false,
          })}
        />
        {evolveDialogOpen && (
          <FloatingEvolveDialog
            onClose={() => setEvolveDialogOpen(false)}
            anchorRect={evolveAnchorRect}
            initialHarness={initialHarness}
            initialModel={initialModel}
            initialCavemanMode={initialCavemanMode}
            initialCavemanIntensity={initialCavemanIntensity}
            onSessionCreated={(id) => setToastSessionId(id)}
          />
        )}
        {toastSessionId && (
          <EvolveSubmitToast
            sessionId={toastSessionId}
            onDismiss={() => setToastSessionId(null)}
          />
        )}
      </header>

      {/* Original request — hidden when there was no initial prompt (e.g. instant-preview from-branch sessions) */}
      {initialRequest && (() => {
        const initialReqEvent = events.find((e): e is Extract<SessionEvent, { type: 'initial_request' }> => e.type === 'initial_request');
        const attachments = initialReqEvent?.attachments ?? [];
        return (
          <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm overflow-x-auto">
            <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Your request</p>
            <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{initialRequest}</p>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {attachments.map((name) => (
                  <AttachmentChip key={name} name={name} sessionId={sessionId} />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Created branch — setup steps fold into this card */}
      <div className="mb-6 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
        <p className="text-amber-300 font-semibold mb-1 flex items-center gap-1.5">
          <GitBranch size={14} strokeWidth={2} aria-hidden="true" />
          {isSetupActive ? (
            <>
              Creating branch…
              <span className="ml-1 flex items-center gap-1 text-amber-600/70 text-xs animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              </span>
            </>
          ) : (
            "Created branch"
          )}
        </p>
        <CopyBranchName branch={sessionBranch} />

        {/* Setup steps */}
        {!isSetupActive && setupSection && setupStepCount > 0 && (
          <details className="group mt-2">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-amber-600/80 hover:text-amber-400 transition-colors list-none">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              ✅ {setupStepCount} step{setupStepCount !== 1 ? "s" : ""} completed
            </summary>
            <div className="mt-2 pl-2 border-l border-amber-700/30 space-y-0.5">
              {setupSection.events
                .filter((e): e is Extract<SessionEvent, { type: 'setup_step' }> => e.type === 'setup_step')
                .map((e, i) => (
                  <p key={i} className="text-xs text-amber-200/70">
                    {e.done ? '✅' : '⏳'} {e.label}
                  </p>
                ))}
            </div>
          </details>
        )}

      </div>

      {/* Progress sections */}
      <div className="mb-6 flex flex-col gap-6">
        {contentSections.map((section, i) => {
          const isSectionActive = i === contentSections.length - 1 && !isTerminal;
          return (
            <StructuredSection
              key={i}
              section={section}
              isActive={isSectionActive}
              sessionId={sessionId}
              worktreePath={worktreePath}
            />
          );
        })}

        {/* Rejected banner — inline with other sections */}
        {status === "rejected" && (
          <div className="px-4 py-4 rounded-lg bg-red-900/40 border border-red-700/50 text-sm">
            <p className="text-red-200 font-semibold">🗑️ Changes rejected</p>
            <p className="text-red-300/80 text-xs mt-1">
              The branch and worktree have been discarded.
            </p>
          </div>
        )}

        {/* Web preview card — hidden on desktop when sidebar is active (aside shows it there) */}
        {status === "ready" && (
          <div className={showPreviewSidebar ? 'xl:hidden' : ''}>
            <WebPreviewCard
              fullHeight={false}
              previewUrl={smartPreviewUrl}
              proxyServerStatus={proxyServerStatus}
              serverLogs={serverLogs}
              canEvolve={canEvolve}
              isRestartingServer={isRestartingServer}
              restartError={restartError}
              onRestartServer={handleRestartServer}
              onElementSelected={handleElementSelected}
            />
          </div>
        )}

      </div>
      <div ref={messagesEndRef} />

      {/* Git diff summary — shown when session is done and there are file changes */}
      {(status === "ready" || status === "accepted" || status === "rejected") && liveDiffSummary.length > 0 && (() => {
        const totalAdditions = liveDiffSummary.reduce((s, f) => s + f.additions, 0);
        const totalDeletions = liveDiffSummary.reduce((s, f) => s + f.deletions, 0);
        return (
          <details className="group mb-6 rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
            <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none">
              <span className="text-gray-600 group-open:rotate-90 transition-transform flex-shrink-0 text-xs">▶</span>
              <span className="font-semibold text-xs text-gray-300 flex-shrink-0">📄 Files changed</span>
              <span className="ml-auto text-xs text-gray-500 flex-shrink-0">
                {liveDiffSummary.length} file{liveDiffSummary.length !== 1 ? "s" : ""}
                {" · "}
                <span className="text-green-400">+{totalAdditions}</span>
                {" "}
                <span className="text-red-400">-{totalDeletions}</span>
              </span>
            </summary>
            <div className="border-t border-gray-800">
              {liveDiffSummary.map((f, i) => (
                <DiffFileExpander
                  key={i}
                  sessionId={sessionId}
                  file={f.file}
                  additions={f.additions}
                  deletions={f.deletions}
                  isLast={i === liveDiffSummary.length - 1}
                />
              ))}
            </div>
          </details>
        );
      })()}

      {/* Upstream Changes — shown when the parent branch has commits not yet in the session branch; hidden for non-evolvers */}
      {canEvolve && remainingUpstream > 0 && status !== "accepted" && status !== "rejected" && (
        <div className="mb-6 rounded-lg bg-blue-950/40 border border-blue-700/50 text-sm overflow-hidden">
          <div className="px-4 py-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-blue-300 font-semibold mb-1">
                ⬆ Upstream Changes
              </p>
              <p className="text-blue-200/70 text-xs">
                {parentBranch ? (
                  <code className="bg-blue-950/60 px-1 rounded">{parentBranch}</code>
                ) : (
                  <span className="text-yellow-400">[parent branch unknown]</span>
                )}{" "}
                is{" "}
                <strong>{remainingUpstream}</strong> commit{remainingUpstream === 1 ? "" : "s"} ahead
                of <code className="bg-blue-950/60 px-1 rounded">{sessionBranch}</code>.
                Bring those changes into the session branch before accepting.
              </p>
              {upstreamSyncError && (
                <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{upstreamSyncError}</p>
              )}
            </div>
            {canAcceptReject && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  data-id="session/apply-upstream-updates"
                  type="button"
                  onClick={() => handleUpstreamSync()}
                  disabled={upstreamSyncLoading !== null}
                  className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-medium transition-colors"
                >
                  {upstreamSyncLoading === "merge" ? "Applying…" : "Apply Updates"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Three-action panel — shown to users with can_evolve permission; hidden for public viewers */}
      {canEvolve && status !== "accepted" && status !== "rejected" && (
        <div className="mb-6 rounded-lg bg-gray-900 border border-gray-700 text-sm overflow-hidden">

          {/* ── Header ── */}
          <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Available Actions</p>
            {isAgentRunning ? (
              <button
                data-id="session/abort"
                type="button"
                onClick={handleAbort}
                disabled={isAborting}
                className="text-xs text-red-400 hover:text-red-200 disabled:text-gray-600 transition-colors"
              >
                {isAborting ? "Aborting…" : "⏹ Abort"}
              </button>
            ) : null}
          </div>

          {abortError && (
            <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-700">{abortError}</p>
          )}

          {/* ── Button row (or fixing-types indicator) ── */}
          {status === "accepting" ? (
            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-green-300">
                <Loader2 size={16} className="animate-spin flex-shrink-0" />
                Accepting changes…
              </div>
              {canEvolve && showStuckButton && (
                <button
                  onClick={() => setStuckConfirmOpen(true)}
                  disabled={isResettingStuck}
                  title="No activity for 30 s — click to force-reset if the accept pipeline is stuck"
                  className="text-xs px-2 py-1 rounded border border-yellow-700 text-yellow-400 hover:bg-yellow-900/30 hover:text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Stuck?
                </button>
              )}
            </div>
          ) : status === "fixing-types" ? (
            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-amber-300">
                <Loader2 size={16} className="animate-spin flex-shrink-0" />
                Fixing type errors… will auto-accept when complete.
              </div>
              {canEvolve && showStuckButton && (
                <button
                  onClick={() => setStuckConfirmOpen(true)}
                  disabled={isResettingStuck}
                  title="No activity for 30 s — click to force-reset if the type-fix pipeline is stuck"
                  className="text-xs px-2 py-1 rounded border border-yellow-700 text-yellow-400 hover:bg-yellow-900/30 hover:text-yellow-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Stuck?
                </button>
              )}
            </div>
          ) : (
            <div className="flex">
              <button
                data-id="session/tab-followup"
                onClick={() => toggleAction("followup")}
                className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                  activeAction === "followup"
                    ? "bg-amber-900/40 text-amber-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-amber-300 bg-amber-900/10 hover:bg-amber-900/25"
                }`}
              >
                Follow-up Changes
              </button>
              <button
                data-id="session/tab-accept"
                onClick={(isAgentRunning || remainingUpstream > 0) ? undefined : () => toggleAction("accept")}
                disabled={isAgentRunning || remainingUpstream > 0}
                title={remainingUpstream > 0 ? `Apply the ${remainingUpstream} upstream commit${remainingUpstream === 1 ? "" : "s"} before accepting` : undefined}
                className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                  isAgentRunning || remainingUpstream > 0
                    ? "text-gray-600 cursor-not-allowed"
                    : activeAction === "accept"
                    ? "bg-green-900/40 text-green-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-green-300 bg-green-900/10 hover:bg-green-900/25"
                }`}
              >
                {remainingUpstream > 0 ? "Apply Updates First" : "Accept Changes"}
              </button>
              <button
                data-id="session/tab-reject"
                onClick={isAgentRunning ? undefined : () => toggleAction("reject")}
                disabled={isAgentRunning}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  isAgentRunning
                    ? "text-gray-600 cursor-not-allowed"
                    : activeAction === "reject"
                    ? "bg-red-900/40 text-red-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-red-300 bg-red-900/10 hover:bg-red-900/25"
                }`}
              >
                Reject Changes
              </button>
            </div>
          )}

          {/* ── Follow-up panel ── */}
          {activeAction === "followup" && (
            <div className="px-4 py-4 border-t border-gray-700">
              <p className="text-gray-400 text-xs mb-3">
                Address feedback on the changes, e.g. &quot;I got this error when using it:&quot; or
                &quot;please change the design of the button&quot;.
              </p>
              {/* Element context chip — populated by the WebPreviewPanel inspector */}
              {elementContext && (
                <div className="mb-3 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-950/40 border border-blue-700/40 text-xs text-blue-300">
                  <span className="font-semibold text-blue-200 flex-shrink-0">&lt;{elementContext.component}&gt;</span>
                  <span className="font-mono text-blue-400 truncate">{elementContext.selector}</span>
                  <button
                    data-id="session/clear-element-context"
                    type="button"
                    onClick={() => setElementContext(null)}
                    className="ml-auto flex-shrink-0 text-blue-500 hover:text-blue-200 transition-colors"
                    aria-label="Clear element context"
                  >
                    ✕
                  </button>
                </div>
              )}
              <EvolveRequestForm
                placeholder="Describe what to fix or improve…"
                submitLabel="Submit follow-up"
                disabled={isAgentRunning}
                disabledLabel={`Waiting for ${agentRunningLabel} to finish…`}
                autoFocus
                defaultHarness={sessionHarness}
                defaultModel={sessionModel}
                onSubmit={async ({ request, harness, model, files }) => {
                  // Prepend element context to the request when present.
                  let fullRequest = request;
                  if (elementContext) {
                    const sourceFilePart = elementContext.sourceFile ? ` (${elementContext.sourceFile})` : '';
                    fullRequest = `Re: <${elementContext.component}>${sourceFilePart} ${elementContext.selector}\n\n${request}`;
                  }
                  const formData = new FormData();
                  formData.append('sessionId', sessionId);
                  formData.append('request', fullRequest);
                  formData.append('harness', harness);
                  formData.append('model', model);
                  for (const file of files) formData.append('attachments', file);
                  const encryptedApiKey = await encryptStoredApiKey();
                  if (encryptedApiKey) formData.append('encryptedApiKey', encryptedApiKey);
                  const encryptedCredentials = await encryptStoredCredentials();
                  if (encryptedCredentials) formData.append('encryptedCredentials', JSON.stringify(encryptedCredentials));
                  const res = await fetch(withBasePath('/api/evolve/followup'), {
                    method: 'POST',
                    body: formData,
                  });
                  if (!res.ok) {
                    const data = (await res.json()) as { error?: string };
                    throw new Error(data.error ?? `Server error: ${res.status}`);
                  }
                  setElementContext(null);
                  setStatus('running-claude');
                  void startStreaming();
                }}
              />
            </div>
          )}

          {/* ── Accept panel ── */}
          {activeAction === "accept" && (
            <div className="px-4 py-4 border-t border-gray-700">
              {canAcceptReject ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">
                    {isProduction ? (
                      <>
                        Accepting will deploy{" "}
                        <code className="bg-gray-800 px-1 rounded">{sessionBranch}</code>{" "}
                        to production with zero-downtime cutover.{" "}
                        {branch ? (
                          <>
                            <code className="bg-gray-800 px-1 rounded">{branch}</code> stays
                            registered for rollback.
                          </>
                        ) : (
                          <>The previous branch stays registered for rollback.</>
                        )}
                      </>
                    ) : (
                      <>
                        Accepting will merge the preview branch{" "}
                        <code className="bg-gray-800 px-1 rounded">{sessionBranch}</code> into{" "}
                        <code className="bg-gray-800 px-1 rounded">{branch ?? "main"}</code>.
                      </>
                    )}
                  </p>
                  <button
                    data-id="session/confirm-accept"
                    onClick={handleAccept}
                    disabled={acceptRejectLoading}
                    className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {acceptRejectLoading ? "Accepting…" : "Confirm"}
                  </button>
                  {acceptRejectError && (
                    <div className="mt-2">
                      <p className="text-red-400 text-xs whitespace-pre-wrap">{acceptRejectError}</p>
                      {stuckBlockingSessionId && canEvolve && (
                        <div className="mt-2 flex items-center gap-3">
                          <Link
                            href={withBasePath(`/evolve/session/${stuckBlockingSessionId}`)}
                            className="text-xs text-blue-400 hover:text-blue-300 underline"
                          >
                            Go to stuck session →
                          </Link>
                          <span className="text-gray-600 text-xs">or</span>
                          <button
                            onClick={() => void handleForceReset(stuckBlockingSessionId)}
                            disabled={isResettingStuck}
                            className="text-xs px-2 py-1 rounded border border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isResettingStuck ? "Resetting…" : "Force Reset stuck session"}
                          </button>
                        </div>
                      )}
                      {forceResetError && (
                        <p className="text-red-400 text-xs mt-1">{forceResetError}</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-xs">
                  Accept is unavailable — this session&apos;s branch is not based on the currently
                  checked-out branch.
                </p>
              )}
            </div>
          )}

          {/* ── Reject panel ── */}
          {activeAction === "reject" && (
            <div className="px-4 py-4 border-t border-gray-700">
              {canAcceptReject ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">
                    Rejecting will discard the worktree and delete the{" "}
                    <code className="bg-gray-800 px-1 rounded">{sessionBranch}</code> branch.
                  </p>
                  <button
                    data-id="session/confirm-reject"
                    onClick={handleReject}
                    disabled={acceptRejectLoading}
                    className="px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {acceptRejectLoading ? "Rejecting…" : "Confirm"}
                  </button>
                  {acceptRejectError && (
                    <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{acceptRejectError}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-xs">
                  Reject is unavailable — this session&apos;s branch is not based on the currently
                  checked-out branch.
                </p>
              )}
            </div>
          )}

        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-col gap-2">
        {canEvolve && (
          <div className="flex gap-4">
            <Link data-id="session/new-request-link" href="/evolve" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              ← Submit another request
            </Link>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-gray-500">
          <span>
            <Link data-id="session/changelog-link" href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
            {" "}·{" "}
            <Link data-id="session/branches-link" href="/branches" className="text-blue-400 hover:text-blue-300">
              Branches
            </Link>
          </span>
          <code className="font-mono text-amber-300/60">
            {branch ? <>{branch} ▸ </> : null}{sessionBranch}
          </code>
        </div>
      </div>
    </main>

    {/* ── Desktop preview sidebar ── */}
    {showPreviewSidebar && (
      <>
      <HorizontalResizeHandle
        currentWidth={mainWidthPx}
        onWidthChange={setMainWidthPx}
        containerRef={containerRef}
      />
      <aside className="hidden xl:flex xl:flex-col xl:flex-1 xl:sticky xl:top-0 xl:h-dvh bg-gray-950 p-4">
        <WebPreviewCard
          fullHeight
          previewUrl={smartPreviewUrl}
          proxyServerStatus={proxyServerStatus}
          serverLogs={serverLogs}
          canEvolve={canEvolve}
          isRestartingServer={isRestartingServer}
          restartError={restartError}
          onRestartServer={handleRestartServer}
          onElementSelected={handleElementSelected}
        />
      </aside>
      </>
    )}

    {/* ── Stuck? confirmation dialog ── */}
    {stuckConfirmOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setStuckConfirmOpen(false)}
      >
        <div
          className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-white font-semibold text-base mb-2">Force Reset?</h2>
          <p className="text-gray-400 text-sm mb-5">
            No progress has been logged for over 30 seconds. This resets the session to{" "}
            <span className="text-amber-300">ready</span> so you can retry or make a follow-up
            request. Use this only if the pipeline appears genuinely stuck (e.g. the server was
            restarted mid-deploy).
          </p>
          {forceResetError && (
            <p className="text-red-400 text-xs mb-3">{forceResetError}</p>
          )}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setStuckConfirmOpen(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setStuckConfirmOpen(false);
                void handleForceReset(sessionId);
              }}
              disabled={isResettingStuck}
              className="px-4 py-2 rounded-lg text-sm bg-red-800 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isResettingStuck ? "Resetting…" : "Force Reset"}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

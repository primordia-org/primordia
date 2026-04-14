"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Streams live Claude Code progress via SSE from /api/evolve/stream.

import { useState, useRef, useEffect, useCallback } from "react";
import { GitBranch } from "lucide-react";
import { MarkdownContent } from "./SimpleMarkdown";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { FloatingEvolveDialog } from "./FloatingEvolveDialog";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import { withBasePath } from "../lib/base-path";
import { EvolveRequestForm } from "./EvolveRequestForm";
import Link from "next/link";
import type { DiffFileSummary } from "../app/evolve/session/[id]/page";
import { DiffFileExpander } from "./DiffFileExpander";
import type { SessionEvent } from "../lib/session-events";

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface SectionMetrics {
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatDuration(ms: number): string {
  return ms >= 60_000
    ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
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
  type: 'setup' | 'agent' | 'claude' | 'type_fix' | 'followup' | 'deploy';
  label: string;
  harness?: string;
  model?: string;
  events: SessionEvent[];
}

/** Group a flat list of SessionEvents into display sections. */
function groupEventsIntoSections(events: SessionEvent[]): SectionGroup[] {
  const sections: SectionGroup[] = [{ type: 'setup', label: 'Setup', events: [] }];
  for (const event of events) {
    if (event.type === 'section_start') {
      const group: SectionGroup = { type: event.sectionType, label: event.label, events: [] };
      if (event.sectionType === 'agent') {
        group.harness = event.harness;
        group.model = event.model;
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
  | Extract<SessionEvent, { type: 'log_line' }>;

function mergeConsecutiveTextEvents(events: RenderableEvent[]): RenderableEvent[] {
  const merged: RenderableEvent[] = [];
  for (const event of events) {
    if (event.type === 'text') {
      const last = merged[merged.length - 1];
      if (last?.type === 'text') {
        merged[merged.length - 1] = { ...last, content: last.content + event.content };
        continue;
      }
    }
    merged.push(event);
  }
  return merged;
}

/** Split content events into "detail" events (before/including last tool_use) and "final" events. */
function splitClaudeEventsForDisplay(events: SessionEvent[]): {
  detailEvents: (Extract<SessionEvent, { type: 'tool_use' }> | Extract<SessionEvent, { type: 'text' }>)[];
  finalEvents: Extract<SessionEvent, { type: 'text' }>[];
  toolCallCount: number;
} {
  type ContentEvent = Extract<SessionEvent, { type: 'tool_use' }> | Extract<SessionEvent, { type: 'text' }>;
  const content = events.filter(
    (e): e is ContentEvent => e.type === 'tool_use' || e.type === 'text',
  );
  let lastToolIdx = -1;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === 'tool_use') { lastToolIdx = i; break; }
  }
  const toolCallCount = content.filter((e) => e.type === 'tool_use').length;
  if (lastToolIdx === -1) {
    return { detailEvents: [], finalEvents: content.filter((e): e is Extract<SessionEvent, { type: 'text' }> => e.type === 'text'), toolCallCount: 0 };
  }
  return {
    detailEvents: content.slice(0, lastToolIdx + 1),
    finalEvents: content.slice(lastToolIdx + 1).filter((e): e is Extract<SessionEvent, { type: 'text' }> => e.type === 'text'),
    toolCallCount,
  };
}

/** Render a running Claude/type-fix section (streaming events live). */
function RunningClaudeSection({ events, label, isTypeFixSection, worktreePath, harness, model }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  worktreePath?: string;
  harness?: string;
  model?: string;
}) {
  const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";
  const agentLabel = harness ? (model ? `${harness} (${model})` : harness) : 'Claude Code';
  const runningLabel = isTypeFixSection ? label : `🤖 ${agentLabel} running…`;

  return (
    <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className={`font-semibold text-xs ${headingClass}`}>{runningLabel}</span>
        <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {mergeConsecutiveTextEvents(
          events.filter((e): e is RenderableEvent => e.type === 'tool_use' || e.type === 'text' || e.type === 'log_line')
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
          return null;
        })}
      </div>
    </div>
  );
}

/** Render a completed Claude/type-fix section with tool calls collapsed. */
function DoneClaudeSection({ events, label, isTypeFixSection, worktreePath, harness, model }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  worktreePath?: string;
  harness?: string;
  model?: string;
}) {
  const resultEvent = events.find((e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result');
  const metricsEvent = events.find((e): e is Extract<SessionEvent, { type: 'metrics' }> => e.type === 'metrics');
  const hasError = resultEvent?.subtype === 'error' || resultEvent?.subtype === 'timeout' || resultEvent?.subtype === 'aborted';

  const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";
  const doneBorderClass = hasError ? "border-red-700/50" : borderClass;
  const doneHeadingClass = hasError ? "text-red-400" : headingClass;
  const agentLabel = harness ? (model ? `${harness} (${model})` : harness) : 'Claude Code';
  const doneTitle = hasError
    ? (isTypeFixSection ? "❌ Auto-fix failed" : `❌ ${agentLabel} errored`)
    : (isTypeFixSection ? "🔧 Type errors fixed" : `🤖 ${agentLabel} finished`);

  const { detailEvents, finalEvents, toolCallCount } = splitClaudeEventsForDisplay(events);

  return (
    <div className={`rounded-lg border ${doneBorderClass} bg-gray-900 text-sm overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-gray-800">
        <span className={`font-semibold text-xs ${doneHeadingClass}`}>{doneTitle}</span>
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
              return null;
            })}
          </div>
        </details>
      )}
      {finalEvents.length > 0 && (
        <div className="px-4 py-3">
          <MarkdownContent text={finalEvents.map((e) => e.content).join('')} />
        </div>
      )}
      {metricsEvent && (
        <MetricsRow metrics={{
          durationMs: metricsEvent.durationMs ?? undefined,
          costUsd: metricsEvent.costUsd ?? undefined,
          inputTokens: metricsEvent.inputTokens ?? undefined,
          outputTokens: metricsEvent.outputTokens ?? undefined,
        }} />
      )}
    </div>
  );
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);

function AttachmentChip({ name, sessionId }: { name: string; sessionId: string }) {
  const url = withBasePath(`/api/evolve/attachment/${encodeURIComponent(sessionId)}?file=${encodeURIComponent(name)}`);
  const ext = name.includes('.') ? ('.' + name.split('.').pop()!.toLowerCase()) : '';
  const isImage = IMAGE_EXTENSIONS.has(ext);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300 font-mono hover:bg-gray-700 hover:border-gray-600 transition-colors"
    >
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-4 w-4 rounded object-cover flex-shrink-0" />
      )}
      {name}
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
  const { type, label, harness, model, events } = section;

  // ── Follow-up request ────────────────────────────────────────────────────
  if (type === 'followup') {
    const requestEvent = events.find((e): e is Extract<SessionEvent, { type: 'followup_request' }> => e.type === 'followup_request');
    const claudeEvents = events.filter((e) => e.type !== 'followup_request');
    const hasResult = claudeEvents.some((e) => e.type === 'result');
    return (
      <>
        {requestEvent && (
          <div className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
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
        {claudeEvents.length > 0 && (
          isActive && !hasResult
            ? <RunningClaudeSection events={claudeEvents} label={label} isTypeFixSection={false} worktreePath={worktreePath} harness={harness} model={model} />
            : <DoneClaudeSection events={claudeEvents} label={label} isTypeFixSection={false} worktreePath={worktreePath} harness={harness} model={model} />
        )}
      </>
    );
  }

  // ── Agent / Claude Code (legacy) / type_fix ──────────────────────────────
  if (type === 'agent' || type === 'claude' || type === 'type_fix') {
    const hasResult = events.some((e) => e.type === 'result');
    if (isActive && !hasResult) {
      return <RunningClaudeSection events={events} label={label} isTypeFixSection={type === 'type_fix'} worktreePath={worktreePath} harness={harness} model={model} />;
    }
    return <DoneClaudeSection events={events} label={label} isTypeFixSection={type === 'type_fix'} worktreePath={worktreePath} harness={harness} model={model} />;
  }

  // ── Deploy ───────────────────────────────────────────────────────────────
  if (type === 'deploy') {
    const logLines = events
      .filter((e): e is Extract<SessionEvent, { type: 'log_line' }> => e.type === 'log_line')
      .map((e) => e.content.replace(/\n+$/, ''))
      .join('\n');
    const resultEvent = events.find((e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result');
    const isProduction = label.includes("production");
    const mergedIntoBranch = !isProduction ? (label.match(/into `([^`]+)`/) ?? [])[1] ?? null : null;

    if (isActive && !resultEvent) {
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-gray-300">{label}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Running…
            </span>
          </div>
          {logLines && <div className="px-4 py-3"><pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono">{logLines}</pre></div>}
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
        {logLines && (
          <details className="group border-t border-green-800/50">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-green-900/30 transition-colors list-none text-xs">
              <span className="text-green-700 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-green-700/80">Deploy log</span>
            </summary>
            <div className="px-4 py-3 border-t border-green-800/50">
              <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono">{logLines}</pre>
            </div>
          </details>
        )}
      </div>
    );
  }

  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

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
}: EvolveSessionViewProps) {
  const [events, setEvents] = useState<SessionEvent[]>(initialEvents);
  const [status, setStatus] = useState(initialStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  /** Status of the preview server as reported by the proxy management API. */
  const [proxyServerStatus, setProxyServerStatus] = useState<'starting' | 'running' | 'stopped' | 'unknown'>('unknown');
  /** Accumulated log lines from the proxy's server log SSE stream. */
  const [serverLogs, setServerLogs] = useState<string>('');
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const { sessionUser, handleLogout } = useSessionUser();
  const [acceptRejectLoading, setAcceptRejectLoading] = useState(false);
  const [acceptRejectError, setAcceptRejectError] = useState<string | null>(null);
  /** Which of the three action panels is currently expanded, or null if all collapsed. */
  const [activeAction, setActiveAction] = useState<"accept" | "reject" | "followup" | null>(null);
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

  // Keep refs in sync so the visibilitychange handler always has the latest values.
  useEffect(() => { statusRef.current = status; }, [status]);

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
      const isTerminalStatus = s === "accepted" || s === "rejected" || s === "ready";
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
      initialStatus === "rejected" ||
      initialStatus === "ready";
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
      const data = (await res.json()) as { outcome?: string; error?: string; stashWarning?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      if (data.outcome === 'accepting') {
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
      setStatus('accepted');
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
      setStatus('rejected');
      abortControllerRef.current?.abort();
    } catch (err) {
      setAcceptRejectError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptRejectLoading(false);
    }
  }

  // Toggle an action panel open/closed. Clicking the active button collapses the panel.
  const toggleAction = useCallback((action: "accept" | "reject" | "followup") => {
    setActiveAction(prev => (prev === action ? null : action));
    setAcceptRejectError(null);
  }, []);

  const isTerminal =
    status === "accepted" ||
    status === "rejected" ||
    status === "ready";

  /** True while the session pipeline is actively running (not yet ready for action). */
  const isClaudeRunning = status === "starting" || status === "running-claude" || status === "fixing-types";

  // ─── Derive setup/content sections from events ───────────────────────────

  const sections = groupEventsIntoSections(events);
  const setupSection = sections[0] ?? null;
  const contentSections = sections.slice(1);
  // Setup is active while it's the only section and session isn't terminal
  const isSetupActive = !isTerminal && contentSections.length === 0;
  const setupStepCount = setupSection
    ? setupSection.events.filter((e): e is Extract<SessionEvent, { type: 'setup_step' }> => e.type === 'setup_step' && e.done).length
    : 0;

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Session" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          containerRef={hamburgerRef}
          items={buildStandardMenuItems({
            onSyncClick: () => setSyncDialogOpen(true),
            onEvolveClick: () => {
              setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
              setEvolveDialogOpen(true);
            },
            isAdmin: sessionUser?.isAdmin ?? false,
          })}
        />
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
        {evolveDialogOpen && (
          <FloatingEvolveDialog
            onClose={() => setEvolveDialogOpen(false)}
            anchorRect={evolveAnchorRect}
          />
        )}
      </header>

      {/* Original request */}
      {(() => {
        const initialReqEvent = events.find((e): e is Extract<SessionEvent, { type: 'initial_request' }> => e.type === 'initial_request');
        const attachments = initialReqEvent?.attachments ?? [];
        return (
          <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
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
        <code className="font-mono text-amber-200 text-sm">{sessionBranch}</code>

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

        {/* Preview server status + logs — shown when session is ready and proxy is managing the server */}
        {status === "ready" && (
          <div className="rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
              <span className="font-semibold text-xs text-emerald-300">🚀 Preview server</span>
              <span className={`text-xs ${
                proxyServerStatus === 'running' ? 'text-emerald-400' :
                proxyServerStatus === 'starting' ? 'text-yellow-400 animate-pulse' :
                proxyServerStatus === 'stopped' ? 'text-red-400' :
                'text-gray-500'
              }`}>
                {proxyServerStatus === 'running' ? 'Running' :
                 proxyServerStatus === 'starting' ? 'Starting…' :
                 proxyServerStatus === 'stopped' ? 'Stopped' :
                 'Checking…'}
              </span>
            </div>
            {previewUrl && (
              <div className="px-4 py-3 border-b border-gray-800">
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-200 underline break-all text-xs"
                >
                  {previewUrl}
                </a>
                <span className="text-gray-500 text-xs ml-2">(starts on first visit)</span>
              </div>
            )}
            {serverLogs && (
              <details className="group">
                <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
                  <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
                  <span className="text-gray-500">🪵 Server logs</span>
                </summary>
                <div className="px-4 py-3 border-t border-gray-800">
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap font-mono overflow-x-auto max-h-64 overflow-y-auto">{serverLogs}</pre>
                </div>
              </details>
            )}
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
            {isClaudeRunning ? (
              <button
                type="button"
                onClick={handleAbort}
                disabled={isAborting}
                className="text-xs text-red-400 hover:text-red-200 disabled:text-gray-600 transition-colors"
              >
                {isAborting ? "Aborting…" : "⏹ Abort"}
              </button>
            ) : status === "ready" ? (
              <button
                type="button"
                onClick={handleRestartServer}
                disabled={isRestartingServer || proxyServerStatus === "starting"}
                className="text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-600 transition-colors"
              >
                {isRestartingServer || proxyServerStatus === "starting"
                  ? "Starting…"
                  : proxyServerStatus === "running"
                  ? "↺ Restart preview"
                  : "▶ Start preview"}
              </button>
            ) : null}
          </div>

          {abortError && (
            <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-700">{abortError}</p>
          )}
          {restartError && (
            <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-700">{restartError}</p>
          )}

          {/* ── Button row (or fixing-types indicator) ── */}
          {status === "accepting" ? (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-green-300">
              <span className="animate-spin inline-block">⟳</span>
              Accepting changes…
            </div>
          ) : status === "fixing-types" ? (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-amber-300">
              <span className="animate-spin inline-block">⟳</span>
              Fixing type errors… will auto-accept when complete.
            </div>
          ) : (
            <div className="flex">
              <button
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
                onClick={isClaudeRunning ? undefined : () => toggleAction("accept")}
                disabled={isClaudeRunning}
                className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                  isClaudeRunning
                    ? "text-gray-600 cursor-not-allowed"
                    : activeAction === "accept"
                    ? "bg-green-900/40 text-green-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-green-300 bg-green-900/10 hover:bg-green-900/25"
                }`}
              >
                Accept Changes
              </button>
              <button
                onClick={isClaudeRunning ? undefined : () => toggleAction("reject")}
                disabled={isClaudeRunning}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  isClaudeRunning
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
              <EvolveRequestForm
                placeholder="Describe what to fix or improve…"
                submitLabel="Submit follow-up"
                disabled={isClaudeRunning}
                disabledLabel="Waiting for Claude to finish…"
                autoFocus
                onSubmit={async ({ request, harness, model, files }) => {
                  const formData = new FormData();
                  formData.append('sessionId', sessionId);
                  formData.append('request', request);
                  formData.append('harness', harness);
                  formData.append('model', model);
                  for (const file of files) formData.append('attachments', file);
                  const res = await fetch(withBasePath('/api/evolve/followup'), {
                    method: 'POST',
                    body: formData,
                  });
                  if (!res.ok) {
                    const data = (await res.json()) as { error?: string };
                    throw new Error(data.error ?? `Server error: ${res.status}`);
                  }
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
                    onClick={handleAccept}
                    disabled={acceptRejectLoading}
                    className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {acceptRejectLoading ? "Accepting…" : "Confirm"}
                  </button>
                  {acceptRejectError && (
                    <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{acceptRejectError}</p>
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
            <Link href="/evolve" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              ← Submit another request
            </Link>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-gray-500">
          <span>
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
            {" "}·{" "}
            <Link href="/branches" className="text-blue-400 hover:text-blue-300">
              Branches
            </Link>
          </span>
          <code className="font-mono text-amber-300/60">
            {branch ? <>{branch} ▸ </> : null}{sessionBranch}
          </code>
        </div>
      </div>
    </main>
  );
}

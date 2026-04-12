"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Streams live Claude Code progress via SSE from /api/evolve/stream.

import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownContent } from "./SimpleMarkdown";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { FloatingEvolveDialog } from "./FloatingEvolveDialog";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import { withBasePath } from "../lib/base-path";
import Link from "next/link";
import type { DiffFileSummary } from "../app/evolve/session/[id]/page";
import { DiffFileExpander } from "./DiffFileExpander";
import type { SessionEvent } from "../lib/session-events";

// ─── Old markdown-based section rendering (legacy fallback) ───────────────────

interface ParsedSection {
  heading: string;
  content: string;
}

function parseProgressSections(text: string): ParsedSection[] {
  if (!text.trim()) return [];
  const chunks = text.split(/\n(?=### [^\u0000-\u007F])/u);
  return chunks
    .map((chunk, i) => {
      if (i === 0) {
        const content = chunk
          .replace(/\n\n---\s*$/, "")
          .replace(/\n---\s*$/, "")
          .trim();
        return { heading: "Setup", content };
      }
      const newlineIdx = chunk.indexOf("\n");
      const heading =
        newlineIdx === -1
          ? chunk.replace(/^### /, "").trim()
          : chunk.slice(0, newlineIdx).replace(/^### /, "").trim();
      const rawContent = newlineIdx === -1 ? "" : chunk.slice(newlineIdx + 1);
      const content = rawContent
        .replace(/\n\n---\s*$/, "")
        .replace(/\n---\s*$/, "")
        .trim();
      return { heading, content };
    })
    .filter((s) => s.heading || s.content);
}

const METRICS_RE = /\n?<!-- metrics: (\{[^}]*\}) -->\n?/;
function parseMetricsFromContent(content: string): {
  metrics: SectionMetrics | null;
  strippedContent: string;
} {
  const match = content.match(METRICS_RE);
  if (!match) return { metrics: null, strippedContent: content };
  try {
    const metrics = JSON.parse(match[1]) as SectionMetrics;
    return { metrics, strippedContent: content.replace(METRICS_RE, "").trim() };
  } catch {
    return { metrics: null, strippedContent: content };
  }
}

function splitClaudeContent(content: string): {
  detailsContent: string;
  finalItem: string;
  toolCallCount: number;
} {
  const stripped = content
    .replace(/\n*---\n+(?:✅ \*\*Accepted\*\*|🗑️ \*\*Rejected\*\*)[^\n]*\n?$/, "")
    .replace(/\n?✅ \*\*Claude Code finished\.\*\*\s*$/, "")
    .replace(/\n?✅ \*\*Follow-up complete\. Preview server will reload automatically\.\*\*\s*$/, "")
    .trim();
  const toolCallCount = (stripped.match(/^- 🔧 /gm) ?? []).length;
  const lines = stripped.split("\n");
  let lastToolIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("- 🔧 ")) { lastToolIdx = i; break; }
  }
  if (lastToolIdx === -1) return { detailsContent: "", finalItem: stripped, toolCallCount };
  return {
    detailsContent: lines.slice(0, lastToolIdx + 1).join("\n").trim(),
    finalItem: lines.slice(lastToolIdx + 1).join("\n").trim(),
    toolCallCount,
  };
}

function LegacyLogSection({
  section,
  isActive,
  previewUrl,
}: {
  section: ParsedSection;
  isActive: boolean;
  previewUrl?: string | null;
}) {
  const { heading, content } = section;
  const isFollowupSection = heading.includes("Follow-up Request");
  const isClaudeSection = heading.includes("Claude Code");
  const isTypeFixSection = heading.includes("Fixing type errors");
  const isServerSection =
    heading.includes("Starting preview server") ||
    heading.includes("Restarting preview server");
  const isDeploySection =
    heading.includes("Deploying to production") ||
    heading.includes("Merging into");

  if (isFollowupSection) {
    const requestText = content.replace(/^> /m, "").trim();
    return (
      <div className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
        <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Follow-up request</p>
        <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{requestText}</p>
      </div>
    );
  }

  if (isClaudeSection || isTypeFixSection) {
    const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
    const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";
    const hasFinishMarker =
      content.includes("✅ **Claude Code finished.**") ||
      content.includes("✅ **Follow-up complete. Preview server will reload automatically.**");
    const hasErrorMarker =
      content.includes("❌ **Error**:") ||
      content.includes("❌ **Auto-fix failed");
    const isRunning = isActive && !hasFinishMarker && !hasErrorMarker;

    if (isRunning) {
      return (
        <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className={`font-semibold text-xs ${headingClass}`}>{heading}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Running…
            </span>
          </div>
          <div className="px-4 py-3"><MarkdownContent text={content || " "} /></div>
        </div>
      );
    }

    const { metrics: sectionMetrics, strippedContent } = parseMetricsFromContent(content);
    const { detailsContent, finalItem, toolCallCount } = splitClaudeContent(strippedContent);
    const doneBorderClass = hasErrorMarker ? "border-red-700/50" : borderClass;
    const doneHeadingClass = hasErrorMarker ? "text-red-400" : headingClass;
    const doneTitle = hasErrorMarker
      ? (isTypeFixSection ? "❌ Auto-fix failed" : "❌ Claude Code failed")
      : (isTypeFixSection ? "🔧 Type errors fixed" : "🤖 Claude Code finished");
    return (
      <div className={`rounded-lg border ${doneBorderClass} bg-gray-900 text-sm overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-gray-800">
          <span className={`font-semibold text-xs ${doneHeadingClass}`}>{doneTitle}</span>
        </div>
        {detailsContent && (
          <details className="group border-b border-gray-800">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
              <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-gray-500">🔧 {toolCallCount} tool call{toolCallCount !== 1 ? "s" : ""} made</span>
            </summary>
            <div className="px-4 py-3 border-t border-gray-800"><MarkdownContent text={detailsContent} /></div>
          </details>
        )}
        {finalItem && <div className="px-4 py-3"><MarkdownContent text={finalItem} /></div>}
        {sectionMetrics && <MetricsRow metrics={sectionMetrics} />}
      </div>
    );
  }

  if (isServerSection) {
    if (isActive) {
      return (
        <div className="rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-emerald-300">{heading}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Starting…
            </span>
          </div>
          <div className="px-4 py-3"><MarkdownContent text={content || " "} /></div>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800">
          <span className="font-semibold text-xs text-emerald-300">🚀 Preview ready</span>
        </div>
        {content && (
          <details className="group border-b border-gray-800">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
              <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-gray-500">🪵 Server logs</span>
            </summary>
            <div className="px-4 py-3 border-t border-gray-800"><MarkdownContent text={content} /></div>
          </details>
        )}
        {previewUrl && (
          <div className="px-4 py-3">
            <a href={previewUrl} target="_blank" rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-200 underline break-all">{previewUrl}</a>
          </div>
        )}
      </div>
    );
  }

  if (isDeploySection) {
    if (isActive) {
      return (
        <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-gray-300">{heading}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Running…
            </span>
          </div>
          <div className="px-4 py-3"><MarkdownContent text={content || " "} /></div>
        </div>
      );
    }
    const isProduction = heading.includes("Deploying to production");
    const mergedIntoBranch = !isProduction ? (heading.match(/Merging into `([^`]+)`/) ?? [])[1] ?? null : null;
    const doneTitle = isProduction ? "🚀 Deployed to production" : heading.replace(/🚀\s*Merging into/, "✅ Merged into");
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
        {content && (
          <details className="group border-t border-green-800/50">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-green-900/30 transition-colors list-none text-xs">
              <span className="text-green-700 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-green-700/80">Deploy log</span>
            </summary>
            <div className="px-4 py-3 border-t border-green-800/50"><MarkdownContent text={content} /></div>
          </details>
        )}
      </div>
    );
  }

  if (isActive) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
          <span className="font-semibold text-xs text-gray-300">{heading}</span>
          <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
            Running…
          </span>
        </div>
        <div className="px-4 py-3"><MarkdownContent text={content || " "} /></div>
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-gray-800 overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none">
        <span className="text-gray-600 group-open:rotate-90 transition-transform flex-shrink-0 text-xs">▶</span>
        <span className="font-semibold text-xs flex-shrink-0 text-gray-300">{heading}</span>
      </summary>
      <div className="px-4 py-3 border-t border-gray-800"><MarkdownContent text={content} /></div>
    </details>
  );
}

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
  type: 'setup' | 'claude' | 'type_fix' | 'followup' | 'deploy';
  label: string;
  events: SessionEvent[];
}

/** Group a flat list of SessionEvents into display sections. */
function groupEventsIntoSections(events: SessionEvent[]): SectionGroup[] {
  const sections: SectionGroup[] = [{ type: 'setup', label: 'Setup', events: [] }];
  for (const event of events) {
    if (event.type === 'section_start') {
      sections.push({ type: event.sectionType, label: event.label, events: [] });
    } else {
      sections[sections.length - 1].events.push(event);
    }
  }
  return sections;
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
  // For file tools, show the path (with optional line range for Read)
  for (const key of ['file_path', 'path', 'pattern', 'glob']) {
    if (typeof input[key] === 'string') {
      const val = shorten(input[key] as string);
      const shortened = val.length > 80 ? '…' + val.slice(-80) : val;
      if (lname === 'read' && typeof input.offset === 'number') {
        const end = typeof input.limit === 'number' ? input.offset + input.limit - 1 : null;
        return end != null ? `${shortened}:${input.offset}-${end}` : `${shortened}:${input.offset}`;
      }
      if (lname === 'edit' && typeof input.old_string === 'string') {
        const preview = input.old_string.trim().split('\n')[0].trim();
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
function RunningClaudeSection({ events, label, isTypeFixSection, worktreePath }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  worktreePath?: string;
}) {
  const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";

  return (
    <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className={`font-semibold text-xs ${headingClass}`}>{label}</span>
        <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
          Running…
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {events.map((event, i) => {
          if (event.type === 'tool_use') {
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
function DoneClaudeSection({ events, label, isTypeFixSection, worktreePath }: {
  events: SessionEvent[];
  label: string;
  isTypeFixSection: boolean;
  worktreePath?: string;
}) {
  const resultEvent = events.find((e): e is Extract<SessionEvent, { type: 'result' }> => e.type === 'result');
  const metricsEvent = events.find((e): e is Extract<SessionEvent, { type: 'metrics' }> => e.type === 'metrics');
  const hasError = resultEvent?.subtype === 'error' || resultEvent?.subtype === 'timeout' || resultEvent?.subtype === 'aborted';

  const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
  const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";
  const doneBorderClass = hasError ? "border-red-700/50" : borderClass;
  const doneHeadingClass = hasError ? "text-red-400" : headingClass;
  const doneTitle = hasError
    ? (isTypeFixSection ? "❌ Auto-fix failed" : "❌ Claude Code failed")
    : (isTypeFixSection ? "🔧 Type errors fixed" : "🤖 Claude Code finished");

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
            {detailEvents.map((event, i) => {
              if (event.type === 'tool_use') {
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
          {finalEvents.map((e, i) => <MarkdownContent key={i} text={e.content} />)}
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

/** Render a single non-setup, non-legacy section. */
function StructuredSection({
  section,
  isActive,
  worktreePath,
}: {
  section: SectionGroup;
  isActive: boolean;
  worktreePath?: string;
}) {
  const { type, label, events } = section;

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
          </div>
        )}
        {claudeEvents.length > 0 && (
          isActive && !hasResult
            ? <RunningClaudeSection events={claudeEvents} label={label} isTypeFixSection={false} worktreePath={worktreePath} />
            : <DoneClaudeSection events={claudeEvents} label={label} isTypeFixSection={false} worktreePath={worktreePath} />
        )}
      </>
    );
  }

  // ── Claude Code / type_fix ───────────────────────────────────────────────
  if (type === 'claude' || type === 'type_fix') {
    const hasResult = events.some((e) => e.type === 'result');
    if (isActive && !hasResult) {
      return <RunningClaudeSection events={events} label={label} isTypeFixSection={type === 'type_fix'} worktreePath={worktreePath} />;
    }
    return <DoneClaudeSection events={events} label={label} isTypeFixSection={type === 'type_fix'} worktreePath={worktreePath} />;
  }

  // ── Deploy ───────────────────────────────────────────────────────────────
  if (type === 'deploy') {
    const logLines = events
      .filter((e): e is Extract<SessionEvent, { type: 'log_line' }> => e.type === 'log_line')
      .map((e) => e.content)
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
  /** The currently checked-out branch (parent). Used in confirmation copy and NavHeader. */
  branch?: string | null;
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
  const [followupText, setFollowupText] = useState('');
  const [followupFiles, setFollowupFiles] = useState<File[]>([]);
  const [isSubmittingFollowup, setIsSubmittingFollowup] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [acceptRejectLoading, setAcceptRejectLoading] = useState(false);
  const [acceptRejectError, setAcceptRejectError] = useState<string | null>(null);
  /** Which of the three action panels is currently expanded, or null if all collapsed. */
  const [activeAction, setActiveAction] = useState<"accept" | "reject" | "followup" | null>(null);
  const [isRestartingServer, setIsRestartingServer] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  const [isDraggingFollowup, setIsDraggingFollowup] = useState(false);
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
  const followupTextareaRef = useRef<HTMLTextAreaElement>(null);
  const followupFileInputRef = useRef<HTMLInputElement>(null);
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
              // legacy_text events carry the full progressText — replace state entirely
              if (parsed.events.some((e) => e.type === 'legacy_text')) {
                setEvents(parsed.events);
                lineCountRef.current = 0;
              } else {
                setEvents((prev) => [...prev, ...parsed.events!]);
                if (parsed.lineCount != null) lineCountRef.current = parsed.lineCount;
              }
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

  // Auto-focus the follow-up textarea whenever the follow-up panel opens.
  useEffect(() => {
    if (activeAction === "followup") {
      setTimeout(() => followupTextareaRef.current?.focus(), 0);
    }
  }, [activeAction]);

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

  function handleFollowupFilesAdded(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    setFollowupFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}:${f.size}`));
      return [...prev, ...arr.filter(f => !existing.has(`${f.name}:${f.size}`))];
    });
  }

  function handleRemoveFollowupFile(index: number) {
    setFollowupFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleFollowupDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingFollowup(true);
  }

  function handleFollowupDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFollowup(false);
    }
  }

  function handleFollowupDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingFollowup(false);
    if (e.dataTransfer.files.length > 0) {
      handleFollowupFilesAdded(e.dataTransfer.files);
    }
  }

  function handleFollowupPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      handleFollowupFilesAdded(files);
    }
  }

  async function handleFollowupSubmit() {
    const trimmed = followupText.trim();
    if (!trimmed) return;

    setIsSubmittingFollowup(true);
    setFollowupError(null);

    try {
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      formData.append('request', trimmed);
      for (const file of followupFiles) {
        formData.append('attachments', file);
      }

      const res = await fetch(withBasePath('/api/evolve/followup'), {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      setFollowupText('');
      setFollowupFiles([]);
      setStatus('running-claude');
      void startStreaming();
    } catch (err) {
      setFollowupError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmittingFollowup(false);
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
    setFollowupError(null);
  }, []);

  const isTerminal =
    status === "accepted" ||
    status === "rejected" ||
    status === "ready";

  /** True while the session pipeline is actively running (not yet ready for action). */
  const isClaudeRunning = status === "starting" || status === "running-claude" || status === "fixing-types";

  // ─── Derive setup/content sections from events ───────────────────────────

  // Check if this is a legacy session (no NDJSON, only progressText string)
  const legacyTextEvent = events.find((e): e is Extract<SessionEvent, { type: 'legacy_text' }> => e.type === 'legacy_text');

  // Legacy rendering path
  let legacySections: ParsedSection[] = [];
  let legacySetupSection: ParsedSection | null = null;
  let legacyContentSections: ParsedSection[] = [];
  let legacyIsSetupActive = false;
  let legacySetupStepCount = 0;

  // Structured rendering path
  let sections: SectionGroup[] = [];
  let setupSection: SectionGroup | null = null;
  let contentSections: SectionGroup[] = [];
  let isSetupActive = false;
  let setupStepCount = 0;

  if (legacyTextEvent) {
    legacySections = parseProgressSections(legacyTextEvent.content);
    legacySetupSection = legacySections.length > 0 && legacySections[0].heading === "Setup" ? legacySections[0] : null;
    legacyContentSections = legacySections.filter((s) => s.heading !== "Setup");
    legacyIsSetupActive = !isTerminal && (legacySections.length === 0 || (legacySections.length === 1 && legacySections[0].heading === "Setup"));
    legacySetupStepCount = legacySetupSection
      ? (legacySetupSection.content.match(/^- \[x\]/gm) ?? []).length
      : 0;
  } else {
    sections = groupEventsIntoSections(events);
    setupSection = sections[0] ?? null;
    contentSections = sections.slice(1);
    // Setup is active while it's the only section and session isn't terminal
    isSetupActive = !isTerminal && contentSections.length === 0;
    setupStepCount = setupSection
      ? setupSection.events.filter((e): e is Extract<SessionEvent, { type: 'setup_step' }> => e.type === 'setup_step' && e.done).length
      : 0;
  }

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
      <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
        <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Your request</p>
        <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{initialRequest}</p>
      </div>

      {/* Created branch — setup steps fold into this card */}
      <div className="mb-6 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
        <p className="text-amber-300 font-semibold mb-1 flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          {(legacyTextEvent ? legacyIsSetupActive : isSetupActive) ? (
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

        {/* Structured setup steps */}
        {!isSetupActive && !legacyTextEvent && setupSection && setupStepCount > 0 && (
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

        {/* Legacy setup steps (markdown) */}
        {!legacyIsSetupActive && legacySetupSection && (
          <details className="group mt-2">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-amber-600/80 hover:text-amber-400 transition-colors list-none">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              ✅ {legacySetupStepCount} step{legacySetupStepCount !== 1 ? "s" : ""} completed
            </summary>
            <div className="mt-2 pl-2 border-l border-amber-700/30">
              <MarkdownContent text={legacySetupSection.content} />
            </div>
          </details>
        )}
      </div>

      {/* Progress sections */}
      <div className="mb-6 flex flex-col gap-6">
        {legacyTextEvent ? (
          // Legacy rendering: use old markdown-based section components
          legacyContentSections.map((section, i) => {
            const isSectionActive = i === legacyContentSections.length - 1 && !isTerminal;
            const isServer =
              section.heading.includes("Starting preview server") ||
              section.heading.includes("Restarting preview server");
            return (
              <LegacyLogSection
                key={i}
                section={section}
                isActive={isSectionActive}
                previewUrl={isServer ? previewUrl : undefined}
              />
            );
          })
        ) : (
          // Structured rendering: use event-based section components
          contentSections.map((section, i) => {
            const isSectionActive = i === contentSections.length - 1 && !isTerminal;
            return (
              <StructuredSection
                key={i}
                section={section}
                isActive={isSectionActive}
                worktreePath={worktreePath}
              />
            );
          })
        )}

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
                <code className="bg-blue-950/60 px-1 rounded">{branch ?? "parent"}</code> is{" "}
                <strong>{remainingUpstream}</strong> commit{remainingUpstream === 1 ? "" : "s"} ahead
                of <code className="bg-blue-950/60 px-1 rounded">{sessionBranch}</code>.
                Bring those changes into the session branch before accepting.
              </p>
              {upstreamSyncError && (
                <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{upstreamSyncError}</p>
              )}
            </div>
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
            <div
              className={`px-4 py-4 border-t transition-colors ${isDraggingFollowup ? "border-amber-500/70 bg-amber-950/10" : "border-gray-700"}`}
              onDragOver={handleFollowupDragOver}
              onDragLeave={handleFollowupDragLeave}
              onDrop={handleFollowupDrop}
            >
              <p className="text-gray-400 text-xs mb-3">
                Address feedback on the changes, e.g. &quot;I got this error when using it:&quot; or
                &quot;please change the design of the button&quot;.
              </p>
              <textarea
                ref={followupTextareaRef}
                rows={4}
                value={followupText}
                onChange={(e) => setFollowupText(e.target.value)}
                onPaste={handleFollowupPaste}
                placeholder="Describe what to fix or improve…"
                className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-2"
              />
              {/* Attached file chips */}
              {followupFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {followupFiles.map((file, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300">
                      <span className="truncate max-w-[160px]">{file.name}</span>
                      <button type="button" onClick={() => handleRemoveFollowupFile(i)} className="text-gray-500 hover:text-gray-200 ml-1">✕</button>
                    </span>
                  ))}
                </div>
              )}
              {followupError && (
                <p className="text-red-400 text-xs mb-2">{followupError}</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={followupFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml"
                  className="hidden"
                  onChange={(e) => { if (e.target.files) handleFollowupFilesAdded(e.target.files); e.target.value = ""; }}
                />
                <button
                  type="button"
                  onClick={() => followupFileInputRef.current?.click()}
                  disabled={isClaudeRunning || isSubmittingFollowup}
                  className="px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:opacity-40 text-xs transition-colors"
                >
                  📎 Attach files
                </button>
                <button
                  type="button"
                  onClick={handleFollowupSubmit}
                  disabled={isClaudeRunning || isSubmittingFollowup || !followupText.trim()}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
                >
                  {isSubmittingFollowup ? "Submitting…" : isClaudeRunning ? "Waiting for Claude to finish…" : "Submit follow-up"}
                </button>
              </div>
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
          </span>
        </div>
      </div>
    </main>
  );
}

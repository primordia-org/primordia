"use client";

// app/branches/page.tsx
// Shows all local git branches as a tree rooted at `main`, with links to
// active preview servers. Auto-refreshes every 3 seconds.
// Only meaningful in development mode — the API returns 403 in production.

import { useState, useEffect } from "react";
import Link from "next/link";
import type { BranchData, BranchesResponse } from "@/app/api/branches/route";

// ─── Tree builder ─────────────────────────────────────────────────────────────

interface BranchNode extends BranchData {
  children: BranchNode[];
}

function buildTree(branches: BranchData[]): BranchNode[] {
  const byName = new Map<string, BranchNode>(
    branches.map((b) => [b.name, { ...b, children: [] }]),
  );

  const roots: BranchNode[] = [];

  for (const node of byName.values()) {
    if (node.name === "main") {
      // Always the first root
      roots.unshift(node);
    } else if (node.parent && byName.has(node.parent)) {
      byName.get(node.parent)!.children.push(node);
    } else if (node.parent && !byName.has(node.parent)) {
      // Parent branch no longer exists locally — attach to main
      const main = byName.get("main");
      if (main) {
        main.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      // No parent config — top-level branch
      roots.push(node);
    }
  }

  // Sort children alphabetically at every level
  for (const node of byName.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return roots;
}

// ─── Status display helpers ───────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  ready: "text-green-400",
  "running-claude": "text-yellow-400",
  "starting-server": "text-yellow-400",
  starting: "text-gray-400",
  error: "text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "ready",
  "running-claude": "running claude…",
  "starting-server": "starting server…",
  starting: "starting…",
  error: "error",
};

// ─── Recursive branch row ─────────────────────────────────────────────────────

function BranchRow({
  node,
  depth,
  linePrefix,
  isLast,
  mainServerUrl,
}: {
  node: BranchNode;
  depth: number;
  /** The tree-drawing characters accumulated from ancestor levels. */
  linePrefix: string;
  isLast: boolean;
  mainServerUrl: string;
}) {
  const isRoot = depth === 0;
  // Tree connector for this row
  const connector = isRoot ? "" : isLast ? "└── " : "├── ";
  // Prefix passed to each child row
  const childLinePrefix = isRoot ? "" : linePrefix + (isLast ? "    " : "│   ");

  const isMain = node.name === "main";
  const url = isMain ? mainServerUrl : node.previewUrl;
  const statusColor = node.sessionStatus
    ? (STATUS_COLOR[node.sessionStatus] ?? "text-gray-400")
    : "";
  const statusLabel = node.sessionStatus
    ? (STATUS_LABEL[node.sessionStatus] ?? node.sessionStatus)
    : null;

  return (
    <>
      <div className="flex items-baseline gap-1.5 font-mono text-sm leading-7 flex-wrap">
        {/* Tree-drawing prefix */}
        {!isRoot && (
          <span className="text-gray-600 whitespace-pre select-none shrink-0">
            {linePrefix + connector}
          </span>
        )}

        {/* Dot — green when a preview URL is known, dim otherwise */}
        <span className={url ? "text-green-400 shrink-0" : "text-gray-600 shrink-0"}>
          ●
        </span>

        {/* Branch name */}
        <span
          className={
            node.isCurrent ? "text-white font-bold" : "text-gray-300"
          }
        >
          {node.name}
          {node.isCurrent && (
            <span className="text-gray-500 font-normal ml-1">(current)</span>
          )}
        </span>

        {/* Session status badge (not shown for main) */}
        {statusLabel && !isMain && (
          <span className={`text-xs shrink-0 ${statusColor}`}>
            [{statusLabel}]
          </span>
        )}

        {/* Preview server link */}
        {url && (
          <a
            href={url}
            target={isMain ? "_self" : "_blank"}
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-xs ml-1 shrink-0"
          >
            {url} ↗
          </a>
        )}
      </div>

      {/* Render children recursively */}
      {node.children.map((child, i) => (
        <BranchRow
          key={child.name}
          node={child}
          depth={depth + 1}
          linePrefix={childLinePrefix}
          isLast={i === node.children.length - 1}
          mainServerUrl={mainServerUrl}
        />
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BranchesPage() {
  const [data, setData] = useState<BranchesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/branches");
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as BranchesResponse;
        setData(json);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load branches");
      }
    }

    load();
    const interval = setInterval(load, 3_000);
    return () => clearInterval(interval);
  }, []);

  const tree = data ? buildTree(data.branches) : [];

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Primordia
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Local Branches ·{" "}
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Back to app
        </Link>
      </header>

      {/* Error state */}
      {error && (
        <div className="text-red-400 text-sm mb-4 bg-red-950/30 border border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Loading state */}
      {!data && !error && (
        <p className="text-gray-500 text-sm font-mono">Loading branches…</p>
      )}

      {/* Branch tree */}
      {data && tree.length === 0 && (
        <p className="text-gray-500 text-sm font-mono">No local branches found.</p>
      )}

      {data && tree.length > 0 && (
        <div className="space-y-0">
          {tree.map((node, i) => (
            <BranchRow
              key={node.name}
              node={node}
              depth={0}
              linePrefix=""
              isLast={i === tree.length - 1}
              mainServerUrl={data.mainServerUrl}
            />
          ))}
        </div>
      )}

      {/* Legend */}
      {data && (
        <div className="mt-8 border-t border-gray-800 pt-4 text-xs text-gray-600 font-mono space-y-1">
          <p>● green = preview server active · ● dim = no active session</p>
          <p>Refreshes every 3 s · Development mode only</p>
        </div>
      )}
    </main>
  );
}

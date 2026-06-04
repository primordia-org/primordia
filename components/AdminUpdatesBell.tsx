"use client";

// components/AdminUpdatesBell.tsx
// Notification bell that opens a dropdown menu showing upstream updates and
// active evolve sessions. Shown to any user with evolve or admin access.

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Bell, ArrowUpCircle, GitBranch, ShieldAlert } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { SessionUser } from "@/lib/hooks";

interface AdminUpdatesBellProps {
  sessionUser: SessionUser | null;
}

const STATUS_COLOR: Record<string, string> = {
  ready: "text-green-400",
  "running-claude": "text-yellow-400",
  "fixing-types": "text-yellow-400",
  accepting: "text-yellow-400",
  starting: "text-gray-400",
  error: "text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "ready",
  "running-claude": "running",
  "fixing-types": "type check",
  accepting: "accepting",
  starting: "starting",
  error: "error",
};

interface BellSession {
  id: string;
  status: string;
  request: string;
}

interface BellData {
  hasUpdates: boolean;
  hasDependencyAlert: boolean;
  dependencySevereCount: number;
  sessions: BellSession[];
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-4 h-4 rounded bg-gray-700 animate-pulse shrink-0" />
      <div className="flex-1 h-3 rounded bg-gray-700 animate-pulse" />
      <div className="w-12 h-3 rounded bg-gray-700 animate-pulse shrink-0" />
    </div>
  );
}

export function AdminUpdatesBell({ sessionUser }: AdminUpdatesBellProps) {
  const isAdmin = sessionUser?.isAdmin ?? false;
  const canEvolve = sessionUser?.canEvolve ?? false;
  const canShow = isAdmin || canEvolve;

  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BellData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionsResult, updatesResult, dependencyResult] = await Promise.all([
        canEvolve || isAdmin ? apiClient.GET('/evolve/sessions') : null,
        isAdmin ? apiClient.GET('/admin/updates/has-updates') : null,
        isAdmin ? apiClient.GET('/admin/dependencies-security/has-alert') : null,
      ]);
      const sessions: BellSession[] =
        (sessionsResult?.data as { sessions?: BellSession[] } | undefined)?.sessions ?? [];
      const hasUpdates: boolean =
        (updatesResult?.data as { hasUpdates?: boolean } | undefined)?.hasUpdates ?? false;
      const dependencyData = dependencyResult?.data as
        | { hasAlert?: boolean; severeCount?: number }
        | undefined;
      const hasDependencyAlert: boolean = dependencyData?.hasAlert ?? false;
      const dependencySevereCount: number = dependencyData?.severeCount ?? 0;
      setData({ hasUpdates, hasDependencyAlert, dependencySevereCount, sessions });
    } catch {
      setData({ hasUpdates: false, hasDependencyAlert: false, dependencySevereCount: 0, sessions: [] });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, canEvolve]);

  // Mount: fetch to decide whether to show bell at all.
  useEffect(() => {
    if (!canShow) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [canShow, fetchData]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, handleClickOutside]);

  if (!canShow) return null;

  const hasAnything = data && (data.hasUpdates || data.hasDependencyAlert || data.sessions.length > 0);
  if (!hasAnything && !menuOpen) return null;

  const RUNNING_STATUSES = new Set(["starting", "running-claude", "fixing-types", "accepting"]);
  const hasRunningSessions = data?.sessions.some((s) => RUNNING_STATUSES.has(s.status)) ?? false;

  function toggle() {
    const next = !menuOpen;
    setMenuOpen(next);
    if (next) fetchData();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={menuOpen ? "Close notifications" : "Open notifications"}
        aria-expanded={menuOpen}
        className={`p-2 rounded-lg transition-colors hover:bg-gray-800 ${
          hasRunningSessions
            ? "text-amber-400 hover:text-amber-300 animate-pulse"
            : "text-white hover:text-gray-300"
        }`}
      >
        <Bell size={20} strokeWidth={2} aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-40 overflow-hidden">
          {loading && !data ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            <>
              {/* Updates row — admin only */}
              {isAdmin && data?.hasUpdates && (
                <Link
                  href="/admin/updates"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-amber-400 hover:text-amber-300 hover:bg-gray-800 transition-colors border-b border-gray-800"
                >
                  <ArrowUpCircle size={16} strokeWidth={2} aria-hidden="true" />
                  <span className="flex-1">Updates available</span>
                </Link>
              )}

              {/* Dependency audit row — admin only */}
              {isAdmin && data?.hasDependencyAlert && (
                <Link
                  href="/admin/dependencies-security"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:text-red-300 hover:bg-gray-800 transition-colors border-b border-gray-800"
                >
                  <ShieldAlert size={16} strokeWidth={2} aria-hidden="true" />
                  <span className="flex-1">Dependency security issues</span>
                  <span className="text-xs text-red-300">{data.dependencySevereCount}</span>
                </Link>
              )}

              {/* Active sessions */}
              {data?.sessions.length ? (
                data.sessions.map((s) => (
                  <Link
                    key={s.id}
                    href={`/evolve/session/${s.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors border-b border-gray-800 last:border-b-0"
                  >
                    <GitBranch size={16} strokeWidth={2} className="shrink-0 text-gray-500" aria-hidden="true" />
                    <span className="flex-1 truncate min-w-0" title={s.request}>
                      {s.request || s.id}
                    </span>
                    <span className={`text-xs shrink-0 ${STATUS_COLOR[s.status] ?? "text-gray-400"}`}>
                      [{STATUS_LABEL[s.status] ?? s.status}]
                    </span>
                  </Link>
                ))
              ) : !data?.hasUpdates && !data?.hasDependencyAlert ? (
                <div className="px-4 py-3 text-sm text-gray-500">No active sessions</div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

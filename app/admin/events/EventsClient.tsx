"use client";

// app/admin/events/EventsClient.tsx — admin event log viewer

import { useState, useEffect, useCallback } from "react";
import { withBasePath } from "@/lib/base-path";
import { RefreshCw, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

interface EventRow {
  id: number;
  ts: string;
  userId: string | null;
  event: string;
  props: Record<string, unknown> | null;
}

const PAGE_SIZE = 50;

export default function EventsClient() {
  const [rows, setRows]       = useState<EventRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [offset, setOffset]   = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // filter state
  const [eventFilter, setEventFilter] = useState("");
  const [userFilter, setUserFilter]   = useState("");
  // committed filters (applied on search / page change)
  const [appliedEvent, setAppliedEvent] = useState("");
  const [appliedUser, setAppliedUser]   = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchPage = useCallback(async (off: number, ev: string, uid: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(off),
      });
      if (ev)  params.set("event",  ev);
      if (uid) params.set("userId", uid);
      const res = await fetch(withBasePath(`/api/events?${params}`));
      if (!res.ok) throw new Error(await res.text());
      const data: { rows: EventRow[]; total: number } = await res.json();
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(0, "", "");
  }, [fetchPage]);

  function applySearch() {
    setAppliedEvent(eventFilter);
    setAppliedUser(userFilter);
    setOffset(0);
    fetchPage(0, eventFilter, userFilter);
  }

  function clearFilters() {
    setEventFilter("");
    setUserFilter("");
    setAppliedEvent("");
    setAppliedUser("");
    setOffset(0);
    fetchPage(0, "", "");
  }

  function goPage(newOffset: number) {
    setOffset(newOffset);
    fetchPage(newOffset, appliedEvent, appliedUser);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const hasFilters = appliedEvent || appliedUser;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Event name</label>
          <input
            type="text"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="e.g. file-attachment-removed/v1"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-72"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">User ID</label>
          <input
            type="text"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="user id"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-52"
          />
        </div>
        <button
          onClick={applySearch}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
        >
          <Search size={14} />
          Search
        </button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
          >
            <X size={14} />
            Clear
          </button>
        )}
        <button
          onClick={() => fetchPage(offset, appliedEvent, appliedUser)}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</p>
      )}

      {/* Stats */}
      <p className="text-xs text-gray-500">
        {total.toLocaleString()} event{total !== 1 ? "s" : ""}
        {hasFilters ? " matching filters" : " total"}
        {" "}· page {currentPage} of {totalPages}
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium w-10">#</th>
              <th className="px-3 py-2 font-medium w-48">Timestamp (UTC)</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium w-44">User</th>
              <th className="px-3 py-2 font-medium">Props</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-gray-600 text-sm">
                  No events found.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <tr
                  key={row.id}
                  className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                >
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs align-top">{row.id}</td>
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs whitespace-nowrap align-top">
                    {row.ts.replace("T", " ").replace("Z", "")}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-emerald-400 align-top break-all">
                    {row.event}
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs truncate max-w-[11rem] align-top" title={row.userId ?? undefined}>
                    {row.userId ?? <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs align-top">
                    {row.props == null ? (
                      <span className="text-gray-700">—</span>
                    ) : expanded ? (
                      <pre className="whitespace-pre-wrap break-all text-gray-300 bg-gray-900 rounded p-2 text-xs">
                        {JSON.stringify(row.props, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-gray-500 truncate block max-w-xs">
                        {JSON.stringify(row.props)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => goPage(Math.max(0, offset - PAGE_SIZE))}
          disabled={offset === 0 || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} />
          Prev
        </button>
        <span className="text-xs text-gray-500">
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <button
          onClick={() => goPage(offset + PAGE_SIZE)}
          disabled={offset + PAGE_SIZE >= total || loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

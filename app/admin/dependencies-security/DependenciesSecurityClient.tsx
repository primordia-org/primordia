"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle, Loader, RefreshCw, ShieldAlert, WandSparkles } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/events-client";
import WebPushCategoryButton from "@/components/WebPushCategoryButton";
import type { BunAuditResult } from "@/lib/dependency-audit";

interface Props {
  initialAudit: BunAuditResult;
  initialCheckedAt: ReactNode;
  timestampOptions: Intl.DateTimeFormatOptions;
  initialPushSubscribed: boolean;
}

function formatClientTimestamp(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(timestamp));
}

function isEmptyAuditJson(audit: BunAuditResult): boolean {
  return audit.findings.length === 0 && audit.jsonText.trim() === "{}";
}

function formatRawAuditOutput(audit: BunAuditResult): string {
  const jsonText = audit.jsonText.trim();
  if (jsonText) {
    try {
      return JSON.stringify(JSON.parse(jsonText) as unknown, null, 2);
    } catch {
      // Fall through to raw text if Bun ever emits non-JSON output here.
    }
  }

  return audit.rawOutput || "No bun audit output was returned.";
}

function findingHref(finding: BunAuditResult["findings"][number]): string | undefined {
  return finding.url || (finding.id.startsWith("http://") || finding.id.startsWith("https://") ? finding.id : undefined);
}

function nonSevereFindingLabel(findings: BunAuditResult["findings"]): string {
  const severities = Array.from(new Set(findings.map((finding) => finding.severity.toLowerCase()))).sort();
  const severityLabel = severities.length === 1 ? severities[0] : severities.join("/");
  return `${findings.length} ${severityLabel} issue${findings.length === 1 ? "" : "s"} found`;
}

export default function DependenciesSecurityClient({ initialAudit, initialCheckedAt, timestampOptions, initialPushSubscribed }: Props) {
  const router = useRouter();
  const [audit, setAudit] = useState<BunAuditResult>(initialAudit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const severeCount = audit.severeFindings.length;
  const hasFindings = audit.findings.length > 0;

  async function post(action: string): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/dependencies-security"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      
      const data = (await res.json()) as Record<string, unknown> & { error?: string };

      if (!res.ok || data.error) throw new Error(data.error ?? "Request failed");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    trackEvent("admin/dependency-audit-refreshed/v1", {});
    const data = await post("refresh");
    if (data?.audit) setAudit(data.audit as BunAuditResult);
  }

  async function createSession() {
    trackEvent("admin/dependency-audit-session-created/v1", { severeCount, findingCount: audit.findings.length });
    const data = await post("create-session");
    const sessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
    if (sessionId) router.push(withBasePath(`/evolve/session/${sessionId}`));
  }

  return (
    <div className="space-y-5 min-w-0 max-w-full">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100 flex items-center gap-2">
          <ShieldAlert size={24} strokeWidth={2} className={severeCount > 0 ? "text-red-400" : "text-green-400"} />
          Dependency Security
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Daily checks run <code className="bg-gray-800 px-1 rounded">bun audit --audit-level=high</code>. This page shows the latest live <code className="bg-gray-800 px-1 rounded">bun audit</code> output.
        </p>
        <WebPushCategoryButton
          category="security-vulnerabilities"
          initialSubscribed={initialPushSubscribed}
          className="mt-3"
        />
      </div>

      <div className={`rounded-xl border p-4 ${severeCount > 0 ? "border-red-700/50 bg-red-950/20" : hasFindings ? "border-amber-700/50 bg-amber-950/20" : "border-green-700/50 bg-green-950/20"}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
              {severeCount > 0 ? (
                <AlertTriangle size={17} strokeWidth={2} className="text-red-400" />
              ) : (
                <CheckCircle size={17} strokeWidth={2} className="text-green-400" />
              )}
              {severeCount > 0
                ? `${severeCount} high/critical issue${severeCount === 1 ? "" : "s"} found`
                : hasFindings
                  ? nonSevereFindingLabel(audit.findings)
                  : "No known vulnerable dependencies found"}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Checked {audit.checkedAt === initialAudit.checkedAt ? initialCheckedAt : formatClientTimestamp(audit.checkedAt, timestampOptions)}
            </p>
            {audit.error && <p className="text-xs text-red-300 mt-2">{audit.error}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-200 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {busy ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
            {hasFindings && (
              <button
                type="button"
                onClick={createSession}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {busy ? <Loader size={14} className="animate-spin" /> : <WandSparkles size={14} />}
                Create fix session
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {audit.findings.length > 0 && (
        <div className="rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700 text-sm font-medium text-gray-200">
            Current Vulnerabilities
          </div>
          <div className="divide-y divide-gray-800">
            {audit.findings.map((finding, index) => (
              <div key={`${finding.id}-${index}`} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${finding.severity.toLowerCase() === "critical" ? "bg-red-500/20 text-red-300" : finding.severity.toLowerCase() === "high" ? "bg-orange-500/20 text-orange-300" : "bg-amber-500/20 text-amber-300"}`}>
                    {finding.severity}
                  </span>
                  <span className="font-mono text-gray-300">{finding.packageName}</span>
                  {findingHref(finding) ? (
                    <a href={findingHref(finding)} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-300 transition-colors">
                      {finding.id}
                    </a>
                  ) : (
                    <span className="text-gray-500">{finding.id}</span>
                  )}
                </div>
                <p className="text-gray-200 mt-1">{finding.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="rounded-xl border border-gray-700 overflow-hidden group w-full min-w-0 max-w-full">
        <summary className="px-4 py-3 bg-gray-800/50 text-sm font-medium text-gray-200 cursor-pointer hover:bg-gray-800 transition-colors">
          Raw bun audit output
        </summary>
        <div className="border-t border-gray-700 bg-gray-950 min-w-0 max-w-full overflow-hidden">
          {isEmptyAuditJson(audit) && (
            <p className="p-4 pb-0 text-sm text-gray-300">
              <code className="bg-gray-800 px-1.5 py-0.5 rounded text-green-300">{"{}"}</code>{" "}
              means Bun returned an empty audit result: no known vulnerable installed packages were found.
            </p>
          )}
          <textarea
            readOnly
            aria-label="Raw bun audit output"
            wrap="off"
            value={formatRawAuditOutput(audit)}
            className="block w-full max-w-full h-96 max-h-[32rem] p-4 overflow-x-auto overflow-y-auto resize-y bg-transparent font-mono text-xs leading-relaxed text-gray-300 outline-none"
          />
        </div>
      </details>
    </div>
  );
}

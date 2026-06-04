// instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// Used to start background schedulers and recover evolve workers after a
// server restart.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run in the Node.js server runtime, not the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startUpdateSourceScheduler } = await import(
      "./lib/update-source-scheduler"
    );
    const { startDependencyAuditScheduler } = await import(
      "./lib/dependency-audit-scheduler"
    );
    const { reconnectRunningWorkers } = await import("./lib/evolve-sessions");
    const repoRoot = process.cwd();
    startUpdateSourceScheduler(repoRoot);
    startDependencyAuditScheduler(repoRoot);
    void reconnectRunningWorkers(repoRoot).catch((err) => {
      console.error("[instrumentation] failed to reconnect evolve workers", err);
    });
  }
}

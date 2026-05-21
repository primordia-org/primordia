// instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// Used to start background schedulers.
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
    startUpdateSourceScheduler(process.cwd());
    startDependencyAuditScheduler(process.cwd());
  }
}

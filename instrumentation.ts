// instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// Used to recover evolve workers after a server restart.
// Background schedulers are started by the reverse-proxy singleton via
// lib/scheduled-jobs.ts.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run in the Node.js server runtime, not the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reconnectRunningWorkers } = await import("./lib/threads");
    const repoRoot = process.cwd();
    void reconnectRunningWorkers(repoRoot).catch((err) => {
      console.error("[instrumentation] failed to reconnect evolve workers", err);
    });
  }
}

// instrumentation.ts
// Next.js instrumentation hook — runs once when the server starts.
// Used to start the update-source background scheduler.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // Only run in the Node.js server runtime, not the Edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startUpdateSourceScheduler } = await import(
      "./lib/update-source-scheduler"
    );
    startUpdateSourceScheduler(process.cwd());
  }
}

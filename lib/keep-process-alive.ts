// Keeps daemon-style scripts alive without relying on a forever-pending
// top-level promise. Most operational timers in these daemons are unref'd so
// they do not accidentally keep embedded/temporary callers alive; this helper is
// the one explicit ref'd handle for entrypoints that really are meant to stay up.
// Bun 1.3.14 can busy-loop on `await new Promise(() => {})` when only unref'd
// handles remain, so use a regular ref'd timer instead.

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function keepProcessAlive(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    // Intentionally empty: the timer's ref is what keeps the event loop asleep.
  }, MAX_TIMER_DELAY_MS);
}

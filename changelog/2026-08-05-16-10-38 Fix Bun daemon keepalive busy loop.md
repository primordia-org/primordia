# Fix Bun daemon keepalive busy loop

Replaced forever-pending top-level await keepalive promises in Primordia daemon entrypoints with a shared ref'd timer helper. Bun 1.3.14 can busy-loop on `await new Promise(() => {})` when only unref'd handles remain, which caused the service supervisor and scheduled jobs daemon to consume 100% CPU while idle.

The new helper keeps daemon processes alive with a normal event-loop handle so they sleep correctly between real work. The `primordia jobs run` CLI path now uses the same safe keepalive behavior. Comments now clarify that other periodic operational timers stay unref'd on purpose so embedded or temporary callers can exit naturally; the helper is the single intentional keepalive handle for daemon entrypoints.

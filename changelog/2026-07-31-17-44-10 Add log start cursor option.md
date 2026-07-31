# Add log start cursor option

Added a `--start` option with `-s` alias to all Primordia log commands so clients can request log output beginning at a specific 1-based line number. This gives reconnecting/future clients a simple cursor for fetching missed log lines without re-reading only the default recent tail.

When combined with `--lines`, the command returns at most that many lines from the requested cursor. Without `--lines`, `--start` returns all available lines from the cursor onward.

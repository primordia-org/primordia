# Remove duplicate time display from running agent sections

## What changed

- Removed the elapsed time counter from the top-right corner of the "🤖 {agent} running…" section header. The time was already shown in the bottom-left `MetricsRow`, making the top-right display redundant.
- Unified `formatDuration()` to always use `Xm Ys` format (e.g. `1m 29s`) instead of showing raw seconds with a decimal (e.g. `88.5s`) for durations under a minute. Previously the live counter used `88.5s` style while the finished section used `1m 29s` style — now both use the same consistent format.

## Why

The time elapsed was displayed in two places simultaneously during a running agent section, which was cluttered and redundant. Standardising the format makes the UI consistent between in-progress and completed sections.

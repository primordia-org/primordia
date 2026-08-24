# Revert thread view dates

Removed the premature thread-view-dates data/model changes while preserving a lightweight request-card date display. Thread request cards now show the existing request event timestamp in the top-right corner, without adding last-worked fields or changing structured log/database data.

This keeps the useful request date cue while reverting the accidental broader merge.

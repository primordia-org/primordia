# Revert thread view dates

Removed the premature thread-view-dates UI changes so thread request cards no longer show created or last-worked calendar dates. The thread session model no longer exposes last-worked timestamps, and the earlier changelog entry for the unready feature was removed.

This reverts the accidental merge while keeping the codebase aligned with the intended current thread UI.

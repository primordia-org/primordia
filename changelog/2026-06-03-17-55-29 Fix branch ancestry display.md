# Fix branch ancestry display

The Branches page no longer shows a branch as both an active descendant of production and a past production ancestor.

This could happen when an accepted parent branch was collapsed to the current production branch for active-work display, while the same branch also appeared in the production parent chain. Branches already identified as production ancestors are now excluded from the active descendants tree, so they are rendered only in Past Sessions.

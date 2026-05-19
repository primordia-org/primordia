# Skip accepted parents in branch tree

Updated the Branches page parent resolution so active branch trees skip over accepted session branches. This keeps live descendant work attached to the nearest active ancestor (typically the current production branch) when using branch-marker parentage, while preserving the recorded parent relationship for the Past Sessions history.

This fixes cases where ready branches created from an accepted branch marker were incorrectly shown under Past Sessions instead of remaining visible in the Active tree.

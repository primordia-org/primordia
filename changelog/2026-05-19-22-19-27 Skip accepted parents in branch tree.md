# Skip accepted parents in branch tree

Updated the Branches page parent resolution so active branch trees skip over accepted session branches. If an accepted parent is already part of the current production chain, live descendants are attached directly to the current production branch; otherwise they fall back to the nearest non-accepted ancestor.

Past Sessions still preserve the recorded parent relationship for terminal branches, but non-terminal/live branches are no longer duplicated under accepted historical slots.

This fixes cases where ready branches created from an accepted branch marker were incorrectly shown under Past Sessions instead of remaining visible under the Active production tree.

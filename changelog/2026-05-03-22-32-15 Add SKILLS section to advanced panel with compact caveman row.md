# Add SKILLS section to advanced panel with compact caveman row

## What changed

- Added a "SKILLS" heading (small caps separator) in the Advanced options panel of `EvolveRequestForm`, positioned after the Harness and Model selectors.
- Compacted the caveman row: checkbox + "Caveman - reduce output tokens" label + intensity dropdown now live together on one line under the SKILLS heading.
- Intensity dropdown is always visible (not hidden when caveman is unchecked), but disabled when caveman mode is off — makes the option more discoverable and the row self-contained.
- Removed the old verbose "Caveman mode — cuts ~75% output tokens" label in favour of the shorter "Caveman - reduce output tokens".

## Why

User requested a cleaner, more token-efficient layout for the advanced panel, grouping caveman (and future skills) under a dedicated "SKILLS" heading and reducing the text footprint of the caveman row.

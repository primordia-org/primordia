# Default update fetch schedule

New Primordia instances now initialize the built-in Primordia Official update source with automatic fetching enabled once per day and a 1-day commit delay.

This keeps fresh installs aware of upstream updates by default while preserving a safety buffer before newly published commits are surfaced as available updates. Existing instances keep their configured update schedule because the built-in source still preserves any schedule already written in git config.

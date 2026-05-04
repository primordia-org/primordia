# Fix hardcoded "Claude" reference in session follow-up form

## What changed

The follow-up request form on the evolve session page showed a hardcoded tooltip/disabled label reading **"Waiting for Claude to finish…"** regardless of which AI harness or model was actually in use.

This label now dynamically reflects the **currently running** agent — derived from the active section (the last content section while the pipeline is executing). This is correct even for follow-up requests that use a different harness/model than the original run:

- If the active section is Pi / Claude Sonnet 4: **"Waiting for Pi (Claude Sonnet 4) to finish…"**
- If only the harness is known: **"Waiting for Pi to finish…"**
- If no harness info is available (e.g. a type-fix section, old session record): **"Waiting for the agent to finish…"**

## Why

Primordia is model-agnostic and supports multiple AI harnesses. Hardcoding "Claude" in user-visible UI text was inaccurate and inconsistent with the rest of the session view. An earlier version of this fix incorrectly used `sessionHarness`/`sessionModel` (derived from the most-recently-completed agent section, intended for pre-populating the follow-up form's defaults) — those can be stale when a follow-up request runs with a different harness. The fix now reads harness/model directly from the active (currently running) section.

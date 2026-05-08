# Convert UTC error times to browser local timezone

## What changed

Added a utility function `convertUtcTimeToLocal()` in `lib/utc-to-local-time.ts` that detects UTC time strings in error messages (e.g., "resets 10:30pm (UTC)") and converts them to the browser's local timezone with timezone abbreviation (e.g., "2:30pm EST").

Updated `DoneAgentSection` in `EvolveSessionView.tsx` to apply this conversion when rendering error details from Claude Code results, wrapped in a useEffect to avoid SSR hydration mismatch.

## Why

When Claude Code returns error messages like "You've hit your limit · resets 10:30pm (UTC)", the UTC time wasn't meaningful to users in different timezones. Now these times are automatically converted to the user's local timezone with the appropriate abbreviation.

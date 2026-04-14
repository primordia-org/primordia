# Sticky harness and model defaults for evolve forms

## What changed

### Sticky preference across new requests
`EvolveRequestForm` now persists the user's chosen harness and model to
`localStorage` (`evolve:preferred-harness` and `evolve:preferred-model`) whenever
they change them via the Advanced panel. The next time a new-request form is
opened (on `/evolve`, in the floating dialog, or elsewhere), the stored values
are loaded on mount so the user doesn't have to re-select their preferred
agent every time.

### Follow-up form inherits previous session's harness/model
The follow-up form on the session detail page now defaults to the same harness
and model that was used for the most-recent agent run in that session (read from
the structured `section_start` events). This makes it easy to continue working
with the same agent configuration without accidentally switching harness
mid-session.

If the user changes harness/model in the follow-up form, the new selection is
saved to `localStorage` as usual, so it also becomes the new sticky default for
future new requests.

### Implementation details
- Added `STORAGE_KEY_HARNESS` / `STORAGE_KEY_MODEL` constants and three helpers
  (`readStoredHarness`, `readStoredModel`, `saveStoredPreference`) at the top of
  `EvolveRequestForm.tsx`.
- Added `defaultHarness?: string` and `defaultModel?: string` props to
  `EvolveRequestForm`. When these are provided the localStorage sticky is
  bypassed for the initial render (the explicit default takes priority).
- `EvolveSessionView` computes `sessionHarness` / `sessionModel` by finding the
  last `section_start` event with `sectionType === 'agent'` and passes them as
  `defaultHarness` / `defaultModel` to the follow-up `EvolveRequestForm`.
- The reset-after-submit path (when `onSubmit` prop is used) now resets to the
  caller-provided defaults or localStorage values rather than the compile-time
  `DEFAULT_HARNESS` / `DEFAULT_MODEL` constants.

## Why
Switching harness accidentally (because the form reset to the global default)
was a common friction point. Sessions should feel continuous: if you started
with Pi, follow-ups should default to Pi without extra clicks.

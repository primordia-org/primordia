# Show available actions panel while Claude is running

## What changed

The "Available Actions" panel on the session page (`/evolve/session/[id]`) is now rendered as soon as the session starts, rather than only appearing once Claude has finished and the session reaches `ready` status.

- **Follow-up Changes**: the button and textarea are visible and editable during `starting` and `running-claude` states, so you can compose your follow-up while Claude is still working. The submit button is disabled (showing "Waiting for Claude to finish…") until the session becomes `ready`.
- **Accept Changes / Reject Changes**: buttons are visible but greyed out (disabled) while Claude is running. A note in the panel header reads "Accept & Reject available once Claude finishes" to make the state clear.
- Once Claude finishes and the session is `ready`, all three actions become fully interactive as before.

## Why

Users had to sit idle waiting for Claude to finish before they could even start thinking about what follow-up to submit. Showing the panel early lets them draft their next request in parallel with Claude's work, reducing friction between iterations.

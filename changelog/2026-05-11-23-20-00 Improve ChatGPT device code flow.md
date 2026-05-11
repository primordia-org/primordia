# Improve ChatGPT device code flow

Updated the ChatGPT subscription device-code prompt so starting authentication no longer opens the verification page automatically. The prompt now presents two clear sibling steps: copy the one-time code first, then open the verification link when ready.

Added a dedicated copy button with success feedback aligned with the code, and restyled the prompt without over-heavy effects. Replaced the spinner with plain helper text so the UI does not imply the user is waiting on an in-progress local action.

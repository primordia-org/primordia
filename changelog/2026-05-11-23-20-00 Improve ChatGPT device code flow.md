# Improve ChatGPT device code flow

Updated the ChatGPT subscription device-code prompt so starting authentication no longer opens the verification page automatically. The prompt now focuses on the two required controls: copy the one-time code first, then open the verification link when ready.

Added a dedicated copy button with success feedback aligned with the code, and restyled the prompt, connected-state card, and primary action button to match the cleaner Claude.ai credential form style. Removed implementation-detail helper copy, removed the spinner/status text, and hid the sign-in button while the device-code flow is active.

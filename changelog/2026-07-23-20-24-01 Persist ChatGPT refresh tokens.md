# Persist ChatGPT refresh tokens

ChatGPT subscription OAuth credentials now round-trip refreshed access and refresh tokens back into Primordia's encrypted billing-source storage.

Previously, Pi and Codex workers could refresh an expired ChatGPT access token for a single run, but the refreshed token set stayed only in worker-local memory or temporary Codex config. When OpenAI rotated the refresh token, Primordia kept reusing the old encrypted refresh token on the next thread and users had to repeat the device-code login flow.

This change adds server-side re-encryption with the user's Primordia AES key, shared ChatGPT credential conversion helpers, and persistence from slug generation plus Pi/Codex worker paths whenever refreshed token material changes.

# Hide ChatGPT subscription dollar costs

Primordia no longer shows per-run dollar cost for evolve sessions that used ChatGPT subscription OAuth credentials.

The Pi worker can still receive token/cost accounting from its model registry, but that number is not a user bill when the selected billing source is a ChatGPT subscription. New ChatGPT subscription runs now write `null` for `costUsd`, and the session UI also hides cost for older runs whose agent section records `chatgpt-subscription` auth.

The model picker also hides per-token price hints for ChatGPT subscription models and labels them as subscription-backed instead, avoiding confusing `$` pricing in subscription flows.

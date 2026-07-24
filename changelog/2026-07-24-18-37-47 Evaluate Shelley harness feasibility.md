# Evaluate Shelley harness feasibility

Documented the feasibility of adding [Shelley](https://github.com/boldsoftware/shelley) as a future Primordia harness backend.

What changed:

- Added `docs/shelley-harness-feasibility.md` with a concrete verdict, Primordia/Shelley contract mapping, recommended integration phases, risks, and open questions.
- Updated `/under-the-hood` to summarize the Shelley finding alongside the existing harness architecture explanation.

Why:

Shelley has promising overlap with Primordia's harness needs—worktree-aware coding, HTTP/SSE APIs, git/file tools, and multi-model support—but it is shaped as a long-running web app rather than Primordia's one-shot detached worker model. The new note captures that adding Shelley is feasible, but should start with a private wrapper-worker prototype before appearing as a production harness option.

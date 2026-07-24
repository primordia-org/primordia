# Shelley harness backend feasibility

Primordia can add [Shelley](https://github.com/boldsoftware/shelley) as a harness backend, but it is a medium-sized integration rather than a small model-list change.

## Verdict

**Feasible, with a wrapper-worker approach.** Shelley already has the primitives Primordia needs: a coding-agent loop, shell/file/git tools, multi-model provider configuration, HTTP endpoints for creating conversations and sending messages, SSE streams for progress, cancellation, and an Apache-2.0 license. The main mismatch is lifecycle: Primordia harnesses are one-shot detached workers that write normalized `.primordia-session.ndjson` events, while Shelley is primarily a long-running web app with its own SQLite database and conversation stream.

The safest path is to add a `scripts/shelley-worker.ts` wrapper that launches or talks to a private Shelley server for the worktree, drives a single conversation through Shelley's HTTP API, translates Shelley stream events into Primordia session events, and exits when the turn completes.

## Fit against Primordia's harness contract

| Primordia requirement | Shelley support | Integration work |
| --- | --- | --- |
| Run inside a git worktree | Supports `cwd` on conversations and git/file APIs | Pass the thread worktree as conversation cwd and keep Primordia's branch setup unchanged. |
| Submit initial/follow-up prompts | `POST /api/conversations/new` and `POST /api/conversation/<id>/chat` | Store Shelley conversation ID in the thread log or a small worktree metadata file for follow-ups. |
| Stream progress | `GET /api/conversation/<id>/stream` and `/api/stream2` SSE | Map messages, stream deltas, tool progress, and state updates into `message`, `tool_call`, `tool_result`, and result events. |
| Cancel running work | `POST /api/conversation/<id>/cancel` | Extend abort handling so `shelley-worker` forwards SIGTERM to Shelley cancel before killing the private server. |
| Use selected model | Global `-default-model`, `/api/models`, and conversation model fields | Needs model ID mapping and a generated Shelley model list. |
| Use Primordia billing sources | Env vars and Shelley `shelley.json` `llm_gateway`; no Claude subscription compatibility discovered | Gateway/API-key paths look straightforward; Claude subscription and ChatGPT OAuth would need deeper Shelley support or should be hidden. |
| Persist only Primordia state | Shelley uses its own SQLite DB | Use one Shelley DB per thread under the worktree (for example `.primordia-shelley.db`) so cleanup/archive remains local. |

## Recommended implementation phases

1. **Prototype wrapper only**
   - Require a `shelley` binary on `PATH` or download/install it during provisioning.
   - Add `scripts/shelley-worker.ts`.
   - Launch `shelley -db <worktree>/.primordia-shelley.db -config <temp-config> serve -port 0 -port-file <temp-file> -socket none -banner "Primordia thread <id>"`.
   - Create a conversation with the worktree `cwd` and the Primordia prompt.
   - Stream until Shelley marks the conversation not working, then emit a Primordia result.

2. **Expose as an experimental harness**
   - Add `shelley` to `HARNESS_OPTIONS` behind a conservative availability gate.
   - Start with gateway/API-key billing sources only.
   - Add model options from `shelley models` or Shelley's `/api/models`, filtered to IDs Shelley can actually serve.

3. **Improve event normalization**
   - Translate Shelley tool progress into the same structured events used by Pi/Codex.
   - Preserve final assistant text outside the progress accordion.
   - Add rotation/persistence only for auth flows Shelley explicitly supports.

4. **Operational hardening**
   - Add install/deploy checks for the Shelley binary.
   - Add health checks, timeout behavior, PID cleanup, and per-thread Shelley DB archive/deletion.
   - Test follow-ups, aborts, server restarts, and accept/reject cleanup.

## Key risks and open questions

- **Binary availability:** Shelley is not an npm package; Primordia would need to install a Go-built binary or vendor a downloader.
- **Lifecycle mismatch:** A server-per-thread or server-per-run design must be kept private and reliably cleaned up.
- **Auth coverage:** Gateway and plain provider API keys are likely viable. Claude subscription credentials and ChatGPT subscription OAuth are not proven from the public API docs inspected.
- **Event fidelity:** Shelley streams rich conversation state, but Primordia still needs a normalization layer to keep the thread page consistent across harnesses.
- **Model IDs:** Shelley has its own model registry and provider-source rules, so Primordia should not reuse Pi/Codex model lists blindly.

## Recommendation

Do **not** add Shelley as a visible production harness until a wrapper proves one initial run, one follow-up, abort, and cleanup. The integration is worthwhile because Shelley is open, web-first, multi-modal, and exe.dev-aligned, but it should ship as an experimental harness after the wrapper-worker and auth/model gating are in place.

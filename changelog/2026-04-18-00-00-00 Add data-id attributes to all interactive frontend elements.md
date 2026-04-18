# Add data-id attributes to all interactive frontend elements

Added `data-id` attributes to every interactive and semantically meaningful element across the frontend — buttons, inputs, links, menus, dialogs, and key containers. The naming convention is `scope/element-role` in kebab-case, where scope reflects the feature area rather than the component name, making the values stable across refactors.

These ids serve as a shared vocabulary for automated testing, telemetry, and LLM-user discussion about the frontend.

## Components updated

- **AcceptRejectBar** — `preview/accept-changes`, `preview/reject-changes`, `preview/dismiss-error`
- **AdminPermissionsClient** — `admin-users/toggle-evolve-access`
- **AdminRollbackClient** — `admin-rollback/apply-rollback`
- **AdminServerHealthClient** — `admin-health/disk-cleanup-threshold`, `admin-health/preview-inactivity-timeout`, `admin-health/delete-oldest-worktree`
- **AdminSubNav** — `admin-nav/{tab-id}` (dynamic, covers users/logs/proxy-logs/rollback/server-health/git-mirror)
- **ApiKeyDialog** — `api-key/close`, `api-key/anthropic-console`, `api-key/key-input`, `api-key/toggle-visibility`, `api-key/clear-key`, `api-key/cancel`, `api-key/save-key`
- **ChangelogEntryDetails** — `changelog/entry-details`
- **ChatInterface** — `chat/message-input`, `chat/send-message`
- **CopyButton** — `content/copy-to-clipboard`
- **CreateSessionFromBranchButton** — `branches/create-session-trigger`, `branches/create-session-request`, `branches/create-session-submit`, `branches/create-session-cancel`
- **DiffFileExpander** — `diff/file-toggle`
- **EvolveRequestForm** — `evolve/request-input`, `evolve/remove-file-attachment`, `evolve/remove-element-attachment`, `evolve/attach-files`, `evolve/pick-element`, `evolve/submit-request`, `evolve/advanced-toggle`, `evolve/harness-select`, `evolve/model-select`, `evolve/caveman-mode`, `evolve/caveman-intensity`
- **EvolveSessionView** — `session/apply-upstream-updates`, `session/abort`, `session/restart-preview`, `session/tab-followup`, `session/tab-accept`, `session/tab-reject`, `session/clear-element-context`, `session/confirm-accept`, `session/confirm-reject`, `session/new-request-link`, `session/changelog-link`, `session/branches-link`
- **FloatingEvolveDialog** — `evolve-dialog/dock-{position}` (top/bottom/top-left/top-right/bottom-left/bottom-right), `evolve-dialog/close`, `evolve-dialog/view-session`
- **GitMirrorClient** — `git-mirror/integration-link`, `git-mirror/url-input`, `git-mirror/save-mirror`, `git-mirror/remove-mirror`
- **HamburgerMenu** — `nav/menu-toggle`, `nav-menu/sign-out`, `nav-menu/sign-in`, `nav-menu/api-key`; extended `MenuItem` interface with optional `dataId` field; `buildStandardMenuItems()` now populates `nav-menu/go-to-chat`, `nav-menu/propose-change`, `nav-menu/branches`, `nav-menu/admin`
- **LandingSections** — `landing/exedev-link`, `landing/footer-chat`, `landing/footer-evolve`, `landing/footer-changelog`, `landing/footer-login`
- **NavHeader** — `nav/home`, `nav/changelog-link`, `nav/branches-link`
- **PruneBranchesButton** — `branches/delete-merged-trigger`
- **ServerLogsClient** — `logs/resume-scroll`, `logs/clear`, `logs/reconnect`
- **StreamingDialog** — `dialog/close`, `dialog/cancel`, `dialog/confirm-action`, `dialog/dismiss`
- **WebPreviewPanel** — `preview/back`, `preview/forward`, `preview/refresh`, `preview/url-bar`, `preview/inspector-toggle`, `preview/open-in-new-tab`

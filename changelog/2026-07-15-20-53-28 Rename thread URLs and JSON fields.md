# Rename thread URLs and JSON fields

Changed the user-facing thread detail URL from `/evolve/session/[id]` to `/thread/[id]` and removed the old route entirely so broken or stale links fail visibly instead of being masked by redirects. The standalone request page moved from `/evolve` to `/thread`, and the thread/branch overview moved from `/branches` to `/threads`.

Moved REST endpoints out of `app/api/evolve` so thread and agent-run APIs now live under `/api/thread`, while preview/process-management APIs live under `/api/server`. JSON request and response fields use `threadId`, and query-based thread APIs use `threadId` as well.

Updated UI navigation, thread creation flows, diff/log streams, attachment links, admin-created thread flows, and internal preview DB hotswap calls to use the new route names. A final non-changelog sweep also renamed remaining user-facing "evolve" wording to thread terminology, including shared thread dialog/form component names, settings copy, admin permission copy, docs, tests, and route comments. A follow-up pass refined the Manage Users page to label the access controls as "Code Editing Permissions" and removed awkward "thread flow" wording from that page. Internal compatibility keys such as the existing `can_evolve` role and persisted preference/draft keys remain unchanged where renaming would require a migration.

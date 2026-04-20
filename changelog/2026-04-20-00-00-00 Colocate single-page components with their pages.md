# Colocate single-page components with their pages

## What changed

Audited `components/` and moved every component that is only ever used by a single page (directly or transitively) into that page's directory. TypeScript paths (`@/`) were updated in all moved files so they still resolve correctly.

### Files moved

| Old path | New path |
|---|---|
| `components/ChatInterface.tsx` | `app/chat/ChatInterface.tsx` |
| `components/AdminPermissionsClient.tsx` | `app/admin/AdminPermissionsClient.tsx` |
| `components/AdminRollbackClient.tsx` | `app/admin/rollback/AdminRollbackClient.tsx` |
| `components/AdminServerHealthClient.tsx` | `app/admin/server-health/AdminServerHealthClient.tsx` |
| `components/GitMirrorClient.tsx` | `app/admin/git-mirror/GitMirrorClient.tsx` |
| `components/ChangelogEntryDetails.tsx` | `app/changelog/ChangelogEntryDetails.tsx` |
| `components/LandingNav.tsx` | `app/LandingNav.tsx` |
| `components/LandingSections.tsx` | `app/LandingSections.tsx` |
| `components/CopyButton.tsx` | `app/CopyButton.tsx` |
| `components/CreateSessionFromBranchButton.tsx` | `app/branches/CreateSessionFromBranchButton.tsx` |
| `components/PruneBranchesButton.tsx` | `app/branches/PruneBranchesButton.tsx` |
| `components/PruneBranchesDialog.tsx` | `app/branches/PruneBranchesDialog.tsx` |
| `components/StreamingDialog.tsx` | `app/branches/StreamingDialog.tsx` |
| `components/EvolveForm.tsx` | `app/evolve/EvolveForm.tsx` |
| `components/EvolveSessionView.tsx` | `app/evolve/session/[id]/EvolveSessionView.tsx` |
| `components/DiffFileExpander.tsx` | `app/evolve/session/[id]/DiffFileExpander.tsx` |
| `components/HorizontalResizeHandle.tsx` | `app/evolve/session/[id]/HorizontalResizeHandle.tsx` |
| `components/WebPreviewPanel.tsx` | `app/evolve/session/[id]/WebPreviewPanel.tsx` |

### Components that remain in `components/`

These components are used by more than one page (or are used by components that span multiple pages):

| File | Reason stays |
|---|---|
| `AdminSubNav.tsx` | Used by 6 admin pages |
| `ApiKeyDialog.tsx` | Used by `HamburgerMenu`, which spans all pages |
| `EvolveRequestForm.tsx` | Used by `EvolveForm`, `FloatingEvolveDialog`, and `EvolveSessionView` (3 different pages) |
| `FloatingEvolveDialog.tsx` | Used by `PageNavBar`, `LandingNav`, `ChatInterface`, `EvolveSessionView` |
| `ForbiddenPage.tsx` | Used by 7+ pages |
| `HamburgerMenu.tsx` | Used by most pages |
| `NavHeader.tsx` | Used by most pages |
| `PageElementInspector.tsx` | Used by `EvolveRequestForm`, which is multi-page |
| `PageNavBar.tsx` | Used by 8+ pages |
| `ServerLogsClient.tsx` | Used by `admin/logs` and `admin/proxy-logs` |
| `SimpleMarkdown.tsx` | Used by `ChangelogEntryDetails` and directly by `app/markdown-test/page.tsx` |

## Audit findings — `components/*.tsx` issues

### Dead code
- **`AcceptRejectBar.tsx`** — Not imported anywhere. The changelog shows it was removed from `app/layout.tsx` in a previous change but the file was never deleted.

### Multiple exports (filename matches only one export)
- **`FloatingEvolveDialog.tsx`** — exports both `FloatingEvolveDialog` and `EvolveSubmitToast`
- **`SimpleMarkdown.tsx`** — exports both `SimpleMarkdown` and `MarkdownContent`

### Non-React-component named exports
- **`HamburgerMenu.tsx`** — also exports `buildStandardMenuItems` (utility fn), `MenuItem` (interface), `SessionUser` (re-exported type). These utility exports should live in a `lib/` file.
- **`PageElementInspector.tsx`** — exports 6 utility functions (`getCssSelector`, `getComponentRootElement`, `getReactComponentName`, `getReactComponentChain`, `generateFiberTreeText`, `captureElementFiles`) and 1 interface (`PageElementInfo`) alongside the React component. These should be extracted to a lib module.

### Default exports (harder to rename/refactor than named exports)
- `AcceptRejectBar.tsx`, `AdminSubNav.tsx`, `ForbiddenPage.tsx`, `ServerLogsClient.tsx` all use `export default`. Convention in this codebase is mixed; these are noted but not changed here to keep the diff minimal.

## Why

The `components/` directory had grown to 30 files regardless of whether a component served one page or many. By colocating single-page components beside their page file, navigating from a page to its implementation is a one-step `./` import, and it is immediately obvious which components are shared vs. page-local.

# Track branch parents via branch markers

Branch parentage is now recorded in an empty branch-marker commit on new evolve session branches while preserving the legacy local git-config parent metadata.

This adds helpers for writing and reading branch marker trailers, and updates diff/upstream/accept/session/branch views to resolve parents through a selectable source of truth. Branch markers use generic git trailers rather than app-specific trailer names:

```text
Branched-From: feature/auth
Base-Commit: abc1234
```

The `/branches` page now has a per-user toggle between:

- `git-config` — the legacy `branch.<name>.parent` metadata path, kept as the default for current branches.
- `branch-marker` — the new trailer-based metadata path, with no silent fallback to git config so it can be tested honestly.

The toggle uses the app's standard on/off switch styling, and the branch tree now renders descendants below the current branch even when that branch is not attached to the production ancestry. For the current branch tree, descendants are inferred from git commit ancestry when branch parent metadata is missing, so manually-created child branches still nest correctly.

New session branches always write both metadata formats. Deploy-time sibling reparenting for the legacy git-config path is also kept so the old behavior remains available while branch-marker tracking is validated.

This makes branch parent metadata able to travel with pushes and clones, while allowing safe iteration by switching back to the proven git-config behavior at any time.

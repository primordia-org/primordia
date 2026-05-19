# Track branch parents via fork markers

Branch parentage is now recorded in an empty fork-marker commit on new evolve session branches while preserving the legacy local git-config parent metadata.

This adds helpers for writing and reading `Primordia-Forked-From` commit trailers, and updates diff/upstream/accept/session/branch views to resolve parents through a selectable source of truth. The `/branches` page now has a per-user toggle between:

- `git-config` — the legacy `branch.<name>.parent` metadata path, kept as the default for current branches.
- `fork-marker` — the new trailer-based metadata path, with no silent fallback to git config so it can be tested honestly.

New session branches always write both metadata formats. Deploy-time sibling reparenting for the legacy git-config path is also kept so the old behavior remains available while fork-marker tracking is validated.

This makes branch parent metadata able to travel with pushes and clones, while allowing safe iteration by switching back to the proven git-config behavior at any time.

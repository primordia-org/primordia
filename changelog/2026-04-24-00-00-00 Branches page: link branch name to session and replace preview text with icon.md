# Branches page: link branch name to session and replace preview text with icon

## What changed

- **Branch name is now the session link.** When a branch has an associated evolve
  session, its name in the branch tree is rendered as a `<Link>` to
  `/evolve/session/{name}`. The separate purple `session ↗` text link has been
  removed — one fewer element per row.

- **Preview link replaced with `ExternalLink` icon.** The `"preview ↗"` /
  `"view ↗"` text links are replaced with the same `<ExternalLink size={13} />`
  Lucide icon used in the WebPreviewPanel "open in new tab" toolbar button.
  The anchor uses `inline-flex items-center` so the icon aligns to the text
  baseline of the flex row (which uses `items-baseline`). A `title` tooltip
  (`"Open preview"` / `"View site"`) preserves discoverability.

- **Tighter tree indentation.** Connector strings shortened from `"└── "` /
  `"├── "` (4 chars) to `"└─ "` / `"├─ "` (3 chars), with child line prefixes
  reduced proportionally — less horizontal nesting per level.

- **Legend updated** to reflect the new layout (no more `session ↗` entry;
  icon shown inline).

## Why

The previous layout had each branch row wrapped to a second line showing
`session ↗  preview ↗` as separate text links. Making the branch name itself
the session link removes the wrap-trigger and the redundant label. The icon-only
preview link is recognisable (same icon as the WebPreviewPanel toolbar) and
takes far less horizontal space, keeping each branch on a single line.

# Fix bullet list rendering on evolve page

## What changed

Replaced `SimpleMarkdown` with `MarkdownContent` in `EvolveForm.tsx` for rendering progress messages.

## Why

`SimpleMarkdown` is an inline renderer designed for a single line of text — it has no concept of paragraphs or bullet lists. When Claude Code emits progress text containing bullet lists (e.g. `- item 1\n- item 2\n- item 3`), passing that multi-line string to `SimpleMarkdown` caused all bullets to be smooshed onto one line with no separation.

`MarkdownContent` is the block-level renderer that correctly splits content on blank lines into paragraphs, detects bullet list items, and renders them as `<ul>/<li>` elements — exactly what was needed here.

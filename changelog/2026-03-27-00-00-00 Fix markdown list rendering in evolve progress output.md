# Fix markdown list rendering in evolve progress output

## What changed

In `lib/local-evolve-sessions.ts`, tool-use events emitted by the Claude Agent SDK
are formatted as markdown bullet-list items (`- 🔧 <tool> <arg>\n`). When a run of
those list items was immediately followed by a prose text block, there was no blank
line between the last list item and the paragraph. Standard CommonMark requires a
blank line to close a list before a paragraph; without it, renderers (including
`react-markdown`) treat the paragraph text as a continuation of the last list item
and suppress the bullet points.

The fix is applied in two places — `startLocalEvolve` and `resolveConflictsWithClaude`
— both of which share the same streaming loop pattern:

```ts
// Before appending a text block, ensure the list is closed with a blank line
if (progressText.endsWith('\n') && !progressText.endsWith('\n\n')) {
  appendProgress(session, '\n'); // close the list
}
appendProgress(session, block.text.trimEnd() + '\n\n');
```

This check fires only when the running progress string ends with exactly one newline
(i.e. the last thing appended was a list item). It adds a second newline before the
text, producing the required blank-line separator. When the last content was already a
paragraph (ending `\n\n`) or the progress string is empty, the condition is false and
nothing extra is inserted.

## Why

Users watching live evolve progress in the chat interface saw tool-use items rendered
as plain text instead of a bulleted list, because the missing blank line prevented
markdown bullet rendering. This made it hard to skim what Claude was doing.

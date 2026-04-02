# Fix multiline Bash tool calls breaking session log details split

## What changed

In `lib/evolve-sessions.ts`, the `summarizeToolUse` function for `Bash` commands now
replaces newlines with spaces and removes the 80-character truncation.

Previously it did:
```ts
case 'Bash': return `Bash \`${command.slice(0, 80)}\``;
```

Now it does:
```ts
case 'Bash': return `Bash \`${command.replace(/\r?\n/g, ' ')}\``;
```

## Why

Claude's git commit instructions tell it to pass the commit message via a heredoc:
```bash
git commit -m "$(cat <<'EOF'
   Commit message here.
   Co-Authored-By: ...
   EOF
   )"
```

The `command` string for this tool call contains literal newlines. When
`summarizeToolUse` embedded those newlines into the `- 🔧 Bash ...` log line,
the `splitClaudeContent` function in `EvolveSessionView.tsx` was fooled: it
scans backwards for the last line starting with `- 🔧 `, finds the first line
of the multiline command, and then treats all the continuation lines
(heredoc body, closing `EOF`, etc.) as the "final message" shown *outside*
the `<details>` block — displaying raw heredoc fragments to the user instead
of Claude's actual summary.

The fix replaces all newlines with spaces, keeping every `- 🔧 ` log entry as
a single line while preserving the full command text. The previous 80-character
hard truncation is also removed — it was hiding useful command context.

# Show most recent changelog entry instead of git commit

The "Most recent change:" message shown in the chat on startup now displays the
most recent `changelog/` entry (title + full body) instead of the raw git commit
message. This gives users a human-readable summary of what changed rather than
an internal commit log line.

`app/page.tsx` was updated to read the `changelog/` directory, sort files
lexicographically (which equals chronological order given the filename convention),
pick the newest file, and pass its title and body as the initial chat message.

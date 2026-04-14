# Fix deploy log spacing and main branch pointer

## What changed

### Deploy log spacing
The deploy log in the "Deployed to production" accordion was showing extra blank lines between certain steps (e.g. between "Installing dependencies…" and "Starting new production server…").

**Root cause:** Some log line events already contained a trailing `\n` in their content (e.g. lines emitted by `blueGreenAccept` and by the reverse proxy via `spawnProdViaProxy`). The component joined all log lines with `\n`, so lines that already ended with `\n` produced a double-newline (blank line) in the rendered `<pre>`.

**Fix:** Strip trailing newlines from each log line's content before joining them with `\n` in `EvolveSessionView.tsx`:
```js
.map((e) => e.content.replace(/\n+$/, ''))
.join('\n')
```

### `main` branch pointer not being moved
After a blue/green production deploy, `moveMainAndPush` was silently failing to advance the `main` branch ref to the accepted session branch.

**Root cause:** The function used `git branch -f main <branch>` to force-move the ref. Git rejects this command when `main` is currently checked out in the target repository — which is typically the case for the main repo (`~/primordia`).

**Fix:** Replaced `git branch -f` with the plumbing-level `git update-ref refs/heads/main <sha>`, which updates the ref directly in the object store without any working-tree checks. The accepted branch's HEAD SHA is resolved first with `git rev-parse <branch>`, then passed to `git update-ref`.

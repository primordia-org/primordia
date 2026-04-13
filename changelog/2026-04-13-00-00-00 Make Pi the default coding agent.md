# Make Pi the default coding agent

Changed `DEFAULT_HARNESS` in `lib/agent-config.ts` from `'claude-code'` to `'pi'`.

New evolve sessions will now use the Pi coding agent by default instead of Claude Code. Users can still switch to Claude Code via the Advanced options in the evolve request form.

# Update pi SDK presets

Updated `@earendil-works/pi-coding-agent` to the latest release and regenerated Primordia's bundled model registry so thread model pickers include the current Claude, Codex/OpenAI, Gemini, and OpenRouter options.

Built-in presets now point at models present in the refreshed registry, including Claude Sonnet 5, GPT-5.6 Luna, OpenRouter Claude Sonnet 5, and a currently available free OpenRouter coding option. The pi worker and slug-generation helper were also updated for the newer pi SDK `ModelRuntime` credential APIs.

Thread session archives are ignored by git and now resolve worktree-local paths back to the Primordia installation root before writing `past-sessions/`, so cleanup archives land in the shared runtime directory instead of inside an individual worktree.

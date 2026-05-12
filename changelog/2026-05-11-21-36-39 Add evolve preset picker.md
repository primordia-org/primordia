# Add evolve preset picker

Replaced the Advanced harness/model controls in the evolve form with an available Preset picker. Presets bundle billing source, harness, model, and display name so users can switch common configurations by name instead of manually coordinating auth source and model selection.

Added built-in presets (including a secret-free exe.dev gateway default) plus `/settings/presets` for user-defined presets. Availability is based on stored user secrets for the preset billing source, while the exe.dev gateway is treated as secret-free unless explicitly disabled.

The preset editor now uses a three-stage Billing Source → Harness → Model flow. Billing source narrows the harness list, billing source plus harness narrows the model list, and the existing rich model picker is reused with preset-aware filtering. Built-in and custom presets share one compact list with update-source-style controls: built-ins use toggle icons for enable/disable, custom presets use explicit edit/trash actions, edits are saved from each preset card instead of one global save button, and the Add custom preset control uses the dashed full-width style from update sources.

Evolve, follow-up, and accept-time agent passes now consistently send only the credential selected by the active preset billing source. The chosen preset/auth source is recorded in the session event log so accept-time type-fix, auto-commit, and conflict-resolution runs can continue with the same credential instead of guessing from the model or preferring unrelated stored credentials.

Account Settings copy now matches the preset model: saved API keys and subscription credentials are presented as explicit billing sources for presets, not as a global credential priority chain. The onboarding tour script was updated with the same model so future guidance does not reintroduce credential ordering.

Added a built-in Pi + ChatGPT subscription preset and changed preset availability handling so presets stay visible on the settings page when their billing source is missing. Unavailable presets are grayed out with a "Billing source not configured" indicator, while the Evolve Advanced preset dropdown only lists usable presets and links to connect more providers before managing presets; built-in presets no longer show a redundant built-in pill, but custom presets still do.

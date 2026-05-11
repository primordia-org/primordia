# Add evolve preset picker

Replaced the Advanced harness/model controls in the evolve form with an available Preset picker. Presets bundle billing source, harness, model, and display name so users can switch common configurations by name instead of manually coordinating auth source and model selection.

Added built-in presets (including a secret-free exe.dev gateway default) plus `/settings/presets` for user-defined presets. Availability is based on stored user secrets for the preset billing source, while the exe.dev gateway is treated as secret-free unless explicitly disabled.

The preset editor now uses a three-stage Billing Source → Harness → Model flow. Billing source narrows the harness list, billing source plus harness narrows the model list, and the existing rich model picker is reused with preset-aware filtering.

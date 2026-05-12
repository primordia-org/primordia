# Add agent identity icons

Changed agent run headers from the old harness/model-only text plus trailing auth badge into a single identity line: auth source icon + auth source label / harness icon + harness label / model name.

Also reused those icons in evolve preset summaries and settings pages so billing sources and harnesses are visually consistent. Added local favicon assets for pi.dev, exe.dev, OpenRouter, and Anthropic so the UI does not depend on remote image loads.

Extended the preset editor so the Billing source and Harness fields use custom dropdowns with the same icons in both the selected value and option list. Claude.ai subscription and Claude Code now use the Claude logo, while the Anthropic API key source keeps the Anthropic "A" favicon.

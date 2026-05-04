# Show model pricing in evolve form

## What changed

The model selector in the evolve request form (Advanced section) now displays concise pricing information alongside each model name, making it easy to compare cost before picking a model.

- Each `<option>` in the Model dropdown shows the model name followed by the input token price in parentheses, e.g. `Claude Sonnet 4.6 ($3/M)`.
- A small hint line below the dropdown shows the full description for the selected model (provider, reasoning flag, and price), e.g. `Anthropic · $3→$15/M`.
- Pricing is formatted compactly: sub-dollar amounts use cents notation (`80¢`), dollar amounts strip unnecessary decimals (`$3`, `$2.5`).

## Why

Previously the model list showed only names, giving no signal about relative cost. Adding pricing lets users make informed trade-offs between quality and spend without leaving the form.

## How

- `lib/pi-model-registry.server.ts`: added a `formatPricing()` helper that formats the `cost.input`/`cost.output` fields (USD per million tokens) from the pi ModelRegistry into a human-readable string. The description field on each `ModelOption` now includes the pricing tag.
- `lib/agent-config.ts`: added an optional `pricingLabel` field to the `ModelOption` interface.
- `components/EvolveRequestForm.tsx`: updated the model `<option>` elements to append the pricing label to the display text, and added a hint paragraph below the select showing the full description for the selected model.

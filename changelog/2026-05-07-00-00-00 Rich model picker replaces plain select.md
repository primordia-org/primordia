# Rich model picker replaces plain select

## What changed

Replaced the plain `<select>` for model selection in the Advanced panel of `EvolveRequestForm` with a new `ModelPicker` component (`components/ModelPicker.tsx`).

### ModelPicker features

- **Trigger button** — shows a provider icon + model name + price label + chevron. Clicking opens the dropdown.
- **Search** — a search bar at the top filters models across all providers by name, id, or description.
- **Provider sidebar** — on desktop, a left-column list of provider tabs (icon + name); on mobile, a horizontally-scrollable row of tabs above the model list. Clicking a tab filters the list to that provider.
- **Model rows** — each row shows: provider icon (when searching or single-provider), model name, price label, description, and a checkmark on the selected model.
- **Provider icons** — SVG-based icons for Anthropic (asterisk glyph) and Google (Google G) and OpenAI (OpenAI logo); text-initial badges for all other providers (xAI, Mistral, Meta, Qwen, DeepSeek, and ~30 more OpenRouter providers).
- **Keyboard / UX** — Escape clears search first, then closes the dropdown. Outside-click closes the dropdown. The selected model scrolls into view on open.
- **Responsive** — provider tabs move from a vertical left sidebar to a horizontal scroll row on small screens, matching the mobile mockup.

## Why

The old plain `<select>` was unwieldy for 157+ models across 33+ providers. The new component lets users browse by provider or search, matches the visual style shown in the design mockups, and fits Primordia's dark Tailwind aesthetic.

## Files changed

- `components/ModelPicker.tsx` — new component (created)
- `components/EvolveRequestForm.tsx` — import + use `ModelPicker` in place of the model `<select>`

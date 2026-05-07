# Rich model picker replaces plain select

## What changed

Replaced the plain `<select>` for model selection in the Advanced panel of `EvolveRequestForm` with a new `ModelPicker` component (`components/ModelPicker.tsx`).

### ModelPicker features

- **Trigger button** — shows a provider icon + model name + price label + chevron. Clicking opens the dropdown.
- **Search** — a search bar at the top filters models across all providers by name, id, or description.
- **Provider sidebar** — on desktop, a left-column list of provider tabs (icon + name); on mobile, a horizontally-scrollable row of tabs above the model list. Clicking a tab filters the list to that provider.
- **Model rows** — each row shows: provider icon (when searching or single-provider), model name, description (which includes pricing), and a checkmark on the selected model. Price is not duplicated — it appears once in the description line, and also in the trigger button.
- **Provider icons** — SVG-based icons for Anthropic (asterisk glyph) and Google (Google G) and OpenAI (OpenAI logo); text-initial badges for all other providers (xAI, Mistral, Meta, Qwen, DeepSeek, and ~30 more OpenRouter providers).
- **Keyboard / UX** — Escape clears search first, then closes the dropdown. Outside-click closes the dropdown. The selected model scrolls into view on open.
- **Responsive** — on desktop (sm+), a popover dropdown with a left vertical provider sidebar; on mobile, a full-width bottom sheet with a drag handle, a dark backdrop, and a horizontal provider scroll row above the model list.

## Why

The old plain `<select>` was unwieldy for 157+ models across 33+ providers. The new component lets users browse by provider or search, matches the visual style shown in the design mockups, and fits Primordia's dark Tailwind aesthetic.

Follow-up fixes:
- **Model rows only visible when searching** — caused by mobile provider tabs being placed as a flex sibling inside the horizontal body div, collapsing the model list. Fixed by rendering tabs in a column above the list.
- **Mobile bottom sheet** — now a fixed full-width sheet at the bottom of the viewport with backdrop, instead of an absolute dropdown.
- **Price shown twice** — removed the redundant `inputPriceLabel` badge from model rows; pricing is already visible in the description line (e.g. "OpenRouter · reasoning · $3→$15/M").
- **Model list curated from 157 → 35** — the original auto-generated list included 147 OpenRouter models, many of which are audio, image, creative writing, or general-purpose (not coding-focused), plus duplicates of native Anthropic/OpenAI models. Replaced with a hand-curated allowlist of 25 coding-appropriate OpenRouter models (Google Gemini, DeepSeek, Mistral Codestral/Devstral, xAI Grok Code, Meta Llama 4, Qwen3 Coder, Kimi K2, Mercury Coder, etc.) alongside the 10 native Anthropic/OpenAI models. Note: Baidu CoBuddy is not yet in the pi model registry and is not currently available.

## Files changed

- `components/ModelPicker.tsx` — new component (created)
- `components/EvolveRequestForm.tsx` — import + use `ModelPicker` in place of the model `<select>`
- `lib/models.generated.json` — curated from 157 to 35 coding-focused models

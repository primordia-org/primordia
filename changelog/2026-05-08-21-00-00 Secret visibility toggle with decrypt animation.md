# Secret visibility toggle with decrypt animation

## What changed

- **API keys (`/settings`)**: Stored keys now display as scrambled cipher text (random characters matching the key's length) instead of dots. A key icon replaces the eye icon; clicking it runs a decrypt animation that progressively reveals the real value character by character. Clicking again (EyeOff) re-scrambles. When no key is stored yet, the standard password input + Eye/EyeOff toggle is used.

- **Claude.ai credentials (`/settings/claude-ai`)**: Removed the separate `<pre>` display block and the collapsible "Paste credentials manually" section. Replaced both with a single unified textarea that:
  - Shows scrambled cipher text when credentials are stored and locked
  - Animates to the real value via the decrypt effect when the Key icon is clicked
  - Becomes editable after reveal (or when no credentials are stored), enabling paste/edit + Save in one area

- **`lib/use-decrypt-effect.ts`** (new): Reusable `useDecryptEffect` hook and `generateScramble` helper used by both settings components. The animation shuffles unrevealed characters randomly every 30ms while progressively revealing them in random order over the configured duration.

## Why

The previous approach showed stored keys as dots or as plain text after a simple toggle — unremarkable and not reflective of the fact that the values are encrypted at rest. The cipher-text display and animated reveal make the encryption tangible and look significantly more polished.

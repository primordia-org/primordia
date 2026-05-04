# Add fun UI sound effects

## What changed

Added synthesised sound effects to key UI interactions throughout the app. All sounds are generated procedurally via the Web Audio API — no audio files, no network requests, no external libraries.

### New file: `lib/sounds.ts`

- `useSounds()` React hook that returns a stable object of named play functions.
- Every sound is created with a fresh `AudioContext` that is immediately closed after playback, so there is no long-lived audio object to manage or clean up.
- Gracefully degrades: any error inside a sound function is silently caught so a broken audio environment can never crash the UI.
- Available sounds:

| Name | Triggered by | Character |
|---|---|---|
| `send` | User sends a chat message | Short upward triangle sweep + noise click |
| `receive` | AI streaming response completes | Pleasant two-note chime (C5 → E5) |
| `error` | API / network error | Descending sawtooth buzz |
| `menuOpen` | Hamburger menu opens | Soft pop + upward sine tick |
| `menuClose` | Hamburger menu closes | Downward sine tick + noise click |
| `sparkle` | Evolve session submitted / dialog opened | Three ascending sine sparkle tones |
| `accept` | Evolve session accepted ✅ | Cheerful C–E–G–C major arpeggio |
| `reject` | Evolve session rejected 🗑️ | Descending minor-third triangle tones |
| `click` | Generic button click | Short noise burst |
| `pop` | Generic notification pop | Brief sine blip |

### Wired into existing components

- **`app/chat/ChatInterface.tsx`** — `send` on form submit, `receive` when the SSE stream finishes with `[DONE]`, `error` on fetch error.
- **`components/HamburgerMenu.tsx`** — `menuOpen` / `menuClose` on toggle.
- **`app/evolve/session/[id]/EvolveSessionView.tsx`** — `sparkle` when accept pipeline starts, `accept` on successful accept, `reject` on reject, `error` on accept/reject API errors.
- **`components/EvolveRequestForm.tsx`** — `sparkle` when a new session is created, `error` on submission failure.

### New page: `app/sound-test/page.tsx`

Interactive soundboard at `/sound-test` — a grid of buttons, one per sound, each labelled with its name, `useSounds()` call, emoji, and a brief description of when it fires. Useful for auditioning or tweaking sounds without needing to trigger the actual UI events.

## Why

Sound feedback makes the interface feel alive and responsive without adding complexity. Using the Web Audio API keeps the bundle lean — there is nothing to download or cache.

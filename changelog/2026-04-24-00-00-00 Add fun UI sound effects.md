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

Interactive soundboard at `/sound-test` with full audio diagnostics:

- **Diagnostics panel** — shows `AudioContext` browser support, the state it starts in (`running` vs `suspended`), simplified browser/OS string, and any initialisation error.
- **Live oscilloscope** — canvas-based waveform visualiser fed by a persistent shared `AudioContext` with an `AnalyserNode`. Turns green/cyan as audio level rises.
- **Test Tone button** — plays an A-major arpeggio routed through the oscilloscope context, proving the audio pipeline end-to-end independent of the sound buttons. If the waveform moves but no sound is heard, the issue is system/tab volume, not the Web Audio API.
- **Sound buttons** — each button calls the raw (unwrapped) play function so errors are shown inline rather than silently swallowed, making it easy to see exactly what failed and why.

### Bug fix: `lib/sounds.ts` — Safari suspended AudioContext

`getCtx()` now calls `ctx.resume()` when a newly created `AudioContext` starts in the `'suspended'` state. Safari sometimes suspends new contexts even during a user-gesture handler; without this fix those browsers produce no sound at all.

### Export: `RAW_SOUND_MAP`

The internal `SOUND_MAP` is now exported as `RAW_SOUND_MAP` for use by the diagnostic page. The `useSounds()` public API is unchanged.

## Why

Sound feedback makes the interface feel alive and responsive without adding complexity. Using the Web Audio API keeps the bundle lean — there is nothing to download or cache.

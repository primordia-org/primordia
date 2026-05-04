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

### Bug fix: `lib/sounds.ts` — silent audio on Firefox Android / Safari

**Root cause:** the original design created a fresh `AudioContext` per sound and immediately called `ctx.close()`. On Firefox for Android (and some Safari versions) new `AudioContext` instances start in the `'suspended'` state even inside a user-gesture handler. The previous `void ctx.resume()` attempt was cancelled by the synchronous `ctx.close()` call that followed — so every sound was silently discarded with no error thrown.

**Fix:** `lib/sounds.ts` now uses a single **persistent module-level `AudioContext`** that is created on first use and never closed. All play functions are now `async` and `await ctx.resume()` before scheduling any nodes, ensuring the context is actually running before any audio is queued. The `useSounds()` public API is unchanged — each method still returns `() => void`; the async play functions are fired with `void fn().catch(...)` internally.

### Bug fix: onset/offset pops and "click" silence

Three related timing bugs:

1. **Click silent / pop varying in loudness** — `tone()` and `noiseClick()` scheduled events at `ctx.currentTime + 0`. The audio rendering thread runs 1–12 ms *ahead* of the JS thread (one render quantum). Events scheduled at `ctx.currentTime` land in a block the audio thread has already processed and are silently dropped, or the gain envelope is evaluated at its end value (0.0001) making the sound inaudible. Fixed by adding a **60 ms `LOOKAHEAD`** constant applied inside both helpers, so all audio is always scheduled in the future. 60 ms is below the ~100 ms threshold of perceptible delay while providing a comfortable margin above any realistic render-quantum size.

2. **Onset pop on noise click** — `noiseClick()` jumped the `GainNode` instantaneously from 0 to full amplitude (`setValueAtTime`), creating a waveform discontinuity = audible pop. Fixed with a 3 ms linear ramp-up from 0 instead.

3. **Short attack pops on tones** — default tone attack increased from 5 ms to 10 ms, giving non-zero-phase oscillators time to ramp up smoothly. `noiseClick` buffer duration extended from 20 ms to 30 ms and filter lowered from 800 Hz to 400 Hz for better audibility.

### Export: `RAW_SOUND_MAP`

Exports `Record<SoundName, () => Promise<void>>` for the diagnostic page, which `await`s each call to surface real errors instead of swallowing them.

## Why

Sound feedback makes the interface feel alive and responsive without adding complexity. Using the Web Audio API keeps the bundle lean — there is nothing to download or cache.

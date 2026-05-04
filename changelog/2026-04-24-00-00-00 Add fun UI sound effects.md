# Add fun UI sound effects

## What changed

Added synthesised sound effects to key UI interactions throughout the app. All sounds are generated procedurally via the Web Audio API - no audio files, no network requests, no external libraries.

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
| `accept` | Evolve session accepted ✅ | Cheerful C-E-G-C major arpeggio |
| `agentDone` | Agent finished, session ready | A-C♯-E-A (A major) arpeggio, 350 ms decay |
| `deploy` | Branch deployed to production | "Ta Daaaa!": punchy C5+G5 accent then blooming 4-octave C major chord |
| `merge` | Dev branch merged | Two converging tones (E5→C5, G4→C5) + C major resolution chord |
| `reject` | Evolve session rejected 🗑️ | Descending minor-third triangle tones |
| `click` | Generic button click | Blue-noise bandpass at 1 kHz - crisp "tick" |
| `pop` | Generic notification pop | Brief sine blip |

### Wired into existing components

- **`app/chat/ChatInterface.tsx`** - `send` on form submit, `receive` when the SSE stream finishes with `[DONE]`, `error` on fetch error.
- **`components/HamburgerMenu.tsx`** - `menuOpen` / `menuClose` on toggle.
- **`app/evolve/session/[id]/EvolveSessionView.tsx`** - `sparkle` when accept pipeline starts; `deploy` (production) or `merge` (dev) when `status` transitions to `accepted`; `agentDone` when `status` transitions from a running state to `ready`; `reject` on reject; `error` on accept/reject API errors. All status-change sounds are centralised in a single `useEffect` with a `prevStatusRef` guard to prevent duplicates.
- **`components/EvolveRequestForm.tsx`** - `sparkle` when a new session is created, `error` on submission failure.

### New page: `app/sound-test/page.tsx`

Interactive soundboard at `/sound-test` — oscilloscope now taps the `lib/sounds.ts` singleton (`setSharedAnalyser` / `initAndGetSharedCtx`), so every sound button animates the waveform. The separate test-tone context was removed. Diagnostics include:

- **Full audio diagnostics:**

- **Diagnostics panel** - shows `AudioContext` browser support, the state it starts in (`running` vs `suspended`), simplified browser/OS string, and any initialisation error.
- **Live oscilloscope** - canvas-based waveform visualiser fed by a persistent shared `AudioContext` with an `AnalyserNode`. Turns green/cyan as audio level rises.
- **Test Tone button** - plays an A-major arpeggio routed through the oscilloscope context, proving the audio pipeline end-to-end independent of the sound buttons. If the waveform moves but no sound is heard, the issue is system/tab volume, not the Web Audio API.
- **Sound buttons** - each button calls the raw (unwrapped) play function so errors are shown inline rather than silently swallowed, making it easy to see exactly what failed and why.

### `noiseClick` upgraded to blue noise

`noiseClick()` (used as a secondary accent in `send`, `menuOpen`, `menuClose`) previously used white noise. It now uses the same first-order-difference blue-noise generation as `blueNoiseClick()`, via a shared `makeBlueNoiseBuf()` helper. This gives the noise accents a brighter, crisper character consistent with the standalone `click` sound.

### Oscilloscope taps the sounds singleton

`lib/sounds.ts` now exports `setSharedAnalyser(an)` and `initAndGetSharedCtx()`. When the `/sound-test` page calls `setSharedAnalyser`, every subsequent `tone()` and `noiseClick()` call routes its `GainNode` through the `AnalyserNode` instead of directly to `ctx.destination`. The analyser is connected to `ctx.destination`, so the signal still reaches the hardware output. This means every sound button on the test page animates the oscilloscope — not just a dedicated test tone.

### Bug fix: `lib/sounds.ts` — silent audio on Firefox Android / Safari

**Root cause:** the original design created a fresh `AudioContext` per sound and immediately called `ctx.close()`. On Firefox for Android (and some Safari versions) new `AudioContext` instances start in the `'suspended'` state even inside a user-gesture handler. The previous `void ctx.resume()` attempt was cancelled by the synchronous `ctx.close()` call that followed - so every sound was silently discarded with no error thrown.

### New sounds: `deploy` (fanfare) and `merge`

**`deploy`** — "Ta Daaaa!" fanfare triggered when a branch is deployed to production. A short, punchy C5+G5 open-fifth accent ("Ta!") at 0 ms with a snare-style noise burst, followed 220 ms later by a full four-octave C major chord (C4–G4–C5–E5–G5–C6) with a cymbal crash ("Daaaa!"). The six chord voices enter with a 0–50 ms stagger — like real brass players — so the chord blooms open rather than hitting as a flat wall of sound. Total duration ~1.0 s.

**`merge`** - Subtle resolution triggered when a development branch is merged. Two sine voices sweep from opposite directions and converge on C5 (E5→C5 and G4→C5), then a C major chord settles. The convergence metaphor directly mirrors two branches meeting. Total duration ~0.5 s.

Both are wired in `EvolveSessionView` via the centralised `prevStatusRef` `useEffect`: when `status` becomes `accepted`, `isProduction` determines which plays.

### Redesign: `click` sound - blue-noise bandpass

The sine pluck was too similar to `pop`. Replaced with blue noise (first-order differentiated white noise, which naturally emphasises high frequencies) filtered through a bandpass at 1 kHz (Q = 1.8). The result is a crisp, defined "tick" that is brighter than pink noise and less harsh than white-noise highpass.

### New sound: `agentDone`

A major arpeggio: A4-C♯5-E5-A5, gain 0.18, 350 ms decay per note, 100 ms note spacing - the same progression as the `/sound-test` oscilloscope test tone. Wired into `EvolveSessionView` via a `useEffect` that watches `status` and fires whenever the session transitions from `running-claude`, `starting`, or `fixing-types` into `ready`.

**Fix:** `lib/sounds.ts` now uses a single **persistent module-level `AudioContext`** that is created on first use and never closed. All play functions are now `async` and `await ctx.resume()` before scheduling any nodes, ensuring the context is actually running before any audio is queued. The `useSounds()` public API is unchanged - each method still returns `() => void`; the async play functions are fired with `void fn().catch(...)` internally.

### Bug fix: onset/offset pops and "click" silence

Three related timing bugs:

1. **Click silent / pop varying in loudness** - `tone()` and `noiseClick()` scheduled events at `ctx.currentTime + 0`. The audio rendering thread runs 1-12 ms *ahead* of the JS thread (one render quantum). Events scheduled at `ctx.currentTime` land in a block the audio thread has already processed and are silently dropped, or the gain envelope is evaluated at its end value (0.0001) making the sound inaudible. Fixed by adding a **60 ms `LOOKAHEAD`** constant applied inside both helpers, so all audio is always scheduled in the future. 60 ms is below the ~100 ms threshold of perceptible delay while providing a comfortable margin above any realistic render-quantum size.

2. **Onset pop on noise click** - `noiseClick()` jumped the `GainNode` instantaneously from 0 to full amplitude (`setValueAtTime`), creating a waveform discontinuity = audible pop. Fixed with a 3 ms linear ramp-up from 0 instead.

3. **Short attack pops on tones** - default tone attack increased from 5 ms to 10 ms, giving non-zero-phase oscillators time to ramp up smoothly. `noiseClick` buffer duration extended from 20 ms to 30 ms and filter lowered from 800 Hz to 400 Hz for better audibility.

### Export: `RAW_SOUND_MAP`

Exports `Record<SoundName, () => Promise<void>>` for the diagnostic page, which `await`s each call to surface real errors instead of swallowing them.

## Why

Sound feedback makes the interface feel alive and responsive without adding complexity. Using the Web Audio API keeps the bundle lean - there is nothing to download or cache.

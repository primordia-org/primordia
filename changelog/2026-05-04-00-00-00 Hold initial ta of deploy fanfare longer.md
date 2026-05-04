# Hold initial "ta" of deploy fanfare longer

## What changed

In `lib/sounds.ts`, the `playDeploy` function's initial "Taaaa" notes (C5 + G5 open fifth at t=0) had their `decay` parameter increased from `0.05 s` (50 ms) to `0.20 s` (200 ms).

## Why

The 50 ms decay caused the opening note to snap off abruptly immediately after its ~355 ms sustain, making the "Taaaa" feel clipped rather than held. A 200 ms decay gives the note a natural, gradual tail that lets it breathe before the "ta" and final "Daaaa!" chord bloom.

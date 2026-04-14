# Widen curl box so text isn't cut off

## What changed

Increased the max-width of both curl command boxes on the landing page:

- Hero section curl box: `max-w-xl` → `max-w-2xl` (36rem → 42rem)
- Bottom "Ready to deploy?" section curl box: `max-w-lg` → `max-w-2xl` (32rem → 42rem)

## Why

The full curl command (`curl -fsSL https://primordia.exe.xyz/install-for-exe-dev.sh | bash`) was being truncated with `…` because the container wasn't wide enough. Making both boxes a smidge bigger gives the text enough room to display without clipping.

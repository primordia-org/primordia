"use client";

// app/sound-test/page.tsx
// Interactive soundboard for demoing all synthesised UI sound effects.
// Each button plays one sound on click — no other side effects.

import { useSounds, type SoundName } from "@/lib/sounds";

// ─── Sound catalogue ──────────────────────────────────────────────────────────

interface SoundEntry {
  name: SoundName;
  emoji: string;
  label: string;
  description: string;
}

const SOUNDS: SoundEntry[] = [
  {
    name: "send",
    emoji: "📤",
    label: "Send",
    description: "Upward triangle sweep + noise click. Plays when a user sends a message.",
  },
  {
    name: "receive",
    emoji: "📥",
    label: "Receive",
    description: "Pleasant two-note chime (C5 → E5). Plays when an AI response finishes.",
  },
  {
    name: "error",
    emoji: "❌",
    label: "Error",
    description: "Descending sawtooth buzz. Plays on API or network errors.",
  },
  {
    name: "menuOpen",
    emoji: "☰",
    label: "Menu Open",
    description: "Soft pop + upward sine tick. Plays when the hamburger menu opens.",
  },
  {
    name: "menuClose",
    emoji: "✕",
    label: "Menu Close",
    description: "Downward sine tick + noise click. Plays when the hamburger menu closes.",
  },
  {
    name: "sparkle",
    emoji: "✨",
    label: "Sparkle",
    description: "Three ascending sparkle tones. Plays when an evolve session is submitted.",
  },
  {
    name: "accept",
    emoji: "✅",
    label: "Accept",
    description: "Cheerful C–E–G–C major arpeggio. Plays when a session is accepted.",
  },
  {
    name: "reject",
    emoji: "🗑️",
    label: "Reject",
    description: "Descending minor-third tones. Plays when a session is rejected.",
  },
  {
    name: "click",
    emoji: "👆",
    label: "Click",
    description: "Short noise burst. Generic button click feedback.",
  },
  {
    name: "pop",
    emoji: "🔔",
    label: "Pop",
    description: "Brief sine blip. Generic notification or pop feedback.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SoundTestPage() {
  const sounds = useSounds();

  return (
    <main className="min-h-dvh bg-gray-950 text-gray-100 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-1">🔊 Sound Effects</h1>
        <p className="text-gray-400 text-sm mb-8">
          All sounds are synthesised via the Web Audio API — no audio files. Click any
          button to hear it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOUNDS.map(({ name, emoji, label, description }) => (
            <button
              key={name}
              type="button"
              onClick={() => sounds[name]()}
              className="text-left flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-700 hover:border-gray-500 hover:bg-gray-800 active:scale-[0.97] transition-all duration-100 group"
            >
              <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{emoji}</span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-sm text-white group-hover:text-white/90">
                  {label}
                  <code className="ml-2 text-xs font-mono text-gray-500 group-hover:text-gray-400">
                    sounds.{name}()
                  </code>
                </span>
                <span className="text-xs text-gray-500 group-hover:text-gray-400 leading-snug">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-8 text-xs text-gray-600">
          Source: <code className="font-mono">lib/sounds.ts</code> · hook:{" "}
          <code className="font-mono">useSounds()</code>
        </p>
      </div>
    </main>
  );
}

"use client";

// components/ModeToggle.tsx
// A simple two-state toggle that switches between "chat" mode and "evolve" mode.
// Rendered in the top-right corner of the chat interface.

type Mode = "chat" | "evolve";

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export default function ModeToggle({ mode, onModeChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Interaction mode"
      className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1"
    >
      <ModeButton
        active={mode === "chat"}
        onClick={() => onModeChange("chat")}
        label="Chat"
        description="Talk to Primordia"
        activeClass="bg-blue-600 text-white"
      />
      <ModeButton
        active={mode === "evolve"}
        onClick={() => onModeChange("evolve")}
        label="Evolve"
        description="Propose a change to this app"
        activeClass="bg-amber-600 text-white"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  description,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? activeClass : "text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

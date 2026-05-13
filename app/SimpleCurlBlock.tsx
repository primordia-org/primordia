"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function SimpleCurlBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-gray-900/80 backdrop-blur px-4 py-3">
      <span className="select-none text-gray-600 font-mono text-sm shrink-0">$</span>
      <code className="flex-1 font-mono text-sm text-green-400 truncate text-left">{command}</code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy command"
        className="shrink-0 p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
      >
        {copied ? (
          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

"use client";

import { useState, useRef, useLayoutEffect, useCallback } from "react";
import { Check, Copy } from "lucide-react";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
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
  );
}

// Measures pixel width of a string in a monospace font via a hidden canvas.
function measureText(text: string, font: string): number {
  if (typeof document === "undefined") return 0;
  const canvas =
    (measureText as { _canvas?: HTMLCanvasElement })._canvas ??
    ((measureText as { _canvas?: HTMLCanvasElement })._canvas =
      document.createElement("canvas"));
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

export default function InstallBlock({ setupUrl, defaultName }: { setupUrl: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [caretPx, setCaretPx] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [endPx, setEndPx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fontRef = useRef<string>("");
  useLayoutEffect(() => {
    if (inputRef.current && !fontRef.current) {
      const s = window.getComputedStyle(inputRef.current);
      fontRef.current = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      setEndPx(measureText(name, fontRef.current));
    }
  }, []);

  const measureEnd = useCallback((value: string) => {
    if (!fontRef.current) return null;
    return measureText(value, fontRef.current);
  }, []);

  const updateCaret = useCallback(() => {
    const el = inputRef.current;
    if (!el || !fontRef.current) return;
    const pos = el.selectionStart ?? el.value.length;
    const px = measureText(el.value.slice(0, pos), fontRef.current);
    setCaretPx(px);
    setEndPx(measureText(el.value, fontRef.current));
  }, []);

  const sshCmd = `ssh exe.dev new --name=${name}`;
  const curlCmd = `curl -fsSL ${setupUrl} | ssh ${name}.exe.xyz 'bash -s'`;

  return (
    <div className="rounded-xl border border-white/10 bg-gray-900/80 backdrop-blur overflow-hidden">
      {/* Line 1 — editable name inline in the ssh command */}
      <div
        className="flex items-center px-4 py-3 gap-3 border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <span className="select-none text-gray-600 font-mono text-sm shrink-0">$</span>
        <div className="flex-1 font-mono text-sm text-green-400 text-left flex items-center min-w-0 overflow-hidden">
          <span className="shrink-0 select-none">ssh exe.dev new --name=</span>
          <span className="relative inline-flex items-center">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                const val = e.target.value.replace(/\s/g, "-");
                setName(val);
                requestAnimationFrame(updateCaret);
              }}
              onSelect={updateCaret}
              onFocus={() => { setFocused(true); requestAnimationFrame(updateCaret); }}
              onBlur={(e) => {
                setFocused(false);
                const el = e.currentTarget;
                requestAnimationFrame(() => {
                  el.setSelectionRange(el.value.length, el.value.length);
                });
                setEndPx(measureEnd(e.currentTarget.value));
              }}
              onKeyUp={updateCaret}
              onMouseUp={updateCaret}
              spellCheck={false}
              autoComplete="off"
              aria-label="VM name"
              className="bg-transparent outline-none text-green-400 font-mono text-sm caret-transparent selection:bg-green-400/30 min-w-[1ch]"
              style={{ width: `${Math.max(name.length, 1)}ch` }}
            />
            {/* Block cursor — tracks real caret when focused, sits at end when idle */}
            {(focused ? caretPx : endPx) !== null && (
              <span
                aria-hidden="true"
                className="absolute top-0 bottom-0 w-[0.55em] bg-green-400 animate-blink pointer-events-none"
                style={{ left: focused ? caretPx! : endPx! }}
              />
            )}
          </span>
        </div>
        <CopyBtn text={sshCmd} />
      </div>

      {/* Line 2 — curl command, auto-synced with name */}
      <div className="flex items-center px-4 py-3 gap-3 hover:bg-white/[0.03] transition-colors">
        <span className="select-none text-gray-600 font-mono text-sm shrink-0">$</span>
        <code className="flex-1 font-mono text-sm text-green-400 truncate text-left">{curlCmd}</code>
        <CopyBtn text={curlCmd} />
      </div>
    </div>
  );
}

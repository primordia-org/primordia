"use client";

import { useState, useRef, useCallback } from "react";
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

export default function InstallBlock({ setupUrl, defaultName }: { setupUrl: string; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  // caretPos is the character index of the caret (selectionEnd). null = unfocused.
  const [caretPos, setCaretPos] = useState<number | null>(null);
  const [focusCount, setFocusCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mouseDownRef = useRef(false);

  const updateCaret = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    setCaretPos(el.selectionEnd ?? el.value.length);
  }, []);

  const focused = caretPos !== null;
  // CSS custom property: how many ch to shift the ::after cursor left from the right edge of the input.
  // At end of word: 0. At beginning: name.length ch.
  const charsFromEnd = caretPos !== null ? Math.max(name.length, 1) - caretPos : 0;

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
          <span
            className={`install-cursor relative inline-flex items-center${focused ? " is-focused" : ""}`}
            style={{ "--caret-offset": `${charsFromEnd}ch` } as React.CSSProperties}
          >
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                const val = e.target.value.replace(/\s/g, "-");
                setName(val);
                requestAnimationFrame(updateCaret);
              }}
              onSelect={updateCaret}
              onMouseDown={() => { mouseDownRef.current = true; }}
              onFocus={(e) => {
                setFocusCount(n => n + 1);
                if (!mouseDownRef.current) {
                  // Keyboard/tab focus — move caret to end
                  const el = e.currentTarget;
                  el.setSelectionRange(el.value.length, el.value.length);
                }
                mouseDownRef.current = false;
                requestAnimationFrame(updateCaret);
              }}
              onBlur={() => { setCaretPos(null); }}
              onKeyUp={updateCaret}
              onMouseUp={updateCaret}
              spellCheck={false}
              autoComplete="off"
              aria-label="VM name"
              className="bg-transparent outline-none text-green-400 font-mono text-sm caret-transparent selection:bg-green-400/30 min-w-[1ch]"
              style={{ width: `${Math.max(name.length, 1)}ch` }}
            />
            {/* JS-positioned block cursor — remounts on each focus to restart blink animation */}
            {focused && (
              <span
                key={focusCount}
                aria-hidden="true"
                className="install-cursor-js animate-blink"
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

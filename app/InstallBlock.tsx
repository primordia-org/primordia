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

export default function InstallBlock({ installUrl, defaultName, installBranch }: { installUrl: string; defaultName: string; installBranch?: string | null }) {
  const [name, setName] = useState(defaultName);
  // caretPos: character index (selectionEnd). null = unfocused.
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
  const displayLen = Math.max(name.length, 1);
  // Cursor is "past end" when at or beyond the last character index.
  const atEnd = caretPos !== null && caretPos >= name.length;

  const sshCmd = `ssh exe.dev new --name=${name}`;
  const curlCmd = `curl -fsSL ${installUrl} | ssh ${name}.exe.xyz 'bash -s${installBranch ? ` ${installBranch}` : ""}'`;

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

          {/* Wrapper: input is invisible when focused so display spans show instead */}
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
              onMouseDown={() => { mouseDownRef.current = true; }}
              onFocus={(e) => {
                setFocusCount(n => n + 1);
                if (!mouseDownRef.current) {
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
              className={`bg-transparent outline-none font-mono text-sm caret-transparent selection:bg-green-400/30 min-w-[1ch] ${focused ? "text-transparent" : "text-green-400"}`}
              style={{ width: `${displayLen}ch` }}
            />

            {focused && (
              <>
                {/* Normal text layer: green text, transparent bg, clipped to exclude cursor char */}
                <span
                  key={`text-${focusCount}`}
                  aria-hidden="true"
                  className="absolute inset-0 font-mono text-sm text-green-400 pointer-events-none overflow-hidden whitespace-pre"
                  style={atEnd ? undefined : {
                    clipPath: `inset(0 ${(name.length - caretPos!) * 1}ch 0 0) padding-box, inset(0 0 0 ${(caretPos! + 1) * 1}ch) padding-box`,
                  }}
                >
                  {name || " "}
                </span>

                {/* Inverted layer: green bg, dark text, clipped to cursor char only */}
                <span
                  key={`inv-${focusCount}`}
                  aria-hidden="true"
                  className="absolute inset-0 font-mono text-sm pointer-events-none overflow-hidden whitespace-pre animate-blink"
                  style={atEnd ? { clipPath: "inset(0 0 0 100%)" } : {
                    clipPath: `inset(0 ${(name.length - caretPos! - 1) * 1}ch 0 ${caretPos! * 1}ch)`,
                    color: "rgb(17 24 39)", /* gray-900 to match bg */
                    background: "#4ade80",
                  }}
                >
                  {name || " "}
                </span>

                {/* Block cursor shown only when caret is past last char */}
                {atEnd && (
                  <span
                    key={`end-${focusCount}`}
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 animate-blink pointer-events-none"
                    style={{ left: `${name.length}ch`, width: "0.55em", background: "#4ade80" }}
                  />
                )}
              </>
            )}

            {/* Unfocused CSS-only cursor at end of word */}
            {!focused && (
              <span
                aria-hidden="true"
                className="install-cursor-unfocused absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${displayLen}ch` }}
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

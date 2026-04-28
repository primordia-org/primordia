"use client";

// components/AnsiRenderer.tsx
// Renders text containing ANSI escape codes as styled React elements.
//
// Handles the subset of ANSI codes emitted by scripts/install.sh:
//   SGR sequences  \033[...m  — color (31-36), bold (1), dim (2), reset (0)
//   Erase to EOL   \033[K     — overwrite line from cursor onward
//   Carriage ret   \r         — go to start of current line (spinner overwrite)
//   Newline        \n         — advance to next line
//
// The virtual-terminal model processes \r and \033[K sequences so that spinner
// animation writes (which repeatedly overwrite the same line) reduce to their
// final rendered state. For the last incomplete line while still streaming,
// a CSS spinner replaces the leading spinner character (\ | / -).

import { useState, useEffect, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnsiColor = "default" | "green" | "cyan" | "yellow" | "red";

interface AnsiStyle {
  color: AnsiColor;
  bold: boolean;
  dim: boolean;
}

interface Span {
  text: string;
  style: AnsiStyle;
}

/** One logical terminal line after all \r / \033[K sequences are applied. */
export interface RenderedLine {
  spans: Span[];
  /** True when this line was followed by a \n (i.e. the line is finished). */
  complete: boolean;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const DEFAULT_STYLE: AnsiStyle = { color: "default", bold: false, dim: false };

/**
 * Parse a raw string (possibly containing ANSI escape sequences, \r, \n) into
 * an array of RenderedLine objects representing the final visual state of each
 * terminal line.
 */
export function parseAnsi(raw: string): RenderedLine[] {
  // Virtual terminal: array of per-character styled cells, one sub-array per line.
  type Cell = { char: string; style: AnsiStyle };
  const lines: Cell[][] = [[]];
  let lineIdx = 0;
  let colIdx = 0;
  let style: AnsiStyle = { ...DEFAULT_STYLE };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    if (ch === "\r") {
      // Carriage return: go to start of the current line.
      colIdx = 0;
      i++;
    } else if (ch === "\n") {
      // Newline: move to the next line.
      lineIdx++;
      colIdx = 0;
      if (lineIdx >= lines.length) lines.push([]);
      i++;
    } else if (ch === "\x1b" && raw[i + 1] === "[") {
      // CSI sequence: \x1b[ <params> <final-byte>
      let j = i + 2;
      while (j < raw.length && !/[A-Za-z]/.test(raw[j])) j++;
      if (j >= raw.length) {
        i++;
        continue;
      }
      const params = raw.slice(i + 2, j);
      const cmd = raw[j];

      if (cmd === "m") {
        // SGR — Select Graphic Rendition
        const codes = params === "" ? [0] : params.split(";").map(Number);
        for (const code of codes) {
          if (code === 0) {
            style = { ...DEFAULT_STYLE };
          } else if (code === 1) {
            style = { ...style, bold: true };
          } else if (code === 2) {
            style = { ...style, dim: true };
          } else if (code === 31) {
            style = { ...style, color: "red" };
          } else if (code === 32) {
            style = { ...style, color: "green" };
          } else if (code === 33) {
            style = { ...style, color: "yellow" };
          } else if (code === 36) {
            style = { ...style, color: "cyan" };
          }
          // Ignore all other SGR codes (background colours, etc.)
        }
      } else if (cmd === "K") {
        // Erase to end of line (EL). Param 0 or empty = cursor → end-of-line.
        if (params === "" || params === "0") {
          while (lineIdx >= lines.length) lines.push([]);
          lines[lineIdx] = lines[lineIdx].slice(0, colIdx);
        }
      }
      // All other CSI sequences (cursor movement etc.) are silently ignored.
      i = j + 1;
    } else if (ch === "\x1b") {
      // Other (non-CSI) escape sequence — skip the escape byte only.
      i++;
    } else {
      // Printable character: write into the virtual terminal at (lineIdx, colIdx).
      while (lineIdx >= lines.length) lines.push([]);
      const line = lines[lineIdx];
      // Extend line with spaces up to colIdx if needed.
      while (line.length < colIdx) {
        line.push({ char: " ", style: { ...DEFAULT_STYLE } });
      }
      const cell: Cell = { char: ch, style: { ...style } };
      if (colIdx < line.length) {
        line[colIdx] = cell;
      } else {
        line.push(cell);
      }
      colIdx++;
      i++;
    }
  }

  // Convert the virtual terminal cells into RenderedLine objects.
  // The last line is "complete" only if the raw string ended with \n.
  const endsWithNewline = raw.endsWith("\n");

  return lines.map((line, li) => {
    // Merge consecutive cells with the same style into text spans.
    const spans: Span[] = [];
    for (const cell of line) {
      const last = spans[spans.length - 1];
      const sameStyle =
        last &&
        last.style.color === cell.style.color &&
        last.style.bold === cell.style.bold &&
        last.style.dim === cell.style.dim;
      if (sameStyle && last) {
        last.text += cell.char;
      } else {
        spans.push({ text: cell.char, style: { ...cell.style } });
      }
    }
    const complete = li < lines.length - 1 || endsWithNewline;
    return { spans, complete };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The four characters the install.sh spinner cycles through. */
const SPINNER_CHARS = new Set(["\\", "|", "/", "-"]);

/** True when this is the last, incomplete line and it starts with a spinner char. */
function isSpinnerLine(line: RenderedLine, isLastLine: boolean): boolean {
  if (!isLastLine || line.complete) return false;
  const firstChar = line.spans[0]?.text.charAt(0) ?? "";
  return SPINNER_CHARS.has(firstChar);
}

function colorClass(color: AnsiColor): string {
  switch (color) {
    case "green":  return "text-green-400";
    case "cyan":   return "text-cyan-400";
    case "yellow": return "text-yellow-400";
    case "red":    return "text-red-400";
    default:       return "";
  }
}

function spanClassName(s: AnsiStyle): string | undefined {
  const parts: string[] = [];
  const cc = colorClass(s.color);
  if (cc) parts.push(cc);
  if (s.bold) parts.push("font-bold");
  if (s.dim) parts.push("opacity-50");
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpanEl({ span }: { span: Span }) {
  const cls = spanClassName(span.style);
  return cls ? <span className={cls}>{span.text}</span> : <>{span.text}</>;
}

/** Animated Braille-dot spinner shown for in-progress terminal lines. */
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function SpinnerDot() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length),
      80,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-gray-400" aria-hidden="true">
      {BRAILLE_FRAMES[frame]}
    </span>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface AnsiRendererProps {
  /**
   * Raw text that may contain ANSI escape codes, \r, \n.
   * Concatenate all log_line event contents in order — do not add separators.
   */
  text: string;
  /**
   * When true the stream is still live: the last incomplete line is treated as
   * a spinner line and its leading spinner character is replaced with an
   * animated Braille indicator.
   */
  isActive?: boolean;
  className?: string;
}

/**
 * Renders ANSI-escaped terminal output as coloured, styled React elements.
 *
 * Designed for the output of `scripts/install.sh REPORT_STYLE=ansi` but
 * handles any text that uses the SGR / carriage-return / erase-EOL subset.
 */
export function AnsiRenderer({ text, isActive = false, className }: AnsiRendererProps) {
  const lines = useMemo(() => parseAnsi(text), [text]);

  if (lines.length === 0) return null;

  return (
    <div className={`font-mono text-xs leading-5 ${className ?? ""}`}>
      {lines.map((line, li) => {
        const isLast = li === lines.length - 1;
        const isSpinner = isActive && isSpinnerLine(line, isLast);

        // Empty completed line → thin vertical spacer
        if (line.spans.length === 0 && line.complete) {
          return <div key={li} className="h-[0.4em]" />;
        }

        // Empty incomplete last line while streaming → lone spinner dot
        if (line.spans.length === 0 && !line.complete && isActive) {
          return (
            <div key={li} className="flex items-center gap-1">
              <SpinnerDot />
            </div>
          );
        }

        // Empty line (not streaming) → nothing
        if (line.spans.length === 0) {
          return <div key={li} className="h-[0.4em]" />;
        }

        return (
          <div key={li} className="flex items-center flex-wrap">
            {isSpinner ? (
              // Replace the leading spinner character with a live Braille dot,
              // then render the rest of the spans normally.
              <>
                <SpinnerDot />
                {line.spans.map((span, si) => {
                  if (si === 0) {
                    // Skip the first character (the spinner char `\ | / -`)
                    const rest = span.text.slice(1);
                    if (!rest) return null;
                    return <SpanEl key={si} span={{ ...span, text: rest }} />;
                  }
                  return <SpanEl key={si} span={span} />;
                })}
              </>
            ) : (
              line.spans.map((span, si) => <SpanEl key={si} span={span} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

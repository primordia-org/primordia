"use client";

// components/FloatingEvolveDialog.tsx
// A draggable, dockable floating dialog containing the evolve request form.
// Triggered by "Propose a change" in the hamburger menu so the user can keep
// the current page visible for reference while writing their request.
//
// Dragging: click-and-drag the title bar to freely position the dialog.
// Docking: four corner buttons in the title bar snap the dialog to a corner.

import { useState, useRef, useEffect, useLayoutEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type DockPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface DragOrigin {
  mouseX: number;
  mouseY: number;
  dialogX: number;
  dialogY: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FloatingEvolveDialog({
  onClose,
  anchorRect,
}: {
  onClose: () => void;
  /** When provided, the dialog opens with its top-right corner aligned to the bottom-right of this rect. */
  anchorRect?: DOMRect | null;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // null = docked; {x,y} = free-floating (px from viewport top-left)
  const [freePos, setFreePos] = useState<{ x: number; y: number } | null>(null);
  const [dock, setDock] = useState<DockPosition>("bottom-right");
  const dragOriginRef = useRef<DragOrigin | null>(null);

  // Position the dialog under the hamburger button on first render if anchorRect is provided.
  useLayoutEffect(() => {
    if (!anchorRect || !dialogRef.current) return;
    const dialogW = dialogRef.current.offsetWidth;
    setFreePos({
      x: anchorRect.right - dialogW,
      y: anchorRect.bottom + 8,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount


  // ── Dragging ──────────────────────────────────────────────────────────────

  function handleDragStart(e: React.MouseEvent<HTMLDivElement>) {
    // Don't hijack clicks on buttons inside the title bar
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();

    const dialog = dialogRef.current;
    if (!dialog) return;

    const rect = dialog.getBoundingClientRect();
    dragOriginRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      dialogX: rect.left,
      dialogY: rect.top,
    };
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragOriginRef.current) return;
      const { mouseX, mouseY, dialogX, dialogY } = dragOriginRef.current;
      setFreePos({
        x: dialogX + (e.clientX - mouseX),
        y: dialogY + (e.clientY - mouseY),
      });
    }

    function onMouseUp() {
      dragOriginRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Docking ───────────────────────────────────────────────────────────────

  function snapToDock(pos: DockPosition) {
    setFreePos(null);
    setDock(pos);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("request", trimmed);
      for (const file of attachedFiles) {
        formData.append("attachments", file);
      }

      const res = await fetch("/api/evolve", { method: "POST", body: formData });
      const data = (await res.json()) as { sessionId?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }

      router.push(`/evolve/session/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  function handleFilesAdded(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    setAttachedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...arr.filter((f) => !existing.has(`${f.name}:${f.size}`))];
    });
  }

  // ── Position ──────────────────────────────────────────────────────────────

  const positionStyle: React.CSSProperties = freePos
    ? { position: "fixed", left: freePos.x, top: freePos.y }
    : {
        position: "fixed",
        ...(dock === "top-left"     ? { top: 16, left: 16 }    : {}),
        ...(dock === "top-right"    ? { top: 16, right: 16 }   : {}),
        ...(dock === "bottom-left"  ? { bottom: 16, left: 16 } : {}),
        ...(dock === "bottom-right" ? { bottom: 16, right: 16 }: {}),
      };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={dialogRef}
      style={{ ...positionStyle, zIndex: 50 }}
      className="rounded-xl border border-gray-700 bg-gray-950 shadow-2xl flex flex-col overflow-hidden resize w-[420px] min-w-[280px]"
    >
      {/* Title bar / drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none"
      >
        <span className="flex-1 text-sm font-medium text-amber-400">Propose a change</span>

        {/* Dock corner buttons */}
        <div className="flex items-center gap-0.5 mr-1" title="Dock to corner">
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as DockPosition[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => snapToDock(d)}
              title={`Dock to ${d.replace("-", " ")}`}
              className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                dock === d && !freePos
                  ? "text-amber-400 bg-gray-800"
                  : "text-gray-500 hover:text-gray-200 hover:bg-gray-700"
              }`}
            >
              <DockIcon pos={d} />
            </button>
          ))}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-700 transition-colors"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="1" y1="1" x2="11" y2="11"/>
            <line x1="11" y1="1" x2="1" y2="11"/>
          </svg>
        </button>
      </div>

      {/* Form body */}
      <div className="p-3 flex flex-col gap-2 flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-xs">
            ❌ {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 border border-gray-800 rounded-xl bg-gray-900 p-3 flex-1 min-h-0"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the change you want to make to this app…"
            disabled={isLoading}
            className="resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none leading-relaxed flex-1 min-h-0"
          />

          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachedFiles.map((file, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300"
                >
                  <span className="truncate max-w-[140px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-gray-500 hover:text-gray-200 ml-0.5 flex-shrink-0"
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesAdded(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.121l7-7a.5.5 0 0 1 .707.708l-7 7a2.5 2.5 0 0 1-3.536-3.536l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7A6.5 6.5 0 0 1 2.45 9.955l7-7a.5.5 0 1 1 .707.708l-7 7A5.5 5.5 0 0 0 10.95 18.92l7-7a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
              </svg>
              Attach
            </button>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white disabled:cursor-not-allowed"
            >
              {isLoading ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── DockIcon ─────────────────────────────────────────────────────────────────

// A small icon showing a filled square in the relevant corner of a box.
function DockIcon({ pos }: { pos: DockPosition }) {
  const isTop = pos.startsWith("top");
  const isLeft = pos.endsWith("left");
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <rect
        x={isLeft ? 1 : 5}
        y={isTop ? 1 : 5}
        width="4"
        height="4"
        rx="0.5"
        fill="currentColor"
      />
    </svg>
  );
}

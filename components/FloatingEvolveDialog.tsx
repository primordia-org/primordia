"use client";

// components/FloatingEvolveDialog.tsx
// A draggable, dockable floating dialog containing the evolve request form.
// Triggered by "Propose a change" in the hamburger menu so the user can keep
// the current page visible for reference while writing their request.
//
// Dragging: click-and-drag the title bar to freely position the dialog.
// Docking: four corner buttons in the title bar snap the dialog to a corner.

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { EvolveRequestForm } from "./EvolveRequestForm";
import { withBasePath } from "../lib/base-path";
import { X, ExternalLink } from "lucide-react";

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
  onSessionCreated,
}: {
  onClose: () => void;
  /** When provided, the dialog opens with its top-right corner aligned to the bottom-right of this rect. */
  anchorRect?: DOMRect | null;
  /**
   * Called with the new sessionId when a request is submitted successfully.
   * The dialog calls onClose() before this, so the caller should render a toast
   * independently (e.g. <EvolveSubmitToast>) to survive dialog unmount.
   */
  onSessionCreated?: (sessionId: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // null = docked; {x,y} = free-floating (px from viewport top-left)
  const [freePos, setFreePos] = useState<{ x: number; y: number } | null>(null);
  const [dock, setDock] = useState<DockPosition>("bottom-right");
  const dragOriginRef = useRef<DragOrigin | null>(null);

  // null = auto height; number = explicit height in px (set by bottom resize handle)
  const [dialogHeight, setDialogHeight] = useState<number | null>(null);
  const resizeOriginRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Suppress unused warning — isDragging used only for cursor style via CSS
  void isDragging;

  // When a session is created: close the dialog then notify the parent so it
  // can show a persistent toast (which must live outside this component to
  // survive its unmount).
  function handleSessionCreated(sessionId: string) {
    onClose();
    onSessionCreated?.(sessionId);
  }

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

  function startDrag(clientX: number, clientY: number) {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    dragOriginRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      dialogX: rect.left,
      dialogY: rect.top,
    };
  }

  function handleDragStart(e: React.MouseEvent<HTMLDivElement>) {
    // Don't hijack clicks on buttons inside the title bar
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    // Don't hijack taps on buttons inside the title bar
    if ((e.target as HTMLElement).closest("button")) return;
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
  }

  useEffect(() => {
    function onMove(clientX: number, clientY: number) {
      if (!dragOriginRef.current) return;
      const { mouseX, mouseY, dialogX, dialogY } = dragOriginRef.current;
      setIsDragging(true);
      setFreePos({
        x: dialogX + (clientX - mouseX),
        y: dialogY + (clientY - mouseY),
      });
    }

    function onMouseMove(e: MouseEvent) {
      onMove(e.clientX, e.clientY);
    }

    function onTouchMove(e: TouchEvent) {
      if (!dragOriginRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      onMove(touch.clientX, touch.clientY);
    }

    function onEnd() {
      dragOriginRef.current = null;
      setIsDragging(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  // ── Docking ───────────────────────────────────────────────────────────────

  function snapToDock(pos: DockPosition) {
    setFreePos(null);
    setDock(pos);
  }

  // ── Vertical resize (bottom handle) ───────────────────────────────────────

  function startResize(clientY: number) {
    const dialog = dialogRef.current;
    if (!dialog) return;
    resizeOriginRef.current = { startY: clientY, startHeight: dialog.offsetHeight };
  }

  useEffect(() => {
    function onMove(clientY: number) {
      if (!resizeOriginRef.current) return;
      const { startY, startHeight } = resizeOriginRef.current;
      setDialogHeight(Math.max(200, startHeight + (clientY - startY)));
    }
    function onMouseMove(e: MouseEvent) { onMove(e.clientY); }
    function onTouchMove(e: TouchEvent) {
      if (!resizeOriginRef.current) return;
      e.preventDefault();
      onMove(e.touches[0].clientY);
    }
    function onEnd() { resizeOriginRef.current = null; }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

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
      style={{ ...positionStyle, zIndex: 50, ...(dialogHeight !== null ? { height: dialogHeight } : {}) }}
      className="rounded-xl border border-gray-700 bg-gray-950 shadow-2xl flex flex-col overflow-hidden w-[420px] min-w-[280px] max-w-[calc(100vw-32px)] min-h-[200px]"
    >
      {/* Title bar / drag handle */}
      <div
        onMouseDown={handleDragStart}
        onTouchStart={handleTouchStart}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none touch-none"
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
          <X size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Form body — flex-1 so it fills available height when dialog is resized */}
      <div className="p-3 flex flex-col flex-1 overflow-y-auto min-h-0">
        <EvolveRequestForm compact onSessionCreated={handleSessionCreated} />
      </div>

      {/* Bottom resize handle — drag up/down to resize the dialog vertically */}
      <div
        onMouseDown={(e) => { e.preventDefault(); startResize(e.clientY); }}
        onTouchStart={(e) => { startResize(e.touches[0].clientY); }}
        className="flex items-center justify-center h-4 cursor-ns-resize bg-gray-900 border-t border-gray-800 touch-none select-none flex-shrink-0"
        aria-hidden="true"
      >
        <div className="w-8 h-1 rounded-full bg-gray-700" />
      </div>
    </div>
  );
}

// ─── EvolveSubmitToast ────────────────────────────────────────────────────────

/**
 * A self-contained fixed toast shown after a request is submitted via the
 * floating dialog. Renders as a portal on document.body so it persists after
 * the dialog unmounts. Fades out after 5 s and calls onDismiss when done.
 *
 * Usage:
 *   const [toastSessionId, setToastSessionId] = useState<string | null>(null);
 *   {toastSessionId && <EvolveSubmitToast sessionId={toastSessionId} onDismiss={() => setToastSessionId(null)} />}
 */
export function EvolveSubmitToast({
  sessionId,
  onDismiss,
}: {
  sessionId: string;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on the next frame.
    const enter = requestAnimationFrame(() => setVisible(true));
    // Begin fade-out just before the 5 s mark.
    const fadeOut = setTimeout(() => setVisible(false), 4500);
    // Remove from DOM after the transition completes.
    const remove = setTimeout(() => onDismiss(), 5000);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(fadeOut);
      clearTimeout(remove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  const sessionUrl = withBasePath(`/evolve/session/${sessionId}`);

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{ transition: "opacity 0.5s ease, transform 0.5s ease" }}
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-amber-600/60 shadow-2xl text-sm text-gray-100 whitespace-nowrap pointer-events-auto ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <span className="text-amber-400 font-medium">Request submitted!</span>
      <a
        href={sessionUrl}
        className="flex items-center gap-1.5 text-amber-300 hover:text-amber-200 underline underline-offset-2 transition-colors"
      >
        View session
        <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
      </a>
    </div>,
    document.body,
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

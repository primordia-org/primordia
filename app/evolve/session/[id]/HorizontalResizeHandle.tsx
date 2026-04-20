"use client";

import { useEffect, useRef } from "react";

interface HorizontalResizeHandleProps {
  /** Current width of the left panel in pixels. */
  currentWidth: number;
  /** Called with the new width whenever the user drags. */
  onWidthChange: (newWidth: number) => void;
  /** Ref to the flex container so we can read its width for clamping. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Minimum width of the left panel (default 280). */
  minLeft?: number;
  /** Minimum width of the right panel (default 280). */
  minRight?: number;
}

/**
 * A vertical drag handle for resizing a two-panel horizontal flex layout.
 * Uses the same pattern as FloatingEvolveDialog: persistent window listeners
 * read from a ref, so there's no glitch from listener add/remove on mousedown.
 */
export default function HorizontalResizeHandle({
  currentWidth,
  onWidthChange,
  containerRef,
  minLeft = 280,
  minRight = 280,
}: HorizontalResizeHandleProps) {
  const dragOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);

  function startResize(clientX: number) {
    dragOriginRef.current = { startX: clientX, startWidth: currentWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    // Cover the page with a transparent overlay so iframe doesn't swallow mouse events.
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;cursor:col-resize;";
    document.body.appendChild(overlay);
    overlayRef.current = overlay;
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragOriginRef.current) return;
      const { startX, startWidth } = dragOriginRef.current;
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
      const maxLeft = containerWidth - minRight - 4; // 4 px for the handle itself
      const newWidth = Math.max(minLeft, Math.min(maxLeft, startWidth + (e.clientX - startX)));
      onWidthChange(newWidth);
    }

    function onMouseUp() {
      if (!dragOriginRef.current) return;
      dragOriginRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      overlayRef.current?.remove();
      overlayRef.current = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  // onWidthChange is a callback — intentionally excluded to match FloatingEvolveDialog pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, minLeft, minRight]);

  return (
    <div
      className="hidden xl:flex items-center justify-center w-1 flex-shrink-0 xl:sticky xl:top-0 xl:h-dvh cursor-col-resize group select-none touch-none"
      onMouseDown={(e) => { e.preventDefault(); startResize(e.clientX); }}
      aria-hidden="true"
    >
      {/* Visual pill — mirrors FloatingEvolveDialog's bottom handle pill */}
      <div className="w-1 h-12 rounded-full bg-gray-700 group-hover:bg-blue-500 group-active:bg-blue-400 transition-colors" />
    </div>
  );
}

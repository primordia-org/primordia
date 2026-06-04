"use client";

// components/PageElementInspector.tsx
// Full-screen transparent portal overlay for picking a named DOM component on
// the current page. The picker intentionally targets only elements annotated
// with data-component, so captured references use stable app-level names rather
// than brittle DOM details or React fiber internals.
//
// Mouse: move to highlight, click to select.
// Touch: drag to highlight, hold 600 ms to select.
// Keyboard: Escape to cancel.

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { snapdom } from "@zumer/snapdom";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageElementInfo {
  /** Nearest data-component label. */
  component: string;
  /** CSS selector for the nearest data-component element. */
  selector: string;
  /** Raw outerHTML, truncated to 600 characters. */
  html: string;
  /** Visible text content, truncated to 200 characters. */
  text: string;
  /** The selected data-component DOM element. */
  element: Element;
}

// ─── data-component helpers ───────────────────────────────────────────────────

function cssString(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Walk DOM ancestors looking for the nearest named data-component element. */
export function getNearestDataComponentElement(el: Element | null): Element | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const label = cur.getAttribute("data-component");
    if (label) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function getDataComponentLabel(el: Element): string | null {
  return el.getAttribute("data-component");
}

/** CSS selector helper constrained to data-component annotations only. */
export function getCssSelector(el: Element): string {
  const label = getDataComponentLabel(el);
  return label ? `[data-component="${cssString(label)}"]` : "";
}

/** Walk DOM ancestors looking for a data-source-file attribute. */
function getDataSourceFile(el: Element): string | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const sf = cur.getAttribute("data-source-file");
    if (sf) return sf;
    cur = cur.parentElement;
  }
  return null;
}

// ─── File capture ─────────────────────────────────────────────────────────────

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
}

/**
 * Generate attachment files for a selected page component:
 * 1. A PNG screenshot of the data-component element.
 * 2. A Markdown details file with page URL, component name, data-component
 *    selector, source file when available, outerHTML, and visible text.
 */
export async function captureElementFiles(el: Element, info: PageElementInfo): Promise<File[]> {
  const slug = sanitizeLabel(info.component);
  const files: File[] = [];

  try {
    const screenshot = await captureElementScreenshot(el, slug);
    if (screenshot) files.push(screenshot);
  } catch {
    // ignore screenshot failures; details are still useful
  }

  const pageUrl = typeof window !== "undefined" ? window.location.href : "(unknown)";
  const sourceFile = getDataSourceFile(el);

  const md = [
    `# Inspected Component: <${info.component}>`,
    "",
    "## Page",
    pageUrl,
    "",
    ...(sourceFile ? ["## Source File", sourceFile, ""] : []),
    "## data-component Selector",
    `\`${info.selector}\``,
    "",
    "## Visible Text",
    info.text || "(none)",
    "",
    "## OuterHTML",
    "```html",
    info.html,
    "```",
  ].join("\n");

  files.push(new File([md], `element-${slug}-details.md`, { type: "text/markdown" }));
  return files;
}

async function captureElementScreenshot(el: Element, slug: string): Promise<File | null> {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const blob = await snapdom.toBlob(el, {
    type: "png",
    scale: window.devicePixelRatio || 1,
    backgroundColor: "#111827",
    embedFonts: false,
    fast: true,
  });

  return new File([blob], `element-${slug}-screenshot.png`, { type: "image/png" });
}

// ─── HoverLabel ───────────────────────────────────────────────────────────────

function HoverLabel({ el, rect }: { el: Element; rect: DOMRect }) {
  const component = getDataComponentLabel(el) ?? "Unnamed";
  const labelH = 22;
  let top = rect.top - labelH - 7;
  if (top < 4) top = rect.bottom + 4;
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 320));

  return (
    <div
      data-primordia-inspector="label"
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 9999,
        pointerEvents: "none",
        maxWidth: "60vw",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-mono shadow-lg"
    >
      &lt;{component}&gt;
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageElementInspector({
  onSelect,
  onCancel,
  skipElement,
}: {
  onSelect: (info: PageElementInfo) => void;
  onCancel: () => void;
  /**
   * An element (and all its descendants) that should be excluded from
   * selection — typically the dialog or form panel that launched the inspector.
   */
  skipElement?: HTMLElement | null;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hoveredEl, setHoveredEl] = useState<Element | null>(null);
  const hoveredRef = useRef<Element | null>(null);

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "__primordia_inspector_cursor";
    style.textContent = "* { cursor: crosshair !important; }";
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const getElementAt = useCallback(
    (x: number, y: number): Element | null => {
      const candidates = document.elementsFromPoint(x, y);
      for (const candidate of candidates) {
        if (candidate === overlayRef.current) continue;
        if (candidate instanceof HTMLElement && candidate.hasAttribute("data-primordia-inspector")) continue;
        if (skipElement && (skipElement === candidate || skipElement.contains(candidate))) continue;
        const componentEl = getNearestDataComponentElement(candidate);
        if (!componentEl) continue;
        if (skipElement && (skipElement === componentEl || skipElement.contains(componentEl))) continue;
        return componentEl;
      }
      return null;
    },
    [skipElement],
  );

  function buildInfo(el: Element): PageElementInfo {
    const component = getDataComponentLabel(el) ?? "Unnamed";
    const selector = getCssSelector(el);
    const html = el.outerHTML.slice(0, 600);
    const text = ((el as HTMLElement).innerText ?? "").slice(0, 200).trim();
    return { component, selector, html, text, element: el };
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = getElementAt(e.clientX, e.clientY);
      if (el !== hoveredRef.current) {
        hoveredRef.current = el;
        setHoveredEl(el);
      }
    },
    [getElementAt],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getElementAt(e.clientX, e.clientY);
      if (!el) {
        onCancel();
        return;
      }
      onSelect(buildInfo(el));
    },
    [getElementAt, onSelect, onCancel],
  );

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_MS = 600;
  const MOVE_CANCEL_PX = 12;

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      const el = getElementAt(touch.clientX, touch.clientY);
      if (el) {
        hoveredRef.current = el;
        setHoveredEl(el);
      }
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (hoveredRef.current) onSelect(buildInfo(hoveredRef.current));
      }, LONG_PRESS_MS);
    },
    [getElementAt, onSelect],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (touchStartRef.current) {
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) cancelLongPress();
      }
      const el = getElementAt(touch.clientX, touch.clientY);
      if (el !== hoveredRef.current) {
        hoveredRef.current = el;
        setHoveredEl(el);
      }
    },
    [getElementAt],
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    cancelLongPress();
  }, []);

  if (typeof document === "undefined") return null;

  const rect = hoveredEl?.getBoundingClientRect() ?? null;

  return createPortal(
    <>
      <div
        ref={overlayRef}
        data-primordia-inspector="overlay"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent", touchAction: "none" }}
      />

      {rect && (
        <div
          data-primordia-inspector="highlight-component"
          style={{
            position: "fixed",
            left: rect.left - 2,
            top: rect.top - 2,
            width: rect.width + 4,
            height: rect.height + 4,
            outline: "2px solid #3b82f6",
            outlineOffset: "0",
            background: "rgba(59, 130, 246, 0.05)",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        />
      )}

      {hoveredEl && rect && <HoverLabel el={hoveredEl} rect={rect} />}

      <div
        data-primordia-inspector="banner"
        style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none" }}
        className="px-4 py-2 rounded-lg bg-blue-950 border border-blue-600/60 text-xs text-blue-200 shadow-2xl whitespace-nowrap"
      >
        Click a named component to attach it to your request · <kbd className="opacity-70">Esc</kbd> to cancel
        <span className="hidden sm:inline"> · touch: drag to highlight, hold to select</span>
      </div>
    </>,
    document.body,
  );
}

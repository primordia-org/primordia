"use client";

// components/PageElementInspector.tsx
// Full-screen transparent portal overlay for picking named DOM targets on the
// current page. The picker highlights both the nearest data-component (generic
// app component name) and nearest data-id (specific control/element name) when
// available, so captured references use stable names rather than brittle DOM or
// React fiber internals.
//
// Mouse: move to highlight, click to select.
// Touch: drag to highlight, hold 600 ms to select.
// Keyboard: Escape to cancel.

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { snapdom } from "@zumer/snapdom";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageElementInfo {
  /** Nearest data-component label, when available. */
  component: string;
  /** CSS selector for the nearest data-component element, or data-id fallback. */
  selector: string;
  /** Nearest data-id label, when available. */
  dataId?: string | null;
  /** CSS selector for the nearest data-id element, when available. */
  dataIdSelector?: string | null;
  /** Raw outerHTML, truncated to 600 characters. */
  html: string;
  /** Visible text content, truncated to 200 characters. */
  text: string;
  /** The selected DOM element, preferring nearest data-id over data-component. */
  element: Element;
}

interface PickTarget {
  componentEl: Element | null;
  dataIdEl: Element | null;
  selectedEl: Element;
}

// ─── named target helpers ─────────────────────────────────────────────────────

function cssString(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getNearestNamedElement(el: Element | null, attr: "data-component" | "data-id"): Element | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const label = cur.getAttribute(attr);
    if (label) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function getNearestDataComponentElement(el: Element | null): Element | null {
  return getNearestNamedElement(el, "data-component");
}

export function getNearestDataIdElement(el: Element | null): Element | null {
  return getNearestNamedElement(el, "data-id");
}

function getDataComponentLabel(el: Element | null): string | null {
  return el?.getAttribute("data-component") ?? null;
}

function getDataIdLabel(el: Element | null): string | null {
  return el?.getAttribute("data-id") ?? null;
}

function getAttrSelector(el: Element | null, attr: "data-component" | "data-id"): string | null {
  const label = el?.getAttribute(attr);
  return label ? `[${attr}="${cssString(label)}"]` : null;
}

/** Primary selector helper: data-component when available, data-id fallback. */
export function getCssSelector(el: Element): string {
  return getAttrSelector(el, "data-component") ?? getAttrSelector(el, "data-id") ?? "";
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

function resolvePickTarget(rawEl: Element | null): PickTarget | null {
  if (!rawEl) return null;
  const componentEl = getNearestDataComponentElement(rawEl);
  const dataIdEl = getNearestDataIdElement(rawEl);
  const selectedEl = dataIdEl ?? componentEl;
  return selectedEl ? { componentEl, dataIdEl, selectedEl } : null;
}

// ─── File capture ─────────────────────────────────────────────────────────────

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
}

/**
 * Generate attachment files for a selected page target:
 * 1. A PNG screenshot of the selected named element.
 * 2. A Markdown details file with page URL, data-component name/selector,
 *    data-id name/selector, source file when available, outerHTML, and text.
 */
export async function captureElementFiles(el: Element, info: PageElementInfo): Promise<File[]> {
  const slug = sanitizeLabel(info.dataId ?? info.component);
  const files: File[] = [];

  try {
    const screenshot = await captureElementScreenshot(el, slug);
    if (screenshot) files.push(screenshot);
  } catch {
    // ignore screenshot failures; details are still useful
  }

  const pageUrl = typeof window !== "undefined" ? window.location.href : "(unknown)";
  const sourceFile = getDataSourceFile(el);

  const componentSelector = info.selector.startsWith("[data-component=") ? info.selector : null;

  const md = [
    `# Inspected Target: ${info.dataId ? `[${info.dataId}] in ` : ""}<${info.component}>`,
    "",
    "## Page",
    pageUrl,
    "",
    ...(sourceFile ? ["## Source File", sourceFile, ""] : []),
    "## data-component",
    componentSelector
      ? `Name: \`${info.component}\`\nSelector: \`${componentSelector}\``
      : "(none found)",
    "",
    "## data-id",
    info.dataId && info.dataIdSelector
      ? `Name: \`${info.dataId}\`\nSelector: \`${info.dataIdSelector}\``
      : "(none found)",
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

function HoverLabels({ target }: { target: PickTarget }) {
  const component = getDataComponentLabel(target.componentEl);
  const dataId = getDataIdLabel(target.dataIdEl);
  const rect = (target.dataIdEl ?? target.componentEl)?.getBoundingClientRect();
  if (!rect) return null;

  const labelH = 22;
  const gap = 3;
  const labelCount = component && dataId ? 2 : 1;
  let top = rect.top - labelH * labelCount - gap * (labelCount - 1) - 7;
  if (top < 4) top = rect.bottom + 4;
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 320));

  return (
    <>
      {component && (
        <div
          data-primordia-inspector="label"
          style={{ position: "fixed", top, left, zIndex: 9999, pointerEvents: "none", maxWidth: "60vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-mono shadow-lg"
        >
          &lt;{component}&gt;
        </div>
      )}
      {dataId && (
        <div
          data-primordia-inspector="label"
          style={{ position: "fixed", top: top + (component ? labelH + gap : 0), left, zIndex: 9999, pointerEvents: "none", maxWidth: "90vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          className="px-2 py-0.5 rounded bg-green-700 text-white text-xs font-mono shadow-lg"
        >
          [{dataId}]
        </div>
      )}
    </>
  );
}

function HighlightBox({ el, kind }: { el: Element | null; kind: "component" | "data-id" }) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const isComponent = kind === "component";
  return (
    <div
      data-primordia-inspector={isComponent ? "highlight-component" : "highlight-data-id"}
      style={{
        position: "fixed",
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        outline: `2px solid ${isComponent ? "#3b82f6" : "#22c55e"}`,
        outlineOffset: "0",
        background: isComponent ? "rgba(59, 130, 246, 0.05)" : "rgba(34, 197, 94, 0.08)",
        pointerEvents: "none",
        zIndex: isComponent ? 9996 : 9997,
      }}
    />
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
  const [hoveredTarget, setHoveredTarget] = useState<PickTarget | null>(null);
  const hoveredRef = useRef<PickTarget | null>(null);

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

  const getTargetAt = useCallback(
    (x: number, y: number): PickTarget | null => {
      const candidates = document.elementsFromPoint(x, y);
      for (const candidate of candidates) {
        if (candidate === overlayRef.current) continue;
        if (candidate instanceof HTMLElement && candidate.hasAttribute("data-primordia-inspector")) continue;
        if (skipElement && (skipElement === candidate || skipElement.contains(candidate))) continue;
        const target = resolvePickTarget(candidate);
        if (!target) continue;
        if (skipElement && (skipElement === target.selectedEl || skipElement.contains(target.selectedEl))) continue;
        return target;
      }
      return null;
    },
    [skipElement],
  );

  function buildInfo(target: PickTarget): PageElementInfo {
    const component = getDataComponentLabel(target.componentEl) ?? "UnnamedComponent";
    const selector = getAttrSelector(target.componentEl, "data-component") ?? getAttrSelector(target.dataIdEl, "data-id") ?? "";
    const dataId = getDataIdLabel(target.dataIdEl);
    const dataIdSelector = getAttrSelector(target.dataIdEl, "data-id");
    const html = target.selectedEl.outerHTML.slice(0, 600);
    const text = ((target.selectedEl as HTMLElement).innerText ?? "").slice(0, 200).trim();
    return { component, selector, dataId, dataIdSelector, html, text, element: target.selectedEl };
  }

  function setHovered(target: PickTarget | null) {
    const prev = hoveredRef.current;
    if (target?.selectedEl === prev?.selectedEl && target?.componentEl === prev?.componentEl && target?.dataIdEl === prev?.dataIdEl) return;
    hoveredRef.current = target;
    setHoveredTarget(target);
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => setHovered(getTargetAt(e.clientX, e.clientY)),
    [getTargetAt],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = getTargetAt(e.clientX, e.clientY);
      if (!target) {
        onCancel();
        return;
      }
      onSelect(buildInfo(target));
    },
    [getTargetAt, onSelect, onCancel],
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
      const target = getTargetAt(touch.clientX, touch.clientY);
      setHovered(target);
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (hoveredRef.current) onSelect(buildInfo(hoveredRef.current));
      }, LONG_PRESS_MS);
    },
    [getTargetAt, onSelect],
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
      setHovered(getTargetAt(touch.clientX, touch.clientY));
    },
    [getTargetAt],
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    cancelLongPress();
  }, []);

  if (typeof document === "undefined") return null;

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

      <HighlightBox el={hoveredTarget?.componentEl ?? null} kind="component" />
      <HighlightBox el={hoveredTarget?.dataIdEl ?? null} kind="data-id" />
      {hoveredTarget && <HoverLabels target={hoveredTarget} />}

      <div
        data-primordia-inspector="banner"
        style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none" }}
        className="px-4 py-2 rounded-lg bg-blue-950 border border-blue-600/60 text-xs text-blue-200 shadow-2xl whitespace-nowrap"
      >
        Click a named target to attach it to your request · <kbd className="opacity-70">Esc</kbd> to cancel
        <span className="hidden sm:inline"> · touch: drag to highlight, hold to select</span>
      </div>
    </>,
    document.body,
  );
}

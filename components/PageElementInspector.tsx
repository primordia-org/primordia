"use client";

// components/PageElementInspector.tsx
// Full-screen transparent portal overlay for picking a DOM element on the
// current page.  Renders above all other UI (z-index 9998–9999) so it works
// regardless of which page is open.
//
// Mouse: move to highlight, click to select.
// Touch: drag to highlight, hold 600 ms to select.
// Keyboard: Escape to cancel.
//
// Also exports captureElementFiles() which generates a PNG screenshot and a
// Markdown details file (outerHTML + React fiber tree) for a selected element.

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageElementInfo {
  /** Nearest React component display-name, or the lowercase tag name as fallback. */
  component: string;
  /** Compact CSS path selector (up to 5 ancestors). */
  selector: string;
  /** Raw outerHTML, truncated to 600 characters. */
  html: string;
  /** Visible text content, truncated to 200 characters. */
  text: string;
  /** The actual DOM element — passed through so callers can do further inspection. */
  element: Element;
}

// ─── CSS selector helper ──────────────────────────────────────────────────────

export function getCssSelector(el: Element): string {
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current.tagName && current.tagName !== "HTML" && current.tagName !== "BODY") {
    const id = (current as HTMLElement).id;
    if (id) {
      path.unshift(`#${id}`);
      break;
    }
    let part = current.tagName.toLowerCase();
    const classes: string[] = [];
    for (let i = 0; i < current.classList.length && classes.length < 2; i++) {
      const c = current.classList[i];
      // Skip Tailwind utility classes and pseudo-variants
      if (
        c.length < 25 &&
        !c.includes(":") &&
        !c.includes("/") &&
        !c.includes("[") &&
        !c.includes("]")
      ) {
        classes.push(c);
      }
    }
    if (classes.length > 0) part += "." + classes.join(".");
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (s) => s.tagName === (current as Element).tagName,
        )
      : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    path.unshift(part);
    if (path.length >= 5) break;
    current = current.parentElement;
  }
  return path.join(" > ");
}

// ─── React fiber helpers ──────────────────────────────────────────────────────

export function getReactComponentName(el: Element): string | null {
  const keys = Object.keys(el as unknown as Record<string, unknown>);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (el as unknown as Record<string, unknown>)[fiberKey];
  let limit = 60;
  while (fiber && limit-- > 0) {
    const type = fiber.type;
    if (type && typeof type === "function") {
      const name = (type.displayName || type.name) as string | undefined;
      if (name && /^[A-Z]/.test(name) && name.length > 1) return name;
    }
    if (type && typeof type === "object") {
      let name: string | undefined = type.displayName;
      if (!name && type.render) name = type.render.displayName || type.render.name;
      if (!name && type.type) name = type.type.displayName || type.type.name;
      if (name && /^[A-Z]/.test(name) && name.length > 1) return name;
    }
    fiber = fiber.return;
  }
  return null;
}

/** Return all named React component names from the root down to the nearest enclosing component. */
export function getReactComponentChain(el: Element): string[] {
  const keys = Object.keys(el as unknown as Record<string, unknown>);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (el as unknown as Record<string, unknown>)[fiberKey];
  const chain: string[] = [];
  let limit = 100;
  while (fiber && limit-- > 0) {
    const type = fiber.type;
    if (type && typeof type === "function") {
      const name = (type.displayName || type.name) as string | undefined;
      if (name && /^[A-Z]/.test(name) && name.length > 1) chain.unshift(name);
    }
    fiber = fiber.return;
  }
  return chain;
}

/**
 * Walk the React fiber tree starting from the nearest named component ancestor
 * of `selectedEl`, generating a JSX-like tree with the selected fiber marked.
 */
export function generateFiberTreeText(selectedEl: Element): string {
  const keys = Object.keys(selectedEl as unknown as Record<string, unknown>);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return "(React fiber not available — production builds strip fiber data)";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedFiber: any = (selectedEl as unknown as Record<string, unknown>)[fiberKey];

  // Walk up to the nearest named React component
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rootFiber: any = selectedFiber;
  let limit = 60;
  while (rootFiber.return && limit-- > 0) {
    const parent = rootFiber.return;
    const type = parent.type;
    if (type && typeof type === "function") {
      const name = (type.displayName || type.name) as string | undefined;
      if (name && /^[A-Z]/.test(name) && name.length > 1) {
        rootFiber = parent;
        break;
      }
    }
    rootFiber = parent;
  }

  const lines: string[] = [];
  serializeFiber(rootFiber, 0, selectedFiber, lines, 12, { count: 0 });
  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeFiber(fiber: any, depth: number, selectedFiber: any, lines: string[], maxDepth: number, counter: { count: number }) {
  if (!fiber || depth > maxDepth || counter.count > 400) return;
  counter.count++;

  const pad = "  ".repeat(depth);
  const type = fiber.type;
  const props: Record<string, unknown> = fiber.memoizedProps || {};
  const isSelected = fiber === selectedFiber;

  if (!type) {
    // Fragment / root — render children inline
    let child = fiber.child;
    while (child) {
      serializeFiber(child, depth, selectedFiber, lines, maxDepth, counter);
      child = child.sibling;
    }
    return;
  }

  let tagName: string;
  if (typeof type === "string") {
    tagName = type;
  } else if (typeof type === "function") {
    tagName = ((type.displayName || type.name) as string | undefined) ?? "Anonymous";
  } else if (type && typeof type === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = type as any;
    tagName = (t.displayName || t.render?.name || t.type?.name) as string | undefined ?? "Anonymous";
  } else {
    return;
  }

  // Build a concise attribute string
  const attrs: string[] = [];
  if (props.className && typeof props.className === "string") {
    const cls = props.className.slice(0, 60);
    attrs.push(`className="${cls}${props.className.length > 60 ? "…" : ""}"`);
  }
  if (props.id) attrs.push(`id="${props.id}"`);
  if (typeof props.href === "string") attrs.push(`href="${props.href.slice(0, 40)}"`);
  if (typeof props.type === "string") attrs.push(`type="${props.type}"`);
  if (typeof props.placeholder === "string") attrs.push(`placeholder="${(props.placeholder as string).slice(0, 30)}"`);
  if (props.disabled === true) attrs.push("disabled");
  const attrsStr = attrs.length ? " " + attrs.join(" ") : "";

  const selectedMark = isSelected ? "  {/* ← SELECTED */}" : "";
  const textChildren = typeof props.children === "string" ? (props.children as string).trim().slice(0, 80) : null;

  if (!fiber.child || isSelected) {
    if (textChildren) {
      lines.push(`${pad}<${tagName}${attrsStr}>${textChildren}</${tagName}>${selectedMark}`);
    } else {
      lines.push(`${pad}<${tagName}${attrsStr} />${selectedMark}`);
    }
    return;
  }

  lines.push(`${pad}<${tagName}${attrsStr}>${selectedMark}`);
  let child = fiber.child;
  let sibCount = 0;
  while (child && sibCount < 15) {
    serializeFiber(child, depth + 1, selectedFiber, lines, maxDepth, counter);
    child = child.sibling;
    sibCount++;
  }
  if (child) lines.push(`${pad}  {/* …more siblings */}`);
  lines.push(`${pad}</${tagName}>`);
}

// ─── File capture ─────────────────────────────────────────────────────────────

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
}

/**
 * Generate attachment files for a selected page element:
 * 1. A PNG screenshot (best-effort via SVG foreignObject — may not reflect all CSS)
 * 2. A Markdown details file with outerHTML + React component chain + fiber tree
 *
 * Both files share a common slug derived from the component name.
 */
export async function captureElementFiles(el: Element, info: PageElementInfo): Promise<File[]> {
  const slug = sanitizeLabel(info.component);
  const files: File[] = [];

  // Screenshot (best-effort — skip silently on failure)
  try {
    const screenshot = await captureElementScreenshot(el, slug);
    if (screenshot) files.push(screenshot);
  } catch {
    // ignore
  }

  // Text details
  const chain = getReactComponentChain(el);
  const chainStr =
    chain.length ? chain.join(" > ") + ` > [${el.tagName.toLowerCase()}]` : el.tagName.toLowerCase();
  const fiberTree = generateFiberTreeText(el);

  const md = [
    `# Inspected Element: <${info.component}>`,
    "",
    "## React Component Chain",
    chainStr,
    "",
    "## CSS Selector",
    `\`${info.selector}\``,
    "",
    "## OuterHTML",
    "```html",
    info.html,
    "```",
    "",
    "## React Fiber Tree",
    "```jsx",
    fiberTree,
    "```",
  ].join("\n");

  files.push(new File([md], `element-${slug}-details.md`, { type: "text/markdown" }));
  return files;
}

async function captureElementScreenshot(el: Element, slug: string): Promise<File | null> {
  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w < 1 || h < 1) return null;

  // Gather CSS: <style> tags + same-origin stylesheet rules
  const cssChunks: string[] = [];
  for (const styleEl of Array.from(document.querySelectorAll("style"))) {
    cssChunks.push(styleEl.textContent ?? "");
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules ?? []);
      cssChunks.push(rules.slice(0, 2000).map((r) => r.cssText).join("\n"));
    } catch {
      // cross-origin — skip
    }
  }
  // Cap total embedded CSS at 300 KB to avoid browser SVG rendering limits
  const cssText = cssChunks.join("\n").slice(0, 300_000).replace(/<\/style>/gi, "");

  const svgContent = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
    `<foreignObject width="${w}" height="${h}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;margin:0;padding:0;background:#111827">`,
    cssText ? `<style>${cssText}</style>` : "",
    el.outerHTML,
    "</div>",
    "</foreignObject>",
    "</svg>",
  ].join("");

  const svgBlob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image load failed"));
      img.src = url;
    });

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0, w, h);

    return await new Promise<File | null>((resolve) => {
      canvas.toBlob(
        (blob) =>
          resolve(
            blob
              ? new File([blob], `element-${slug}-screenshot.png`, { type: "image/png" })
              : null,
          ),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── HoverLabel ───────────────────────────────────────────────────────────────

function HoverLabel({ el, rect }: { el: Element; rect: DOMRect }) {
  const component = getReactComponentName(el) || el.tagName.toLowerCase();
  const selector = getCssSelector(el);

  const labelH = 22;
  let top = rect.top - labelH - 4;
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
        maxWidth: "90vw",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-mono shadow-lg"
    >
      &lt;{component}&gt; {selector}
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

  // ── Crosshair cursor ──────────────────────────────────────────────────────

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "__primordia_inspector_cursor";
    style.textContent = "* { cursor: crosshair !important; }";
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  // ── Escape to cancel ──────────────────────────────────────────────────────

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

  // ── Element resolution ────────────────────────────────────────────────────

  const getElementAt = useCallback(
    (x: number, y: number): Element | null => {
      const candidates = document.elementsFromPoint(x, y);
      for (const el of candidates) {
        if (el === overlayRef.current) continue;
        if (el instanceof HTMLElement && el.hasAttribute("data-primordia-inspector")) continue;
        if (skipElement && (skipElement === el || skipElement.contains(el))) continue;
        return el;
      }
      return null;
    },
    [skipElement],
  );

  function buildInfo(el: Element): PageElementInfo {
    const component = getReactComponentName(el) || el.tagName.toLowerCase();
    const selector = getCssSelector(el);
    const html = el.outerHTML.slice(0, 600);
    const text = ((el as HTMLElement).innerText ?? "").slice(0, 200).trim();
    return { component, selector, html, text, element: el };
  }

  // ── Mouse handlers ────────────────────────────────────────────────────────

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
      if (!el) { onCancel(); return; }
      onSelect(buildInfo(el));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getElementAt, onSelect, onCancel],
  );

  // ── Touch handlers ────────────────────────────────────────────────────────

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
      if (el) { hoveredRef.current = el; setHoveredEl(el); }
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (hoveredRef.current) onSelect(buildInfo(hoveredRef.current));
      }, LONG_PRESS_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (el !== hoveredRef.current) { hoveredRef.current = el; setHoveredEl(el); }
    },
    [getElementAt],
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    cancelLongPress();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (typeof document === "undefined") return null;

  const rect = hoveredEl?.getBoundingClientRect() ?? null;

  return createPortal(
    <>
      {/* Transparent full-screen overlay — captures all pointer events */}
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

      {/* Highlight box */}
      {rect && (
        <div
          data-primordia-inspector="highlight"
          style={{
            position: "fixed",
            left: rect.left - 1, top: rect.top - 1,
            width: rect.width + 2, height: rect.height + 2,
            outline: "2px solid #3b82f6", outlineOffset: "0",
            background: "rgba(59, 130, 246, 0.08)",
            pointerEvents: "none", zIndex: 9997,
          }}
        />
      )}

      {/* Label */}
      {hoveredEl && rect && <HoverLabel el={hoveredEl} rect={rect} />}

      {/* Instruction banner */}
      <div
        data-primordia-inspector="banner"
        style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none" }}
        className="px-4 py-2 rounded-lg bg-blue-950 border border-blue-600/60 text-xs text-blue-200 shadow-2xl whitespace-nowrap"
      >
        Click an element to attach it to your request ·{" "}
        <kbd className="opacity-70">Esc</kbd> to cancel
        <span className="hidden sm:inline"> · touch: drag to highlight, hold to select</span>
      </div>
    </>,
    document.body,
  );
}

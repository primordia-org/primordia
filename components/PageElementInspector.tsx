"use client";

// components/PageElementInspector.tsx
// Full-screen transparent portal overlay for picking a DOM element on the
// current page.  Renders above all other UI (z-index 9998-9999) so it works
// regardless of which page is open.
//
// Mouse: move to highlight, click to select.
// Touch: drag to highlight, hold 600 ms to select.
// Keyboard: Escape to cancel.
//
// Also exports captureElementFiles() which generates an SVG screenshot and a
// Markdown details file (page URL, outerHTML, React ancestry path) for a
// selected element.

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { snapdom } from "@zumer/snapdom";
import { getCssSelector as libGetCssSelector } from "css-selector-generator";

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

/**
 * Tailwind-aware CSS selector generator.
 *
 * Uses `css-selector-generator` to produce the shortest unique selector for
 * `el`, scoped within `root` (the nearest React component's root DOM node).
 * Scoping to the component root keeps the path short and directly maps to the
 * JSX written inside that component file — reducing the number of tool calls
 * an LLM agent needs to locate the element in source code.
 *
 * Tailwind utility classes are blacklisted so the selector stays readable and
 * stable across style changes.
 */
export function getCssSelector(el: Element, root?: Element | null): string {
  // Patterns that identify Tailwind / generated class names we don't want in selectors.
  // css-selector-generator's blacklist receives the full candidate selector string,
  // so we match on the class token syntax (e.g. ".hover:text-white").
  const tailwindBlacklist: ((s: string) => boolean)[] = [
    // Pseudo-variant prefixes: hover:, sm:, focus:, etc.
    (s) => /\.\S*:/.test(s),
    // Arbitrary-value brackets: [#fff], [1.5rem], etc.
    (s) => /\.\S*\[/.test(s),
    // Opacity-modifier slash: text-white/50, etc.
    (s) => /\.\S*\/\S/.test(s),
    // Very long single-token utility classes (e.g. prose-headings:font-semibold)
    (s) => /\.([^.\s#>+~[]{25,})/.test(s),
  ];

  try {
    return libGetCssSelector(el, {
      // Scope to the component root so the path is relative to the component,
      // not the document — mirrors the JSX hierarchy in the source file.
      root: root ?? document.body,
      blacklist: tailwindBlacklist,
      // Prefer readable identifiers over positional nth-child when possible.
      selectors: ["id", "class", "tag", "attribute", "nthchild"],
      // Tag names alongside classes improve readability (e.g. button.send-btn).
      includeTag: true,
    });
  } catch {
    // Fallback: just return the tag name if the library throws (e.g. disconnected node).
    return el.tagName.toLowerCase();
  }
}

// ─── React fiber helpers ──────────────────────────────────────────────────────

/**
 * Next.js App Router and React internal component names that should be skipped
 * when walking the fiber tree, because they are framework plumbing rather than
 * meaningful application-level components.
 */
const INTERNAL_COMPONENT_NAMES = new Set([
  "SegmentViewNode",
  "InnerLayoutRouter",
  "OuterLayoutRouter",
  "AppRouter",
  "HotReloader",
  "ReactDevOverlay",
  "ServerInsertedHTMLContext",
  "StylesheetResource",
  "ScriptResource",
  "ClientHookContext",
  "GlobalError",
  "NotFoundBoundary",
  "RedirectBoundary",
  "ErrorBoundary",
  "LoadingBoundary",
  "RootLayout",
]);

/**
 * Walk DOM ancestors looking for a `data-component` attribute.
 * This is the preferred label source for server-rendered sections that don't
 * appear as named components in the client-side fiber tree.
 */
function getDataComponentLabel(el: Element): string | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const label = cur.getAttribute("data-component");
    if (label) return label;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Walk DOM ancestors looking for a `data-source-file` attribute injected by
 * swc-plugin-component-annotate. Returns the filename string or null.
 */
function getDataSourceFile(el: Element): string | null {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    const sf = cur.getAttribute("data-source-file");
    if (sf) return sf;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Find the root DOM element of the nearest named React component ancestor.
 * Walks up the fiber tree to find the component, then down to the first host
 * (DOM) fiber's stateNode. Returns null if no component or DOM node is found.
 */
export function getComponentRootElement(el: Element): Element | null {
  const elAny = el as unknown as Record<string, unknown>;
  const keys = Object.keys(elAny);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = elAny[fiberKey];

  // Walk UP to find the nearest named React component fiber
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let componentFiber: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = fiber.return;
  let limit = 60;
  while (cur && limit-- > 0) {
    const type = cur.type;
    if (type && typeof type === "function") {
      const name = (type.displayName || type.name) as string | undefined;
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) {
        componentFiber = cur;
        break;
      }
    }
    if (type && typeof type === "object") {
      let name: string | undefined = type.displayName;
      if (!name && type.render) name = type.render.displayName || type.render.name;
      if (!name && type.type) name = type.type.displayName || type.type.name;
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) {
        componentFiber = cur;
        break;
      }
    }
    cur = cur.return;
  }

  if (!componentFiber) return null;

  // Walk DOWN from componentFiber child to find the first DOM stateNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findFirstDom(f: any): Element | null {
    if (!f) return null;
    if (typeof f.type === "string" && f.stateNode instanceof Element) return f.stateNode;
    const fromChild = findFirstDom(f.child);
    if (fromChild) return fromChild;
    return null;
  }

  return findFirstDom(componentFiber.child ?? componentFiber);
}

export function getReactComponentName(el: Element): string | null {
  // 1. Check data-component attribute first — reliable for server-rendered content.
  const label = getDataComponentLabel(el);
  if (label) return label;

  // 2. Walk React fiber tree, skipping Next.js / React internal names.
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
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) return name;
    }
    if (type && typeof type === "object") {
      let name: string | undefined = type.displayName;
      if (!name && type.render) name = type.render.displayName || type.render.name;
      if (!name && type.type) name = type.type.displayName || type.type.name;
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) return name;
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
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) chain.unshift(name);
    }
    fiber = fiber.return;
  }
  // Prepend any data-component label found in the DOM ancestry.
  const label = getDataComponentLabel(el);
  if (label && !chain.includes(label)) chain.unshift(label);
  return chain;
}

/**
 * Render the full JSX subtree of the nearest named React component ancestor
 * of `selectedEl`. All siblings are included (unlike the previous path-only
 * renderer). The selected element is marked with a comment.
 *
 * Depth is capped at 8 levels below the component root and node count at 200
 * to keep the output from blowing up on deeply nested components.
 */
export function generateFiberTreeText(selectedEl: Element): string {
  const elAny = selectedEl as unknown as Record<string, unknown>;
  const keys = Object.keys(elAny);
  const fiberKey = keys.find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) return "(React fiber not available - production builds strip fiber data)";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedFiber: any = elAny[fiberKey];

  // Walk UP to the nearest named React component to use as the rendering root,
  // skipping Next.js / React internal names so we don't end up rooted at SegmentViewNode.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rootFiber: any = selectedFiber;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = selectedFiber.return;
  let limit = 30;
  while (cur && limit-- > 0) {
    const type = cur.type;
    if (type && typeof type === "function") {
      const name = (type.displayName || type.name) as string | undefined;
      if (name && /^[A-Z]/.test(name) && name.length > 1 && !INTERNAL_COMPONENT_NAMES.has(name)) {
        rootFiber = cur;
        break;
      }
    }
    cur = cur.return;
  }

  const lines: string[] = [];
  renderFiber(rootFiber, 0, selectedFiber, lines, 8, { n: 0 });
  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderFiber(fiber: any, depth: number, selectedFiber: any, lines: string[], maxDepth: number, counter: { n: number }) {
  if (!fiber || depth > maxDepth || counter.n > 200) return;
  counter.n++;

  const pad = "  ".repeat(depth);
  const type = fiber.type;
  const props = (fiber.memoizedProps || {}) as Record<string, unknown>;
  const isSelected = fiber === selectedFiber;

  if (!type) {
    // Fragment / root — render children inline at the same depth
    let child = fiber.child;
    while (child) {
      renderFiber(child, depth, selectedFiber, lines, maxDepth, counter);
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
    tagName = ((type as any).displayName || "Anonymous") as string;
  } else {
    return;
  }

  // Build a concise attribute string
  const attrs: string[] = [];
  if (typeof props.className === "string") {
    const cls = props.className.length > 60 ? props.className.slice(0, 60) + "..." : props.className;
    attrs.push(`className="${cls}"`);
  }
  if (props.id) attrs.push(`id="${props.id}"`);
  if (typeof props.href === "string") attrs.push(`href="${props.href.slice(0, 40)}"`);
  if (typeof props.type === "string") attrs.push(`type="${props.type}"`);
  if (typeof props.placeholder === "string")
    attrs.push(`placeholder="${(props.placeholder as string).slice(0, 30)}"`);
  if (props.disabled === true) attrs.push("disabled");
  const attrsStr = attrs.length ? " " + attrs.join(" ") : "";

  const selectedMark = isSelected ? "  {/* <- SELECTED */}" : "";
  const textChildren =
    typeof props.children === "string" ? (props.children as string).trim().slice(0, 80) : null;

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
  while (child && sibCount < 25) {
    renderFiber(child, depth + 1, selectedFiber, lines, maxDepth, counter);
    child = child.sibling;
    sibCount++;
  }
  if (child) lines.push(`${pad}  {/* ...more */}`);
  lines.push(`${pad}</${tagName}>`);
}

// ─── File capture ─────────────────────────────────────────────────────────────

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
}

/**
 * Generate attachment files for a selected page element:
 * 1. An SVG screenshot — the element's HTML + embedded same-origin CSS rendered
 *    via SVG foreignObject. Saved directly as SVG to avoid canvas-taint issues
 *    that cause canvas.toBlob() to return null for foreignObject content.
 * 2. A Markdown details file with: page URL, React component chain, CSS selector,
 *    outerHTML, and a compact JSX ancestry path ending at the selected element.
 *
 * Both files share a common slug derived from the component name.
 */
export async function captureElementFiles(el: Element, info: PageElementInfo): Promise<File[]> {
  const slug = sanitizeLabel(info.component);
  const files: File[] = [];

  // Screenshot — try PNG first (works in Firefox), fall back to SVG (works everywhere)
  try {
    const screenshot = await captureElementScreenshot(el, slug);
    if (screenshot) files.push(screenshot);
  } catch {
    // ignore
  }

  // Text details
  const pageUrl = typeof window !== "undefined" ? window.location.href : "(unknown)";
  const chain = getReactComponentChain(el);
  const chainStr =
    chain.length
      ? chain.join(" > ") + ` > [${el.tagName.toLowerCase()}]`
      : el.tagName.toLowerCase();
  const sourceFile = getDataSourceFile(el);
  const fiberTree = generateFiberTreeText(el);

  const md = [
    `# Inspected Element: <${info.component}>`,
    "",
    "## Page",
    pageUrl,
    "",
    "## React Component Chain",
    chainStr,
    "",
    ...(sourceFile ? ["## Source File", sourceFile, ""] : []),
    "## CSS Selector",
    `\`${info.selector}\``,
    "",
    "## OuterHTML",
    "```html",
    info.html,
    "```",
    "",
    "## JSX Rendered",
    "(from nearest named component; depth capped at 8; selected element marked)",
    "```jsx",
    fiberTree,
    "```",
  ].join("\n");

  files.push(new File([md], `element-${slug}-details.md`, { type: "text/markdown" }));
  return files;
}

/**
 * Capture a PNG screenshot of the element using @zumer/snapdom, which inlines
 * all styles and resources and renders via SVG foreignObject + Canvas without
 * the cross-origin taint issues that plague a naive canvas approach.
 */
async function captureElementScreenshot(el: Element, slug: string): Promise<File | null> {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const blob = await snapdom.toBlob(el, {
    type: "png",
    scale: window.devicePixelRatio || 1,
    backgroundColor: "#111827",
    embedFonts: false, // skip remote font embedding to keep capture fast
    fast: true,
  });

  return new File([blob], `element-${slug}-screenshot.png`, { type: "image/png" });
}

// ─── HoverLabel ───────────────────────────────────────────────────────────────

function HoverLabel({ el, rect, componentRoot }: { el: Element; rect: DOMRect; componentRoot: Element | null }) {
  const component = getReactComponentName(el) || el.tagName.toLowerCase();
  const selector = getCssSelector(el, componentRoot);

  const labelH = 22;
  const gap = 3;
  // Stack two labels: blue (component) on top, green (selector) below.
  let topBlue = rect.top - labelH * 2 - gap * 2 - 4;
  if (topBlue < 4) topBlue = rect.bottom + 4;
  const topGreen = topBlue + labelH + gap;
  const left = Math.max(4, Math.min(rect.left, window.innerWidth - 320));

  return (
    <>
      {/* Blue label: nearest React component name */}
      <div
        data-primordia-inspector="label"
        style={{
          position: "fixed",
          top: topBlue,
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
      {/* Green label: element CSS path */}
      <div
        data-primordia-inspector="label"
        style={{
          position: "fixed",
          top: topGreen,
          left,
          zIndex: 9999,
          pointerEvents: "none",
          maxWidth: "90vw",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        className="px-2 py-0.5 rounded bg-green-700 text-white text-xs font-mono shadow-lg"
      >
        {selector}
      </div>
    </>
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
    const componentRoot = getComponentRootElement(el);
    const selector = getCssSelector(el, componentRoot);
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
  // Blue highlight: nearest React component's root DOM element (if distinct from hovered).
  const componentEl = hoveredEl ? getComponentRootElement(hoveredEl) : null;
  // Always show blue component rect (even when same element as hovered — creates nested outline).
  const componentRect = componentEl ? componentEl.getBoundingClientRect() : null;

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

      {/* Blue highlight box — nearest React component root */}
      {componentRect && (
        <div
          data-primordia-inspector="highlight-component"
          style={{
            position: "fixed",
            left: componentRect.left - 2, top: componentRect.top - 2,
            width: componentRect.width + 4, height: componentRect.height + 4,
            outline: "2px solid #3b82f6", outlineOffset: "0",
            background: "rgba(59, 130, 246, 0.05)",
            pointerEvents: "none", zIndex: 9996,
          }}
        />
      )}

      {/* Green highlight box — hovered element */}
      {rect && (
        <div
          data-primordia-inspector="highlight"
          style={{
            position: "fixed",
            left: rect.left - 1, top: rect.top - 1,
            width: rect.width + 2, height: rect.height + 2,
            outline: "2px solid #22c55e", outlineOffset: "0",
            background: "rgba(34, 197, 94, 0.08)",
            pointerEvents: "none", zIndex: 9997,
          }}
        />
      )}

      {/* Labels */}
      {hoveredEl && rect && <HoverLabel el={hoveredEl} rect={rect} componentRoot={componentEl} />}

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

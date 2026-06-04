export interface BranchGraphInputNode {
  name: string;
  parent: string | null;
  /** Lower values are older. Missing ages sort after known ages. */
  markerTimestamp: number | null;
}

export interface BranchGraphLayoutNode extends BranchGraphInputNode {
  row: number;
  column: number;
}

export interface BranchGraphMergeEdge {
  from: string;
  to: string;
}

function markerSort(a: BranchGraphInputNode, b: BranchGraphInputNode): number {
  const aTime = a.markerTimestamp ?? Number.POSITIVE_INFINITY;
  const bTime = b.markerTimestamp ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.name.localeCompare(b.name);
}

/**
 * Computes a simplified git-log-style branch-head layout.
 *
 * Rules:
 * - Current production and its direct parent chain form the column-0 spine.
 * - Each branch gets exactly one row.
 * - Non-spine children are emitted immediately above their parent.
 * - Child branches are one column to the right of their parent.
 * - Siblings are visited oldest-first by branch-marker timestamp so older
 *   branches stay closer to the spine in deterministic renderers.
 */
export function computeBranchGraphLayout(
  nodes: BranchGraphInputNode[],
  productionBranch: string,
): BranchGraphLayoutNode[] {
  if (nodes.length === 0) return [];

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const childrenByParent = new Map<string, BranchGraphInputNode[]>();

  for (const node of nodes) {
    if (!node.parent || !byName.has(node.parent)) continue;
    const siblings = childrenByParent.get(node.parent) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parent, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort(markerSort);
  }

  const productionNode = byName.get(productionBranch) ?? nodes.find((node) => !node.parent) ?? nodes[0]!;
  const spineNames = new Set<string>();
  const spine: BranchGraphInputNode[] = [];
  let cursor: BranchGraphInputNode | undefined = productionNode;
  while (cursor && !spineNames.has(cursor.name)) {
    spine.push(cursor);
    spineNames.add(cursor.name);
    cursor = cursor.parent ? byName.get(cursor.parent) : undefined;
  }

  const ordered: Array<{ node: BranchGraphInputNode; column: number }> = [];
  const emitted = new Set<string>();

  function emitSubtree(node: BranchGraphInputNode, column: number): void {
    const children = childrenByParent
      .get(node.name)
      ?.filter((child) => !spineNames.has(child.name) && !emitted.has(child.name)) ?? [];

    for (const child of children) {
      emitSubtree(child, column + 1);
    }

    if (!emitted.has(node.name)) {
      ordered.push({ node, column });
      emitted.add(node.name);
    }
  }

  for (const spineNode of spine) {
    const offSpineChildren = childrenByParent
      .get(spineNode.name)
      ?.filter((child) => !spineNames.has(child.name) && !emitted.has(child.name)) ?? [];

    for (const child of offSpineChildren) {
      emitSubtree(child, 1);
    }

    if (!emitted.has(spineNode.name)) {
      ordered.push({ node: spineNode, column: 0 });
      emitted.add(spineNode.name);
    }
  }

  for (const node of [...nodes].sort(markerSort)) {
    if (!emitted.has(node.name)) emitSubtree(node, 0);
  }

  return ordered.map(({ node, column }, row) => ({ ...node, row, column }));
}

export function renderBranchGraphAscii(layout: BranchGraphLayoutNode[]): string {
  if (layout.length === 0) return "(no branches)\n";

  const maxColumn = Math.max(...layout.map((node) => node.column));
  const lines = layout.map((node) => {
    const cells: string[] = [];
    for (let column = 0; column <= maxColumn; column += 1) {
      cells.push(column === node.column ? "*" : " ");
    }
    return `${cells.join("   ")}  ${node.name}`.trimEnd();
  });

  return `${lines.join("\n")}\n`;
}

function unicodeGraphPrefix(node: BranchGraphLayoutNode, maxColumn: number): string {
  const cells: string[] = [];
  for (let column = 0; column <= maxColumn; column += 1) {
    if (column === node.column) cells.push("●");
    else if (column < node.column) cells.push("│");
    else cells.push(" ");
  }
  return cells.join(" ");
}

function connectorLine(parentColumn: number, childColumn: number): string {
  if (parentColumn === childColumn) return "│";
  const left = Math.min(parentColumn, childColumn) * 2;
  const right = Math.max(parentColumn, childColumn) * 2;
  const chars = Array.from({ length: right + 1 }, () => " ");
  chars[parentColumn * 2] = "├";
  for (let index = parentColumn * 2 + 1; index < right; index += 1) {
    chars[index] = "─";
  }
  chars[childColumn * 2] = "╯";
  for (let column = 0; column < parentColumn; column += 1) {
    chars[column * 2] = "│";
  }
  if (left < parentColumn * 2) chars[left] = "│";
  return chars.join("");
}

function mergeHintLine(fromColumn: number, toColumn: number, maxColumn: number): string {
  const cells: string[] = [];
  const left = Math.min(fromColumn, toColumn);
  const right = Math.max(fromColumn, toColumn);
  for (let column = 0; column <= maxColumn; column += 1) {
    if (column === left) cells.push("│");
    else if (column > left && column <= right) cells.push("←╮");
    else cells.push(" ");
  }
  return cells.join("");
}

export function renderBranchGraphUnicode(
  layout: BranchGraphLayoutNode[],
  mergeEdges: BranchGraphMergeEdge[] = [],
  productionBranch?: string,
): string {
  if (layout.length === 0) return "(no branches)\n";

  const byName = new Map(layout.map((node) => [node.name, node]));
  const maxColumn = Math.max(...layout.map((node) => node.column));
  const lines: string[] = [];

  for (let index = 0; index < layout.length; index += 1) {
    const node = layout[index]!;
    const label = node.name === productionBranch ? `${node.name} (production)` : node.name;
    lines.push(`${unicodeGraphPrefix(node, maxColumn).trimEnd()} ${label}`.trimEnd());

    const next = layout[index + 1];
    if (!next) continue;

    const nextIsParent = node.parent === next.name;
    if (nextIsParent) {
      lines.push(connectorLine(next.column, node.column).trimEnd());
      continue;
    }

    const visibleMerge = mergeEdges.find((edge) => edge.to === next.name || edge.to === node.name);
    if (visibleMerge) {
      const from = byName.get(visibleMerge.from);
      const to = byName.get(visibleMerge.to);
      if (from && to) lines.push(mergeHintLine(from.column, to.column, maxColumn).trimEnd());
    } else if (next.column === node.column) {
      lines.push("│");
    }
  }

  lines.push("┴");
  return `${lines.join("\n")}\n`;
}

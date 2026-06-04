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

export type BranchGraphUnicodeRow =
  | { kind: "branch"; graph: string; branchName: string }
  | { kind: "connector"; graph: string };

function markerSort(a: BranchGraphInputNode, b: BranchGraphInputNode): number {
  const aTime = a.markerTimestamp ?? Number.POSITIVE_INFINITY;
  const bTime = b.markerTimestamp ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.name.localeCompare(b.name);
}

function newestMarkerSort(a: BranchGraphInputNode, b: BranchGraphInputNode): number {
  const aTime = a.markerTimestamp ?? Number.NEGATIVE_INFINITY;
  const bTime = b.markerTimestamp ?? Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return bTime - aTime;
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
 * - Unmerged siblings from the same parent are visited newest-first by
 *   branch-marker timestamp so newer branches sit above and closer to the spine.
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
    siblings.sort(newestMarkerSort);
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

    children.forEach((child, index) => {
      emitSubtree(child, column + 1 + index);
    });

    if (!emitted.has(node.name)) {
      ordered.push({ node, column });
      emitted.add(node.name);
    }
  }

  for (const spineNode of spine) {
    const offSpineChildren = childrenByParent
      .get(spineNode.name)
      ?.filter((child) => !spineNames.has(child.name) && !emitted.has(child.name)) ?? [];

    offSpineChildren.forEach((child, index) => {
      emitSubtree(child, 1 + index);
    });

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

function connectorLineForChildren(parentColumn: number, childColumns: number[]): string {
  const uniqueChildColumns = [...new Set(childColumns)].sort((a, b) => a - b);
  if (uniqueChildColumns.length === 0) return "│";
  if (uniqueChildColumns.length === 1 && uniqueChildColumns[0] === parentColumn) return "│";

  const right = Math.max(parentColumn, ...uniqueChildColumns) * 2;
  const chars = Array.from({ length: right + 1 }, () => " ");
  chars[parentColumn * 2] = "├";
  for (let index = parentColumn * 2 + 1; index < right; index += 1) {
    chars[index] = "─";
  }
  for (let column = 0; column < parentColumn; column += 1) {
    chars[column * 2] = "│";
  }
  uniqueChildColumns.forEach((column, index) => {
    chars[column * 2] = index === uniqueChildColumns.length - 1 ? "╯" : "┴";
  });
  return chars.join("");
}

function verticalLineForColumns(columns: number[]): string {
  const uniqueColumns = [...new Set(columns)].sort((a, b) => a - b);
  const right = Math.max(...uniqueColumns) * 2;
  const chars = Array.from({ length: right + 1 }, () => " ");
  for (const column of uniqueColumns) chars[column * 2] = "│";
  return chars.join("");
}

function mergeHintLine(fromColumn: number, toColumn: number): string {
  if (Math.abs(fromColumn - toColumn) === 1) return "│←┐";
  const left = Math.min(fromColumn, toColumn) * 2;
  const right = Math.max(fromColumn, toColumn) * 2;
  const chars = Array.from({ length: right + 2 }, () => " ");
  chars[left] = "│";
  chars[right] = "←";
  chars[right + 1] = "┐";
  return chars.join("");
}

export function computeBranchGraphUnicodeRows(
  layout: BranchGraphLayoutNode[],
  mergeEdges: BranchGraphMergeEdge[] = [],
): BranchGraphUnicodeRow[] {
  if (layout.length === 0) return [];

  const byName = new Map(layout.map((node) => [node.name, node]));
  const maxColumn = Math.max(...layout.map((node) => node.column));
  const rows: BranchGraphUnicodeRow[] = [];

  for (let index = 0; index < layout.length; index += 1) {
    const node = layout[index]!;
    rows.push({
      kind: "branch",
      graph: unicodeGraphPrefix(node, maxColumn).trimEnd(),
      branchName: node.name,
    });

    const next = layout[index + 1];
    if (!next) continue;

    const precedingChildren = layout
      .slice(0, index + 1)
      .filter((candidate) => candidate.parent === next.name && candidate.column !== next.column);
    if (precedingChildren.length > 0) {
      rows.push({
        kind: "connector",
        graph: connectorLineForChildren(
          next.column,
          precedingChildren.map((child) => child.column),
        ).trimEnd(),
      });
      continue;
    }

    const upcomingMerge = mergeEdges.find((edge) => edge.from === next.name);
    if (upcomingMerge) {
      const from = byName.get(upcomingMerge.from);
      const to = byName.get(upcomingMerge.to);
      if (from && to) rows.push({ kind: "connector", graph: mergeHintLine(from.column, to.column).trimEnd() });
    } else if (node.parent && node.parent === next.parent) {
      rows.push({ kind: "connector", graph: verticalLineForColumns([0, node.column]).trimEnd() });
    } else if (next.column === node.column) {
      rows.push({ kind: "connector", graph: "│" });
    }
  }

  rows.push({ kind: "connector", graph: "┴" });
  return rows;
}

export function renderBranchGraphUnicode(
  layout: BranchGraphLayoutNode[],
  mergeEdges: BranchGraphMergeEdge[] = [],
  productionBranch?: string,
): string {
  const rows = computeBranchGraphUnicodeRows(layout, mergeEdges);
  if (rows.length === 0) return "(no branches)\n";

  const lines = rows.map((row) => {
    if (row.kind === "connector") return row.graph;
    const label = row.branchName === productionBranch ? `${row.branchName} (production)` : row.branchName;
    return `${row.graph} ${label}`.trimEnd();
  });
  return `${lines.join("\n")}\n`;
}

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

function markerSort(a: BranchGraphInputNode, b: BranchGraphInputNode): number {
  const aTime = a.markerTimestamp ?? Number.POSITIVE_INFINITY;
  const bTime = b.markerTimestamp ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.name.localeCompare(b.name);
}

function occupiedKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * Computes a simplified git-log-style branch-head layout.
 *
 * Rules:
 * - Current production and its direct parent chain form the column-0 spine.
 * - Non-spine children sit one row above their parent.
 * - A child starts one column to the right of its parent; if that cell is full,
 *   the next open column to the right is used.
 * - Siblings are placed oldest-first by branch-marker timestamp so older
 *   branches stay closer to the spine.
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

  const layout = new Map<string, BranchGraphLayoutNode>();
  const occupied = new Set<string>();

  function place(node: BranchGraphInputNode, row: number, preferredColumn: number): BranchGraphLayoutNode {
    let column = Math.max(0, preferredColumn);
    while (occupied.has(occupiedKey(row, column))) column += 1;
    const placed = { ...node, row, column };
    layout.set(node.name, placed);
    occupied.add(occupiedKey(row, column));
    return placed;
  }

  let spineCursor: BranchGraphInputNode | undefined = byName.get(productionBranch) ?? nodes.find((node) => !node.parent) ?? nodes[0];
  let spineRow = 0;
  const spineNames = new Set<string>();
  while (spineCursor && !spineNames.has(spineCursor.name)) {
    spineNames.add(spineCursor.name);
    place(spineCursor, spineRow, 0);
    spineCursor = spineCursor.parent ? byName.get(spineCursor.parent) : undefined;
    spineRow += 1;
  }

  function placeChildren(parent: BranchGraphLayoutNode): void {
    const children = childrenByParent
      .get(parent.name)
      ?.filter((child) => !layout.has(child.name)) ?? [];

    for (const child of children) {
      const placed = place(child, parent.row - 1, parent.column + 1);
      placeChildren(placed);
    }
  }

  const spine = [...layout.values()].sort((a, b) => a.row - b.row);
  for (const spineNode of spine) placeChildren(spineNode);

  const remaining = nodes
    .filter((node) => !layout.has(node.name))
    .sort(markerSort);
  let rootRow = Math.max(0, ...[...layout.values()].map((node) => node.row)) + 1;
  for (const root of remaining) {
    if (layout.has(root.name)) continue;
    const placed = place(root, rootRow, 0);
    placeChildren(placed);
    rootRow += 1;
  }

  return [...layout.values()].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.column !== b.column) return a.column - b.column;
    return a.name.localeCompare(b.name);
  });
}

export function renderBranchGraphAscii(layout: BranchGraphLayoutNode[]): string {
  if (layout.length === 0) return "(no branches)\n";

  const byRow = new Map<number, BranchGraphLayoutNode[]>();
  for (const node of layout) {
    const row = byRow.get(node.row) ?? [];
    row.push(node);
    byRow.set(node.row, row);
  }

  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const maxColumn = Math.max(...layout.map((node) => node.column));
  const lines: string[] = [];

  for (const rowIndex of rows) {
    const rowNodes = (byRow.get(rowIndex) ?? []).sort((a, b) => a.column - b.column);
    const nodeByColumn = new Map(rowNodes.map((node) => [node.column, node]));
    const cells: string[] = [];
    for (let column = 0; column <= maxColumn; column += 1) {
      const node = nodeByColumn.get(column);
      cells.push(node ? "*" : " ");
    }
    const names = rowNodes.map((node) => node.name).join("  ");
    lines.push(`${cells.join("   ")}  ${names}`.trimEnd());
  }

  return `${lines.join("\n")}\n`;
}

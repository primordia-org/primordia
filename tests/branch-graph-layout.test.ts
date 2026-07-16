import { describe, expect, test } from 'bun:test';
import {
  computeBranchGraphUnicodeRows,
  renderBranchGraphAscii,
  type BranchGraphLayoutNode,
} from '@/lib/branch-graph-layout';

const layout: BranchGraphLayoutNode[] = [
  { name: 'production', parent: null, markerTimestamp: 1, row: 0, column: 0 },
  { name: 'feature', parent: 'production', markerTimestamp: 2, row: 1, column: 1 },
  { name: 'nested', parent: 'feature', markerTimestamp: 3, row: 2, column: 2 },
];

describe('branch graph merge rendering', () => {
  test('aligns adjacent merge hints with the merged branch column', () => {
    const rows = computeBranchGraphUnicodeRows(layout, [{ from: 'nested', to: 'feature' }]);

    expect(rows.map((row) => row.graph)).toEqual([
      '●',
      '│ ●',
      '│ │─←┐',
      '│ │ ●',
      '┴',
    ]);
  });

  test('includes merge hints in ASCII graph output', () => {
    expect(renderBranchGraphAscii(layout, [{ from: 'nested', to: 'feature' }], 'production')).toBe(
      '* production (production)\n' +
      '| * feature\n' +
      '| |-<\\\n' +
      '| | * nested\n' +
      '+\n',
    );
  });
});

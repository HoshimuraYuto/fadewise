import {
  constructTable,
  tableFeatures,
  rowSortingFeature,
  createSortedRowModel,
  sortFn_basic,
  sortFn_alphanumeric,
  columnFilteringFeature,
  globalFilteringFeature,
  createFilteredRowModel,
  filterFn_includesString,
  type ColumnDef,
  type SortingState,
} from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { currentKey } from '../shared/tempo-key.mts';
import { tempoOf, type RecordView } from './common.mts';
import { mixRank, type LooseRecord } from './mix-text.mts';

export interface LibraryRecord extends RecordView {
  videoId: string;
  mix?: LooseRecord['mix'];
  integratedLufs?: number | null;
  ytPerceptualLoudnessDb?: number | null;
  firstSoundSec?: number | null;
  firstSoundExact?: boolean;
  lastSoundSec?: number | null;
  durationSec?: number | null;
  coverage?: number | null;
  analysisCount?: number;
  updatedAt?: number | null;
  applied?: unknown;
  cells?: unknown;
}
export interface LibraryRow {
  r: LibraryRecord;
  off: boolean;
}

const features = tableFeatures({
  coreReactivityFeature: storeReactivityBindings(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

const camelotRank = (tk: unknown) => {
  const k = currentKey(tk);
  const m = typeof k?.camelot === 'string' ? /^(\d+)([AB])$/.exec(k.camelot) : null;

  return m ? +m[1] * 2 + (m[2] === 'B' ? 1 : 0) : undefined;
};

type Value = string | number | undefined;
const COLUMN_DEFS: [string, (d: LibraryRow) => Value, 'basic' | 'alphanumeric' | null][] = [
  ['exclude', (d) => (d.off ? 1 : 0), 'basic'],
  ['title', (d) => str(d.r.title), 'alphanumeric'],
  ['artist', (d) => str(d.r.artist), 'alphanumeric'],
  ['lufs', (d) => num(d.r.integratedLufs), 'basic'],
  ['duration', (d) => num(d.r.durationSec), 'basic'],
  ['bpm', (d) => num(tempoOf(d.r.tempoKey)?.bpm), 'basic'],
  ['key', (d) => camelotRank(d.r.tempoKey), 'basic'],
  ['ending', (d) => str(d.r.ending?.kind), 'alphanumeric'],
  ['mix', (d) => mixRank(d.r), 'basic'],
  ['updated', (d) => num(d.r.updatedAt), 'basic'],
];
const SEARCHED = new Set(['title', 'artist']);
// the artist is shown under the title, in the title's cell
const IN_TITLE_CELL = new Set(['artist']);
const columns: ColumnDef<typeof features, LibraryRow>[] = COLUMN_DEFS.map(([id, accessorFn, sortFn]) =>
  sortFn ? { id, accessorFn, sortFn, sortUndefined: 'last' } : { id, accessorFn, enableSorting: false },
);

function createLibraryTable() {
  let data: LibraryRow[] = [];
  const table = constructTable({
    features,
    columns,
    data,
    getRowId: (d) => d.r.videoId,
    globalFilterFn: 'includesString',
    getColumnCanGlobalFilter: (c) => SEARCHED.has(c.id),
    autoResetAll: false,
  });

  return {
    setData(next: LibraryRow[]): void {
      data = next;
      table.setOptions((o) => ({ ...o, data }));
    },
    setSearch(q: unknown): void {
      table.setGlobalFilter(typeof q === 'string' ? q.trim() : '');
    },
    // TanStack cycles: text asc / numbers desc first, then reversed, then unsorted.
    toggleSort(id: string): void {
      const c = table.getColumn(id);
      if (c?.getCanSort()) c.toggleSorting(undefined, false);
    },
    sortOf(id: string): false | 'asc' | 'desc' {
      return table.getColumn(id)?.getIsSorted() ?? false;
    },
    canSort(id: string): boolean {
      return !!table.getColumn(id)?.getCanSort();
    },
    sorting(): SortingState {
      return table.atoms.sorting.get();
    },
    rows(): LibraryRow[] {
      return table.getRowModel().rows.map((row) => row.original);
    },
    total(): number {
      return data.length;
    },
  };
}

const COLUMN_IDS = COLUMN_DEFS.map((c) => c[0]).filter((id) => !IN_TITLE_CELL.has(id));
export { createLibraryTable, COLUMN_IDS };

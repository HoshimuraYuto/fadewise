export type Pairs = [string, string | string[]][];
// [text, class, second line]
export type Cell = [string | number | null | undefined, string?, string?];
export interface Row {
  key: string;
  cells: Cell[];
  detail?: Pairs;
}
export interface SyncStats {
  added: number;
  removed: number;
  moved: number;
  cellsChanged: number;
}

function setText(e: Element, s: unknown): boolean {
  const v = String(s);
  if (e.textContent === v) return false;
  const f = e.firstChild;
  if (f && f === e.lastChild && f.nodeType === 3) (f as Text).data = v;
  else e.textContent = v;

  return true;
}

function setClass(e: Element, cls: string | undefined): void {
  const v = cls || '';
  if (e.className !== v) e.className = v;
}

function setValue(dd: Element, v: string | string[]): void {
  if (typeof v === 'string') {
    setText(dd, v);

    return;
  }

  const doc = dd.ownerDocument;
  const ul = doc.createElement('ul');
  ul.append(...v.map((s) => Object.assign(doc.createElement('li'), { textContent: s })));
  dd.replaceChildren(ul);
}

function setLines(td: Element, main: string, sub: string): boolean {
  const [a, b] = [td.children.item(0), td.children.item(1)];

  if (td.childElementCount === 2 && a?.className === 'main' && b?.className === 'sub') {
    return setText(a, main) || setText(b, sub);
  }

  const doc = td.ownerDocument;
  td.replaceChildren(
    Object.assign(doc.createElement('span'), { className: 'main', textContent: main }),
    Object.assign(doc.createElement('span'), { className: 'sub', textContent: sub }),
  );

  return true;
}

const SIG = new WeakMap<Element, string>();

function syncPairs(container: Element, pairs: Pairs | null, noneText: string): boolean {
  const doc = container.ownerDocument;
  const sig = JSON.stringify(pairs ? ['p', pairs] : ['n', noneText]);
  if (SIG.get(container) === sig) return false;
  SIG.set(container, sig);

  if (!pairs) {
    const only = container.childElementCount === 1 ? container.firstElementChild : null;

    if (only && only.tagName === 'DIV' && only.classList.contains('muted')) setText(only, noneText);
    else {
      const d = doc.createElement('div');
      d.className = 'muted';
      d.textContent = noneText;
      container.replaceChildren(d);
    }

    return true;
  }

  const first = container.firstElementChild;
  let dl = container.childElementCount === 1 && first?.tagName === 'DL' ? first : null;

  if (!dl) {
    dl = doc.createElement('dl');
    container.replaceChildren(dl);
  }

  const kids = dl.children;
  pairs.forEach(([term, value], i) => {
    let dt = kids.item(2 * i),
      dd = kids.item(2 * i + 1);

    if (!dt || !dd) {
      dt = doc.createElement('dt');
      dd = doc.createElement('dd');
      dl.append(dt, dd);
    }

    setText(dt, term);
    setValue(dd, value);
  });
  while (dl.children.length > pairs.length * 2) dl.lastElementChild?.remove();

  return true;
}

function cellOf(tr: HTMLTableRowElement, i: number): HTMLTableCellElement {
  const td = tr.children.item(i) as HTMLTableCellElement | null;
  if (td) return td;

  return tr.appendChild(tr.ownerDocument.createElement('td'));
}

function syncCells(tr: HTMLTableRowElement, r: Row & { empty?: boolean; text?: string }, span: number): number {
  let changed = 0;
  setClass(tr, r.detail ? 'detail' : undefined);

  if (r.detail) {
    setClass(cellOf(tr, 0), 'pad');
    const td = cellOf(tr, 1);
    td.colSpan = span - 1;
    if (syncPairs(td, r.detail, '')) changed++;
    while (tr.children.length > 2) tr.lastElementChild?.remove();

    return changed;
  }

  const cells: Cell[] = r.empty ? [[r.text, 'muted']] : r.cells;
  cells.forEach(([text, cls, sub], i) => {
    const td = cellOf(tr, i);
    if (sub === undefined ? setText(td, text ?? '') : setLines(td, String(text ?? ''), sub)) changed++;
    setClass(td, cls);
    td.colSpan = r.empty ? span : 1;
  });
  while (tr.children.length > cells.length) tr.lastElementChild?.remove();

  return changed;
}

function syncRows(tbody: HTMLElement, rows: Row[], empty: { text: string; colSpan: number }): SyncStats {
  const doc = tbody.ownerDocument;
  const stats = { added: 0, removed: 0, moved: 0, cellsChanged: 0 };
  const byKey = new Map<string, HTMLTableRowElement>();

  for (const tr of [...tbody.children] as HTMLTableRowElement[]) {
    const k = tr.dataset.key;

    if (k !== undefined && !byKey.has(k)) byKey.set(k, tr);
    else {
      tr.remove();
      stats.removed++;
    }
  }

  const wanted: (Row & { empty?: boolean; text?: string })[] = rows.length
    ? rows
    : [{ key: '', cells: [], empty: true, text: empty.text }];
  const keep = new Set(wanted.map((r) => r.key));

  for (const [k, tr] of byKey)
    if (!keep.has(k)) {
      tr.remove();
      byKey.delete(k);
      stats.removed++;
    }

  let prev: Element | null = null;

  for (const r of wanted) {
    let tr = byKey.get(r.key);

    if (!tr) {
      tr = doc.createElement('tr');
      tr.dataset.key = r.key;
      stats.added++;
    }

    stats.cellsChanged += syncCells(tr, r, empty.colSpan);
    const want: Element | null = prev ? prev.nextElementSibling : tbody.firstElementChild;

    if (want !== tr) {
      if (tr.parentNode) stats.moved++;
      tbody.insertBefore(tr, want);
    }

    prev = tr;
  }

  return stats;
}

function deferredRender(render: () => unknown, delayMs: number, doc?: Document): () => void {
  const d = doc ?? document;
  let timer: ReturnType<typeof setTimeout> | null = null,
    pending = false;

  const run = () => {
    timer = null;

    if (d.visibilityState === 'hidden') {
      pending = true;

      return;
    }

    pending = false;
    render();
  };

  d.addEventListener('visibilitychange', () => {
    if (d.visibilityState !== 'hidden' && pending && !timer) run();
  });

  return () => {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
}

function whileVisible(tick: () => unknown, periodMs: number, doc?: Document): ReturnType<typeof setInterval> {
  const d = doc ?? document;
  d.addEventListener('visibilitychange', () => {
    if (d.visibilityState !== 'hidden') tick();
  });

  return setInterval(() => {
    if (d.visibilityState !== 'hidden') tick();
  }, periodMs);
}

export { setText, syncPairs, syncRows, deferredRender, whileVisible };

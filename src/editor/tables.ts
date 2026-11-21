// Tables (spec 04, 4.7; 06, 6.2 TSV paste).
//
// Operations read the table into a grid (row attributes + cell nodes), change it, and
// write it back as one step. Row attributes travel with their rows, so rows whose cells
// did not change keep their exact source unless the table is re-padded (R-7).

import { Fragment, type Node } from "prosemirror-model";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { buildTable, freshUid, schema, tableRows } from "../md/schema";
import { serialize } from "../md/serialize";

const S = schema.nodes;

interface Grid {
  pos: number;
  table: Node;
  rows: { attrs: Record<string, unknown>; cells: Node[] }[];
  align: (string | null)[];
}

interface CellAt {
  grid: Grid;
  row: number;
  col: number;
  /** offset of the cursor inside the cell */
  offset: number;
}

export function cellAt(state: EditorState): CellAt | null {
  const { $head } = state.selection;
  if ($head.parent.type !== S.table_cell) return null;
  let d = $head.depth;
  while (d > 0 && $head.node(d).type !== S.table) d--;
  if (d === 0) return null;
  const table = $head.node(d);
  const grid = readGrid(table, $head.before(d));
  const rowNode = $head.node($head.depth - 1);
  const row = tableRows(table).indexOf(rowNode);
  const col = $head.index($head.depth - 1);
  return { grid, row, col, offset: $head.parentOffset };
}

export function readGrid(table: Node, pos: number): Grid {
  const rows = tableRows(table).map((r) => {
    const cells: Node[] = [];
    r.forEach((c) => cells.push(c));
    return { attrs: { ...r.attrs }, cells };
  });
  const cols = Math.max(table.attrs.align.length, ...rows.map((r) => r.cells.length));
  for (const [i, r] of rows.entries()) while (r.cells.length < cols) r.cells.push(S.table_cell.create({ header: i === 0 }));
  const align = Array.from({ length: cols }, (_, j) => table.attrs.align[j] ?? null);
  return { pos, table, rows, align };
}

function emptyCell(header: boolean) {
  return S.table_cell.create({ header });
}

/** Replace the table with the grid's content; put the cursor in cell (row, col). */
function writeGrid(tr: Transaction, grid: Grid, row: number, col: number, offset = 0): Transaction {
  const rows = grid.rows.map((r, i) =>
    S.table_row.create(
      i === 0 ? r.attrs : { ...r.attrs },
      r.cells.map((c) => (c.attrs.header === (i === 0) ? c : S.table_cell.create({ header: i === 0 }, c.content))),
    ),
  );
  const table = buildTable({ ...grid.table.attrs, align: grid.align }, rows);
  tr.replaceWith(grid.pos, grid.pos + grid.table.nodeSize, table);
  const target = cellPos(tr.doc.nodeAt(grid.pos)!, grid.pos, Math.max(0, Math.min(row, rows.length - 1)), Math.max(0, Math.min(col, grid.align.length - 1)));
  const cell = tr.doc.nodeAt(target - 1)!;
  return tr.setSelection(TextSelection.create(tr.doc, target + Math.min(offset, cell.content.size)));
}

/** Position of the content start of cell (row, col) in a table at `pos`. */
export function cellPos(table: Node, pos: number, row: number, col: number): number {
  let r = -1;
  let found = -1;
  table.descendants((n, p) => {
    if (found >= 0) return false;
    if (n.type === S.table_row) {
      r++;
      if (r !== row) return false;
      let c = 0;
      n.forEach((_cell, off) => {
        if (c++ === col && found < 0) found = pos + 1 + p + 1 + off + 1;
      });
      return false;
    }
    return true;
  });
  return found;
}

function newRow(cols: number): { attrs: Record<string, unknown>; cells: Node[] } {
  return { attrs: { src: null, cells: null, term: null, prefix: null }, cells: Array.from({ length: cols }, () => emptyCell(false)) };
}

function op(f: (at: CellAt, dispatch: (tr: Transaction) => void, state: EditorState) => boolean): Command {
  return (state, dispatch) => {
    const at = cellAt(state);
    if (!at) return false;
    return f(at, dispatch ?? (() => {}), state);
  };
}

/** Tab / Shift+Tab: next / previous cell; Tab in the last cell adds a row (4.7). */
export const nextCell = (dir: 1 | -1): Command =>
  op((at, dispatch, state) => {
    const cols = at.grid.align.length;
    let r = at.row;
    let c = at.col + dir;
    if (c >= cols) {
      c = 0;
      r++;
    } else if (c < 0) {
      c = cols - 1;
      r--;
    }
    if (r < 0) return true;
    if (r >= at.grid.rows.length) {
      at.grid.rows.push(newRow(cols));
      dispatch(writeGrid(state.tr, at.grid, r, 0));
      return true;
    }
    const target = cellPos(at.grid.table, at.grid.pos, r, c);
    const cell = state.doc.nodeAt(target - 1)!;
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, target, target + cell.content.size)));
    return true;
  });

/** Enter: same column in the next row; in the last row a new row (4.7). */
export const cellEnter = op((at, dispatch, state) => {
  if (at.row + 1 >= at.grid.rows.length) {
    at.grid.rows.push(newRow(at.grid.align.length));
    dispatch(writeGrid(state.tr, at.grid, at.row + 1, at.col));
  } else {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, cellPos(at.grid.table, at.grid.pos, at.row + 1, at.col))));
  }
  return true;
});

/** Mod+Enter: insert a row below and move to it. */
export const insertRowBelow = op((at, dispatch, state) => {
  at.grid.rows.splice(at.row + 1, 0, newRow(at.grid.align.length));
  dispatch(writeGrid(state.tr, at.grid, at.row + 1, at.col));
  return true;
});

export const insertRowAbove = op((at, dispatch, state) => {
  if (at.row === 0) return true; // the header stays first
  at.grid.rows.splice(at.row, 0, newRow(at.grid.align.length));
  dispatch(writeGrid(state.tr, at.grid, at.row, at.col));
  return true;
});

/** Shift+Enter in a cell: a line break, written as `<br>` (3.4). */
export const cellBreak = op((_at, dispatch, state) => {
  dispatch(state.tr.insertText("<br>"));
  return true;
});

/** Mod+Shift+Backspace / delete row. The header row deletes the table if it is alone. */
export function deleteRow(confirmDeleteTable: () => boolean): Command {
  return op((at, dispatch, state) => {
    if (at.row === 0) {
      if (at.grid.rows.length === 1 && confirmDeleteTable()) dispatch(deleteTableTr(state, at.grid));
      return true;
    }
    at.grid.rows.splice(at.row, 1);
    dispatch(writeGrid(state.tr, at.grid, Math.min(at.row, at.grid.rows.length - 1), at.col));
    return true;
  });
}

function deleteTableTr(state: EditorState, grid: Grid): Transaction {
  const tr = state.tr.replaceWith(grid.pos, grid.pos + grid.table.nodeSize, S.paragraph.create({ uid: freshUid() }));
  return tr.setSelection(TextSelection.create(tr.doc, grid.pos + 1));
}

export const deleteTable = op((at, dispatch, state) => {
  dispatch(deleteTableTr(state, at.grid));
  return true;
});

/** Alt+Up / Alt+Down: move the row (body rows only; the header stays). */
export const moveRow = (dir: -1 | 1): Command =>
  op((at, dispatch, state) => {
    const to = at.row + dir;
    if (at.row === 0 || to < 1 || to >= at.grid.rows.length) return true;
    const [r] = at.grid.rows.splice(at.row, 1);
    at.grid.rows.splice(to, 0, r);
    dispatch(writeGrid(state.tr, at.grid, to, at.col, at.offset));
    return true;
  });

/** Alt+Left / Alt+Right: move the column. */
export const moveColumn = (dir: -1 | 1): Command =>
  op((at, dispatch, state) => {
    const to = at.col + dir;
    if (to < 0 || to >= at.grid.align.length) return true;
    for (const r of at.grid.rows) {
      const [c] = r.cells.splice(at.col, 1);
      r.cells.splice(to, 0, c);
    }
    const [a] = at.grid.align.splice(at.col, 1);
    at.grid.align.splice(to, 0, a);
    dispatch(writeGrid(state.tr, at.grid, at.row, to, at.offset));
    return true;
  });

export const insertColumn = (side: -1 | 1): Command =>
  op((at, dispatch, state) => {
    const at2 = side < 0 ? at.col : at.col + 1;
    at.grid.rows.forEach((r, i) => r.cells.splice(at2, 0, emptyCell(i === 0)));
    at.grid.align.splice(at2, 0, null);
    dispatch(writeGrid(state.tr, at.grid, at.row, at2));
    return true;
  });

export const deleteColumn = op((at, dispatch, state) => {
  if (at.grid.align.length === 1) {
    dispatch(deleteTableTr(state, at.grid));
    return true;
  }
  for (const r of at.grid.rows) r.cells.splice(at.col, 1);
  at.grid.align.splice(at.col, 1);
  dispatch(writeGrid(state.tr, at.grid, at.row, Math.min(at.col, at.grid.align.length - 1)));
  return true;
});

export const setAlign = (align: string | null): Command =>
  op((at, dispatch, state) => {
    at.grid.align[at.col] = at.grid.align[at.col] === align ? null : align;
    dispatch(writeGrid(state.tr, at.grid, at.row, at.col, at.offset));
    return true;
  });

/** Resize to rows × cols (rows include the header). */
export const resizeTable = (rows: number, cols: number): Command =>
  op((at, dispatch, state) => {
    const g = at.grid;
    while (g.rows.length < rows) g.rows.push(newRow(g.align.length));
    g.rows.length = Math.max(1, rows);
    for (const [i, r] of g.rows.entries()) {
      while (r.cells.length < cols) r.cells.push(emptyCell(i === 0));
      r.cells.length = Math.max(1, cols);
    }
    while (g.align.length < cols) g.align.push(null);
    g.align.length = Math.max(1, cols);
    dispatch(writeGrid(state.tr, g, Math.min(at.row, rows - 1), Math.min(at.col, cols - 1)));
    return true;
  });

/** Format table source: re-pad every row on the next save. */
export const formatTable = op((at, dispatch, state) => {
  for (const r of at.grid.rows) r.attrs = { ...r.attrs, cells: null };
  dispatch(writeGrid(state.tr, at.grid, at.row, at.col, at.offset));
  return true;
});

/** The table as Markdown, for "Copy table as Markdown". */
export function tableMarkdown(state: EditorState, pretty = true): string | null {
  const at = cellAt(state);
  if (!at) return null;
  const doc = schema.topNodeType.create({ ...state.doc.attrs, tail: null, lastUid: null, finalNewline: false }, [
    S.table.create({ ...at.grid.table.attrs, sep: null, prev: null, lead: null, sig: null }, at.grid.table.content),
  ]);
  return serialize(doc, { prettyTables: pretty });
}

/** Typing `|` in a cell writes `\|` (4.7). */
export function cellTextInput(state: EditorState, from: number, to: number, text: string, dispatch: (tr: Transaction) => void): boolean {
  if (!text.includes("|") || state.doc.resolve(from).parent.type !== S.table_cell) return false;
  dispatch(state.tr.insertText(text.replace(/\|/g, "\\|"), from, to));
  return true;
}

// ---- paste (6.2) ---------------------------------------------------------------------

/** A tab-separated grid (from a spreadsheet), or null. */
export function parseTsv(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (!lines.some((l) => l.includes("\t"))) return null;
  return lines.map((l) => l.split("\t").map((c) => c.trim().replace(/\|/g, "\\|")));
}

/** Paste a TSV grid: fill cells rightward and downward from the cursor cell, growing the
 * table; outside a table, insert a new table (C-4). */
export function pasteGrid(view: EditorView, grid: string[][]): boolean {
  const { state } = view;
  const at = cellAt(state);
  if (at) {
    const g = at.grid;
    const needRows = at.row + grid.length;
    const needCols = at.col + Math.max(...grid.map((r) => r.length));
    while (g.rows.length < needRows) g.rows.push(newRow(g.align.length));
    for (const [i, r] of g.rows.entries()) while (r.cells.length < needCols) r.cells.push(emptyCell(i === 0));
    while (g.align.length < needCols) g.align.push(null);
    grid.forEach((cells, i) =>
      cells.forEach((text, j) => {
        g.rows[at.row + i].cells[at.col + j] = S.table_cell.create({ header: at.row + i === 0 }, text ? schema.text(text) : null);
      }),
    );
    view.dispatch(writeGrid(state.tr, g, at.row, at.col).scrollIntoView());
    return true;
  }
  const cols = Math.max(...grid.map((r) => r.length));
  const rows = grid.map((cells, i) =>
    S.table_row.create(
      null,
      Array.from({ length: cols }, (_, j) => S.table_cell.create({ header: i === 0 }, cells[j] ? schema.text(cells[j]) : null)),
    ),
  );
  if (rows.length === 1) rows.push(S.table_row.create(null, Array.from({ length: cols }, () => emptyCell(false))));
  const table = buildTable({ uid: freshUid(), align: Array(cols).fill(null), origAlign: null, delim: null }, rows);
  const tr = state.tr.replaceSelectionWith(table);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Multi-line text pasted into a cell: one line, joined with `<br>` (6.2). */
export function pasteIntoCell(view: EditorView, text: string): boolean {
  if (view.state.selection.$from.parent.type !== S.table_cell) return false;
  const joined = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n").join("<br>").replace(/\|/g, "\\|");
  view.dispatch(view.state.tr.insertText(joined).scrollIntoView());
  return true;
}

/** Mod+T: insert a table of `rows` (including header) × `cols` after the current block. */
export function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => {
    const headers = Array.from({ length: cols }, () => "");
    const rowNodes = [S.table_row.create(null, headers.map(() => emptyCell(true)))];
    for (let i = 1; i < Math.max(2, rows); i++) rowNodes.push(S.table_row.create(null, headers.map(() => emptyCell(false))));
    const table = buildTable({ uid: freshUid(), align: Array(cols).fill(null), origAlign: null, delim: null }, rowNodes);
    const { $from } = state.selection;
    const depth = Math.max(1, $from.depth - ($from.parent.isTextblock ? 0 : 0));
    const after = $from.after(Math.min(depth, $from.depth));
    if (dispatch) {
      const empty = $from.parent.type === S.paragraph && $from.parent.content.size === 0;
      const at = empty ? $from.before() : after;
      const tr = empty ? state.tr.replaceWith(at, at + $from.parent.nodeSize, table) : state.tr.insert(at, table);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, cellPos(tr.doc.nodeAt(at)!, at, 0, 0))).scrollIntoView());
    }
    return true;
  };
}

// ---- toolbar ---------------------------------------------------------------------------

export interface TableHooks {
  copyText(text: string): void;
  confirm(message: string): boolean;
  prettyTables(): boolean;
}

class TableToolbar {
  dom: HTMLDivElement;
  private menu: HTMLDivElement;
  private picker: HTMLDivElement;

  constructor(private view: EditorView, private hooks: TableHooks) {
    this.dom = document.createElement("div");
    this.dom.className = "md-table-toolbar";
    this.dom.hidden = true;
    const button = (label: string, title: string, run: () => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.className = cls;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        run();
      });
      this.dom.appendChild(b);
      return b;
    };
    this.picker = document.createElement("div");
    this.picker.className = "md-table-size-picker";
    this.picker.hidden = true;
    this.menu = document.createElement("div");
    this.menu.className = "md-table-menu";
    this.menu.hidden = true;
    button("▦", "Resize table", () => this.togglePicker(), "md-table-size");
    button("⇤", "Align left", () => this.run(setAlign("left")), "md-table-align-left");
    button("↔", "Align center", () => this.run(setAlign("center")), "md-table-align-center");
    button("⇥", "Align right", () => this.run(setAlign("right")), "md-table-align-right");
    button("⋯", "More", () => this.toggleMenu(), "md-table-more");
    this.dom.append(this.picker, this.menu);
    const items: [string, () => void][] = [
      ["Insert Row Above", () => this.run(insertRowAbove)],
      ["Insert Row Below", () => this.run(insertRowBelow)],
      ["Insert Column Left", () => this.run(insertColumn(-1))],
      ["Insert Column Right", () => this.run(insertColumn(1))],
      ["Delete Row", () => this.run(deleteRow(() => this.hooks.confirm("Delete this table?")))],
      ["Delete Column", () => this.run(deleteColumn)],
      ["Move Row Up", () => this.run(moveRow(-1))],
      ["Move Row Down", () => this.run(moveRow(1))],
      ["Move Column Left", () => this.run(moveColumn(-1))],
      ["Move Column Right", () => this.run(moveColumn(1))],
      ["Copy Table as Markdown", () => {
        const md = tableMarkdown(this.view.state, this.hooks.prettyTables());
        if (md !== null) this.hooks.copyText(md);
      }],
      ["Format Table Source", () => this.run(formatTable)],
      ["Delete Table", () => this.run(deleteTable)],
    ];
    for (const [label, run] of items) {
      const row = document.createElement("div");
      row.className = "md-table-menu-item";
      row.textContent = label;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.menu.hidden = true;
        run();
      });
      this.menu.appendChild(row);
    }
    for (let r = 1; r <= 8; r++)
      for (let c = 1; c <= 8; c++) {
        const cell = document.createElement("span");
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        this.picker.appendChild(cell);
      }
    this.picker.addEventListener("mouseover", (e) => {
      const t = e.target as HTMLElement;
      const r = Number(t.dataset.r);
      const c = Number(t.dataset.c);
      if (!r) return;
      this.picker.querySelectorAll<HTMLElement>("span").forEach((s) =>
        s.classList.toggle("on", Number(s.dataset.r) <= r && Number(s.dataset.c) <= c),
      );
      this.picker.title = `${r} × ${c}`;
    });
    this.picker.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      e.preventDefault();
      if (!t.dataset.r) return;
      this.picker.hidden = true;
      this.run(resizeTable(Number(t.dataset.r), Number(t.dataset.c)));
    });
    document.body.appendChild(this.dom);
  }

  private run(cmd: Command) {
    cmd(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
  }

  private togglePicker() {
    this.menu.hidden = true;
    this.picker.hidden = !this.picker.hidden;
  }

  private toggleMenu() {
    this.picker.hidden = true;
    this.menu.hidden = !this.menu.hidden;
  }

  update(view: EditorView) {
    this.view = view;
    const at = cellAt(view.state);
    if (!at) {
      this.dom.hidden = true;
      this.menu.hidden = true;
      this.picker.hidden = true;
      return;
    }
    const dom = view.nodeDOM(at.grid.pos);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    this.dom.style.left = `${r.left}px`;
    this.dom.style.top = `${Math.max(0, r.top - 30)}px`;
    this.dom.hidden = false;
    const align = at.grid.align[at.col];
    for (const a of ["left", "center", "right"]) this.dom.querySelector(`.md-table-align-${a}`)!.classList.toggle("active", align === a);
  }

  destroy() {
    this.dom.remove();
  }
}

export function createTablePlugin(hooks: TableHooks): Plugin {
  return new Plugin({
    view: (view) => new TableToolbar(view, hooks),
  });
}

/** Cell texts of a table, row by row (tests). */
export function cellTexts(table: Node): string[][] {
  return tableRows(table).map((r) => {
    const out: string[] = [];
    r.forEach((c) => out.push(c.textContent));
    return out;
  });
}

void Fragment;

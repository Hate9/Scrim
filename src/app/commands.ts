// Command table: ids, default keys (spec 12), and what they do.

import {
  clearFormat,
  deleteWord,
  indent,
  insertLink,
  isUrl,
  moveBlock,
  outdent,
  selectLine,
  selectScope,
  selectWord,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleFormat,
  toggleOrderedList,
  toggleQuote,
} from "../editor/commands";
import { insertFootnote, toggleTask } from "../editor/blocks";
import { chainCommands } from "prosemirror-commands";
import { insertTable, moveColumn, moveRow } from "../editor/tables";
import { zoomImage } from "../editor/images";
import type { Editor } from "../editor/editor";
import type { CommandDef } from "../editor/keys";
import { ipc } from "../ipc";

export interface AppHooks {
  save(saveAs: boolean): Promise<boolean>;
  /** Insert Image (Mod+Shift+I). */
  insertImage(): Promise<void>;
  /** Mod+T dialog (4.7): rows (including the header) and columns, or null. */
  askTableSize(): Promise<{ rows: number; cols: number } | null>;
  isWindows: boolean;
}

export function createCommands(editor: Editor, app: AppHooks): CommandDef[] {
  const o = editor.options;
  const doc = (id: string, key: string, fn: Parameters<Editor["run"]>[0]): CommandDef => ({
    id,
    key,
    scope: "document",
    run: () => editor.run(fn),
  });
  const cmds: CommandDef[] = [
    { id: "file.new", key: "Ctrl+N", scope: "global", run: () => ipc.newDoc(false) },
    { id: "file.newWindow", key: "Ctrl+Shift+N", scope: "global", run: () => ipc.newDoc(true) },
    { id: "file.open", key: "Ctrl+O", scope: "global", run: () => ipc.openDialog() },
    { id: "file.save", key: "Ctrl+S", scope: "global", run: () => app.save(false) },
    { id: "file.saveAs", key: "Ctrl+Shift+S", scope: "global", run: () => app.save(true) },
    doc("format.strong", "Ctrl+B", toggleFormat("strong", o)),
    doc("format.em", "Ctrl+I", toggleFormat("em", o)),
    doc("format.underline", "Ctrl+U", toggleFormat("underline", o)),
    doc("format.code", "Ctrl+Shift+`", toggleFormat("code", o)),
    doc("format.strike", "Alt+Shift+5", toggleFormat("strike", o)),
    doc("format.clear", "Ctrl+\\", clearFormat(o)),
    { id: "format.image.insert", key: "Ctrl+Shift+I", scope: "document", run: () => app.insertImage() },
    ...[25, 33, 50, 67, 80, 100, 150, 200].map((n) => doc(`format.image.zoom${n}`, "", zoomImage(n, o))),
    doc("format.image.originalSize", "", zoomImage(null, o)),
    {
      id: "format.link",
      key: "Ctrl+K",
      scope: "document",
      run: async () => {
        let text: string | null = null;
        if (!editor.view.state.selection.empty) {
          try {
            text = await ipc.clipboardText();
          } catch {
            text = null;
          }
        }
        editor.run(insertLink(text && isUrl(text) ? text.trim() : null));
      },
    },
    doc("para.paragraph", "Ctrl+0", setHeading(0)),
    ...[1, 2, 3, 4, 5, 6].map((n) => doc(`para.h${n}`, `Ctrl+${n}`, setHeading(n))),
    doc("para.increaseHeading", "Ctrl+=", shiftHeading(1)),
    doc("para.decreaseHeading", "Ctrl+-", shiftHeading(-1)),
    doc("para.quote", "Ctrl+Shift+Q", toggleQuote),
    doc("para.orderedList", "Ctrl+Shift+[", toggleOrderedList),
    doc("para.bulletList", "Ctrl+Shift+]", toggleBulletList),
    doc("para.taskList", "Ctrl+Shift+X", toggleTask),
    doc("format.footnote", "", insertFootnote),
    doc("para.indent", "Ctrl+]", indent),
    doc("para.outdent", "Ctrl+[", outdent),
    doc("para.moveUp", "Alt+Up", chainCommands(moveRow(-1), moveBlock(-1))),
    doc("para.moveDown", "Alt+Down", chainCommands(moveRow(1), moveBlock(1))),
    doc("table.moveColumnLeft", "Alt+Left", moveColumn(-1)),
    doc("table.moveColumnRight", "Alt+Right", moveColumn(1)),
    {
      id: "para.table",
      key: "Ctrl+T",
      scope: "document",
      run: async () => {
        const size = await app.askTableSize();
        if (size) editor.run(insertTable(size.rows, size.cols));
        editor.view.focus();
      },
    },
    doc("edit.selectLine", "Ctrl+L", selectLine),
    doc("edit.selectScope", "Ctrl+E", selectScope(o)),
    doc("edit.selectWord", "Ctrl+D", selectWord),
    doc("edit.deleteWord", "Ctrl+Shift+D", deleteWord),
    { id: "edit.copyMarkdown", key: "Ctrl+Shift+C", scope: "document", run: () => editor.copyAs("markdown") },
    { id: "edit.copyPlain", key: "", scope: "document", run: () => editor.copyAs("plain") },
    {
      id: "edit.jumpToSelection",
      key: "Ctrl+J",
      scope: "document",
      run: () => editor.view.dispatch(editor.view.state.tr.scrollIntoView()),
    },
  ];
  void app.isWindows;
  return cmds;
}

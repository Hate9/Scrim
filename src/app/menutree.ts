// The menu bar's contents (spec 12): labels, command ids, and toggles.

import type { MenuNode } from "./menu";
import { SEP } from "./menu";
import type { ThemeInfo } from "../ipc";
import { PANDOC_FORMATS } from "../export/exporter";

export interface MenuContext {
  isWindows: boolean;
  recent: () => { files: string[]; folders: string[] };
  openRecent: (path: string, folder: boolean) => void;
  clearRecent: () => void;
  themes: () => ThemeInfo[];
  currentTheme: () => string;
  setTheme: (id: string) => void;
  checked: (id: string) => boolean;
  debugging: () => boolean;
  hasPath: () => boolean;
  /** pandoc found (9.4); formats are listed but disabled without it */
  pandoc: () => boolean;
  /** custom export commands from Export Settings (9.5) */
  customExports: () => string[];
  runCustomExport: (name: string) => void;
  pandocHelp: () => void;
  /** spell check languages (13); empty when none is installed */
  spellLanguages: () => string[];
  spellLanguage: () => string;
  setSpellLanguage: (lang: string) => void;
  /** snippets in list order (16): label and command id */
  snippets: () => { label: string; id: string }[];
}

const item = (label: string, id: string, extra: Partial<MenuNode> = {}): MenuNode => ({ label, id, ...extra });
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function menuTree(c: MenuContext): MenuNode[] {
  const toggle = (label: string, id: string) => item(label, id, { checked: () => c.checked(id) });
  return [
    {
      label: "&File",
      children: [
        item("New", "file.new"),
        item("New Window", "file.newWindow"),
        SEP,
        item("Open…", "file.open"),
        item("Open Folder…", "file.openFolder"),
        item("Quick Open…", "file.quickOpen"),
        {
          label: "Open Recent",
          children: () => {
            const r = c.recent();
            const files = r.files.slice(0, 20).map((f) => ({ label: `${basename(f)}  —  ${f}`, run: () => c.openRecent(f, false) }));
            const folders = r.folders.slice(0, 10).map((f) => ({ label: `${basename(f)}/  —  ${f}`, run: () => c.openRecent(f, true) }));
            const none: MenuNode[] = files.length || folders.length ? [] : [{ label: "No Recent Files", enabled: () => false }];
            return [...files, ...(files.length && folders.length ? [SEP] : []), ...folders, ...none, SEP, { label: "Clear", run: c.clearRecent }];
          },
        },
        item("Reveal in Folder", "file.revealInFolder", { enabled: c.hasPath }),
        SEP,
        item("Save", "file.save"),
        item("Save As…", "file.saveAs"),
        item("Rename…", "file.rename", { enabled: c.hasPath }),
        item("Move To…", "file.moveTo", { enabled: c.hasPath }),
        item("Delete", "file.delete", { enabled: c.hasPath }),
        SEP,
        item("Import…", "file.import"),
        {
          label: "Export",
          // 09: PDF, HTML, HTML (without styles), pandoc formats, custom commands, then
          // Export with Previous and Export Settings.
          children: () => [
            item("PDF", "file.exportPdf"),
            item("HTML", "file.exportHtml"),
            item("HTML (without styles)", "file.exportHtmlPlain"),
            SEP,
            ...PANDOC_FORMATS.map((f) => item(f.label, `file.export.${f.id}`, { enabled: c.pandoc })),
            ...(c.pandoc() ? [] : [{ label: "Requires pandoc", enabled: () => false }, { label: "How to install pandoc…", run: c.pandocHelp }]),
            ...(c.customExports().length ? [SEP, ...c.customExports().map((name) => ({ label: name, run: () => c.runCustomExport(name) }))] : []),
            SEP,
            item("Export with Previous", "file.exportPrevious"),
            item("Export Settings…", "file.exportSettings"),
          ],
        },
        item("Print…", "file.print"),
        SEP,
        item("Recover Unsaved Drafts…", "file.recoverDrafts"),
        item("Preferences…", "file.preferences"),
        SEP,
        item("Close", "file.close"),
        item("Quit", "file.quit"),
      ],
    },
    {
      label: "&Edit",
      children: [
        item("Undo", "edit.undo", { display: "Ctrl+Z" }),
        item("Redo", "edit.redo", { display: "Ctrl+Y" }),
        SEP,
        item("Cut", "edit.cut", { display: "Ctrl+X" }),
        item("Copy", "edit.copy", { display: "Ctrl+C" }),
        item("Paste", "edit.paste", { display: "Ctrl+V" }),
        item("Copy as Plain Text", "edit.copyPlain"),
        item("Copy as Markdown", "edit.copyMarkdown"),
        item("Copy as HTML Code", "edit.copyHtml"),
        item("Paste as Plain Text", "edit.pastePlain", { display: "Ctrl+Shift+V" }),
        SEP,
        item("Select All", "edit.selectAll", { display: "Ctrl+A" }),
        item("Select Line", "edit.selectLine"),
        item("Select Styled Scope", "edit.selectScope"),
        item("Select Word", "edit.selectWord"),
        item("Delete Word", "edit.deleteWord"),
        SEP,
        item("Jump to Top", "edit.jumpToTop"),
        item("Jump to Selection", "edit.jumpToSelection"),
        item("Jump to Bottom", "edit.jumpToBottom"),
        SEP,
        item("Find…", "edit.find"),
        item("Find Next", "edit.findNext"),
        item("Find Previous", "edit.findPrevious"),
        item("Replace…", "edit.replace"),
        item("Search in Folder…", "edit.searchInFolder"),
        SEP,
        {
          label: "Spell Check",
          children: () => [
            toggle("Check Spelling", "edit.spellCheck"),
            SEP,
            { label: "Auto", checked: () => c.spellLanguage() === "auto", run: () => c.setSpellLanguage("auto") },
            ...c.spellLanguages().map((l) => ({ label: l, checked: () => c.spellLanguage() === l, run: () => c.setSpellLanguage(l) })),
            ...(c.spellLanguages().length ? [] : [{ label: "No Dictionaries Installed", enabled: () => false }]),
            SEP,
            item("Open Personal Dictionary", "edit.openPersonalDictionary"),
          ],
        },
        ...(c.isWindows ? [SEP, item("Emoji and Symbols…", "edit.emojiPanel")] : []),
      ],
    },
    {
      label: "&Paragraph",
      children: [
        ...[1, 2, 3, 4, 5, 6].map((n) => item(`Heading ${n}`, `para.h${n}`, { checked: () => c.checked(`para.h${n}`) })),
        item("Paragraph", "para.paragraph", { checked: () => c.checked("para.paragraph") }),
        SEP,
        item("Increase Heading Level", "para.increaseHeading"),
        item("Decrease Heading Level", "para.decreaseHeading"),
        SEP,
        item("Table…", "para.table"),
        item("Code Fences", "para.codeFences"),
        item("Math Block", "para.mathBlock"),
        SEP,
        toggle("Quote", "para.quote"),
        toggle("Ordered List", "para.orderedList"),
        toggle("Unordered List", "para.bulletList"),
        toggle("Task List", "para.taskList"),
        SEP,
        item("Indent", "para.indent"),
        item("Outdent", "para.outdent"),
        item("Move Row/Item Up", "para.moveUp"),
        item("Move Row/Item Down", "para.moveDown"),
        SEP,
        item("Insert Paragraph Before", "para.insertBefore"),
        item("Insert Paragraph After", "para.insertAfter"),
        SEP,
        item("Link Reference", "para.linkReference"),
        item("Footnote", "format.footnote"),
        item("Horizontal Line", "para.hr"),
        item("Table of Contents", "para.toc"),
        item("YAML Front Matter", "para.frontMatter"),
      ],
    },
    {
      label: "F&ormat",
      children: [
        item("Strong", "format.strong"),
        item("Emphasis", "format.em"),
        item("Underline", "format.underline"),
        item("Code", "format.code"),
        SEP,
        item("Inline Math", "format.inlineMath"),
        item("Strike", "format.strike"),
        item("Highlight", "format.highlight"),
        item("Superscript", "format.superscript"),
        item("Subscript", "format.subscript"),
        item("Comment", "format.comment"),
        SEP,
        item("Hyperlink", "format.link"),
        {
          label: "Image",
          children: [
            item("Insert Image…", "format.image.insert"),
            {
              label: "Zoom",
              children: [
                ...[25, 33, 50, 67, 80, 100, 150, 200].map((n) => item(`Zoom ${n}%`, `format.image.zoom${n}`)),
                item("Original Size", "format.image.originalSize"),
              ],
            },
          ],
        },
        SEP,
        item("Clear Format", "format.clear"),
      ],
    },
    {
      // 16, "Menu and shortcuts": between Format and View.
      label: "&Snippets",
      children: () => {
        const list = c.snippets();
        return [
          item("Insert Snippet…", "snippets.picker"),
          SEP,
          ...(list.length ? list.map((s) => item(s.label, s.id)) : [{ label: "No snippets: add some in Preferences → Customize", enabled: () => false }]),
        ];
      },
    },
    {
      label: "&View",
      children: [
        toggle("Source Code Mode", "view.sourceMode"),
        toggle("Focus Mode", "view.focusMode"),
        toggle("Typewriter Mode", "view.typewriterMode"),
        toggle("Show Status Bar", "view.statusBar"),
        SEP,
        toggle("Toggle Sidebar", "view.sidebar"),
        item("Outline", "view.outline"),
        item("File List", "view.fileList"),
        item("File Tree", "view.fileTree"),
        SEP,
        item("Actual Size", "view.actualSize"),
        item("Zoom In", "view.zoomIn"),
        item("Zoom Out", "view.zoomOut"),
        SEP,
        toggle("Toggle Full Screen", "view.fullScreen"),
        toggle("Always on Top", "view.alwaysOnTop"),
        ...(c.debugging() ? [SEP, item("Toggle DevTools", "view.devtools")] : []),
      ],
    },
    {
      label: "&Themes",
      children: () => [
        ...c.themes().map((t) => ({ label: t.name, checked: () => c.currentTheme() === t.id, run: () => c.setTheme(t.id) })),
        SEP,
        item("Open Theme Folder", "themes.openFolder"),
        item("Reload Themes", "themes.reload"),
      ],
    },
    {
      label: "&Help",
      children: [
        item("Quick Start", "help.quickStart"),
        item("Markdown Reference", "help.markdownReference"),
        item("Shortcuts", "help.shortcuts"),
        item("Custom Themes", "help.customThemes"),
        item("Snippets and Custom Tags", "help.snippets"),
        SEP,
        item("Open Log Folder", "help.logFolder"),
        item("Credits", "help.credits"),
        item("About", "help.about"),
      ],
    },
  ];
}

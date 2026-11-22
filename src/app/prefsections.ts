// The settings shown in Preferences (spec 11), with their defaults. Keys are stored flat
// in settings.json.

import type { Section } from "./preferences";
import type { ThemeInfo } from "../ipc";

export interface SectionHooks {
  themes(): ThemeInfo[];
  zoom(): number;
  resetZoom(): void;
  openThemeFolder(): void;
  recoverDrafts(): void;
  resetAdvanced(): void;
  openAdvanced(): void;
  customizeAvailable(): boolean;
  pickFolder(key: string): void;
  testUpload(): void;
  /** spell check languages from the system (13) */
  spellLanguages(): string[];
  /** detected pandoc version line, or "" */
  pandocVersion(): string;
  isWindows: boolean;
}

const sizes: [string | number, string][] = [["auto", "Auto"], ...Array.from({ length: 13 }, (_, i) => [12 + i, `${12 + i} px`] as [number, string])];

export function preferenceSections(h: SectionHooks): Section[] {
  const themeOptions = () => h.themes().map((t) => [t.id, t.name] as [string, string]);
  return [
    {
      id: "general",
      title: "General",
      groups: [
        {
          title: "On Launch",
          controls: [
            {
              kind: "select",
              key: "onLaunch",
              label: "On launch",
              def: "newFile",
              options: [
                ["newFile", "Open new file"],
                ["lastFolder", "Restore last closed folder"],
                ["lastSession", "Restore last closed files and folders"],
                ["customFolder", "Open custom folder"],
              ],
            },
            { kind: "text", key: "onLaunchFolder", label: "Custom folder", def: "", placeholder: "/path/to/folder" },
          ],
        },
        {
          title: "Save & Recover",
          hint: "applies to all windows",
          controls: [
            { kind: "toggle", key: "autoSave", label: "Auto save", def: false },
            { kind: "toggle", key: "saveWhenSwitching", label: "Save without asking when switching files in the sidebar", def: false },
            { kind: "button", label: "Recover Unsaved Drafts", run: h.recoverDrafts },
          ],
        },
        {
          title: "Language",
          hint: "applied after restart",
          controls: [{ kind: "select", key: "language", label: "Language", def: "system", options: [["system", "System"], ["en", "English"]] }],
        },
        {
          title: "Windows",
          controls: [
            {
              kind: "select",
              key: "openFilesIn",
              label: "Open files in",
              def: "current",
              options: [
                ["current", "Current window when possible"],
                ["new", "Always new window"],
              ],
            },
          ],
        },
        {
          title: "Advanced",
          controls: [
            { kind: "button", label: "Open Advanced Settings", run: h.openAdvanced, visible: h.customizeAvailable },
            { kind: "button", label: "Reset Advanced Settings", run: h.resetAdvanced },
            { kind: "toggle", key: "debugTools", label: "Enable debugging tools", def: false, hint: "Shows View → Toggle DevTools." },
          ],
        },
      ],
    },
    {
      id: "appearance",
      title: "Appearance",
      groups: [
        {
          title: "Theme",
          controls: [
            { kind: "select", key: "theme", label: "Theme", def: "paper", options: themeOptions },
            { kind: "button", label: "Open Theme Folder", run: h.openThemeFolder },
            { kind: "toggle", key: "useSeparateDarkTheme", label: "Use separate theme when the system is in dark mode", def: false },
            { kind: "select", key: "darkTheme", label: "Dark mode theme", def: "night", options: themeOptions },
          ],
        },
        { title: "Font", controls: [{ kind: "select", key: "fontSize", label: "Font size", def: "auto", options: sizes, hint: "Auto lets the theme decide." }] },
        {
          title: "Sidebar",
          controls: [
            {
              kind: "select",
              key: "sidebarView",
              label: "Show files as",
              def: "tree",
              options: [
                ["tree", "File tree"],
                ["list", "File list"],
              ],
            },
            { kind: "toggle", key: "showSidebarOnLaunch", label: "Show sidebar on launch", def: false },
            { kind: "toggle", key: "collapsibleOutline", label: 'Show "outline" collapse arrows', def: true },
          ],
        },
        {
          title: "Status Bar",
          controls: [
            { kind: "toggle", key: "showStatusBar", label: "Show status bar", def: true },
            { kind: "toggle", key: "showWordCount", label: "Show word count", def: true },
            { kind: "toggle", key: "countCodeInWords", label: "Count code in words", def: false },
          ],
        },
        {
          title: "Window",
          controls: [
            {
              kind: "select",
              key: "windowStyle",
              label: "Window style",
              def: h.isWindows ? "custom" : "native",
              options: [
                ["native", "Native title bar"],
                ["custom", "Unified custom title bar"],
              ],
              hint: "Applies to new windows.",
            },
            { kind: "info", label: "Zoom", text: () => `${Math.round(h.zoom() * 100)}%` },
            { kind: "button", label: "Reset Zoom", run: h.resetZoom },
          ],
        },
      ],
    },
    {
      id: "editor",
      title: "Editor",
      groups: [
        {
          title: "Code",
          controls: [
            {
              kind: "select",
              key: "codeIndent",
              label: "Default indent for code blocks and source mode",
              def: "4",
              options: [
                ["2", "2 spaces"],
                ["4", "4 spaces"],
                ["8", "8 spaces"],
                ["tab", "Tab"],
              ],
            },
          ],
        },
        {
          title: "Typing",
          controls: [
            { kind: "toggle", key: "autoPairBrackets", label: "Auto pair brackets and quotes", def: true },
            { kind: "toggle", key: "autoPairMarkdown", label: "Auto pair Markdown symbols", def: false },
            { kind: "toggle", key: "emojiAutocomplete", label: "Emoji autocomplete", def: true },
          ],
        },
        {
          title: "Modes",
          controls: [
            { kind: "toggle", key: "typewriterMode", label: "Typewriter mode", def: false },
            { kind: "toggle", key: "focusMode", label: "Focus mode", def: false },
          ],
        },
        {
          title: "Spell Check",
          controls: [
            { kind: "toggle", key: "spellCheck", label: "Spell check", def: true },
            { kind: "select", key: "spellLanguage", label: "Spell check language", def: "auto", options: () => [["auto", "Auto"], ...h.spellLanguages().map((l) => [l, l] as [string, string])] },
            { kind: "info", label: "Dictionaries", text: () => h.spellLanguages().join(", ") || "none installed" },
          ],
        },
        {
          title: "Links and Clipboard",
          controls: [
            { kind: "toggle", key: "openLinksSingleClick", label: "Open links with single click", def: false },
            { kind: "toggle", key: "copyAsMarkdown", label: "Copy as Markdown by default", def: true },
            { kind: "toggle", key: "pasteHtmlAsPlain", label: "Paste HTML as plain text", def: false },
          ],
        },
        {
          title: "Display",
          controls: [
            { kind: "toggle", key: "headingHint", label: "Show heading level hint in margin", def: true },
            { kind: "toggle", key: "cursorBlink", label: "Cursor blink", def: true },
          ],
        },
      ],
    },
    {
      id: "image",
      title: "Image",
      groups: [
        {
          title: "When Inserting Images",
          controls: [
            {
              kind: "select",
              key: "imagePolicy",
              label: "Insert images by",
              def: "assets",
              options: [
                ["none", "Referring to them where they are"],
                ["current", "Copying them next to the document (./)"],
                ["assets", "Copying them to ./assets"],
                ["docAssets", "Copying them to ./<document name>.assets"],
                ["custom", "Copying them to a custom folder"],
                ["upload", "Uploading them with a command"],
              ],
            },
            { kind: "text", key: "imageCustomFolder", label: "Custom folder", def: "", placeholder: "{{dir}}/images" },
            { kind: "toggle", key: "imageApplyToLocal", label: "Apply to local images too", def: true },
            { kind: "toggle", key: "imageRelativePath", label: "Use relative paths if possible", def: true },
            { kind: "toggle", key: "imagePreferDotSlash", label: "Prefer ./ in relative paths", def: false },
            { kind: "toggle", key: "imageEscapeUrl", label: "Encode spaces and special characters in paths", def: true },
          ],
        },
        {
          title: "Upload",
          controls: [
            { kind: "text", key: "imageUploadCommand", label: "Upload command", def: "", placeholder: "command that prints URLs" },
            { kind: "button", label: "Test", run: h.testUpload },
          ],
        },
      ],
    },
    {
      id: "markdown",
      title: "Markdown",
      groups: [
        {
          title: "Syntax",
          controls: [
            { kind: "toggle", key: "strictMode", label: "Strict mode", def: true },
            { kind: "toggle", key: "inlineMath", label: "Inline math", def: false },
            { kind: "toggle", key: "subscript", label: "Subscript", def: false },
            { kind: "toggle", key: "superscript", label: "Superscript", def: false },
            { kind: "toggle", key: "highlight", label: "Highlight", def: false },
            { kind: "toggle", key: "diagrams", label: "Diagrams", def: true },
            { kind: "toggle", key: "smartPunctuation", label: "Smart punctuation", def: false },
            { kind: "toggle", key: "preserveLineBreaks", label: "Preserve single line breaks", def: true },
          ],
        },
        {
          title: "Code Blocks",
          controls: [
            { kind: "toggle", key: "codeLineNumbers", label: "Line numbers in code blocks", def: false },
            { kind: "toggle", key: "codeWrap", label: "Wrap lines in code blocks", def: true },
            { kind: "toggle", key: "codeCopyButton", label: "Copy button on code blocks", def: false },
            { kind: "toggle", key: "sourceLineNumbers", label: "Line numbers in source mode", def: false },
          ],
        },
        {
          title: "Math and Footnotes",
          controls: [
            { kind: "toggle", key: "mathAutoNumber", label: "Auto numbering of math blocks", def: false },
            { kind: "toggle", key: "numberFootnotes", label: "Number footnotes", def: true },
          ],
        },
        {
          title: "Writing Style",
          hint: "for Markdown Scrim writes",
          controls: [
            { kind: "select", key: "bulletChar", label: "Bullet character", def: "-", options: [["-", "-"], ["*", "*"], ["+", "+"]] },
            { kind: "select", key: "emphasisChar", label: "Emphasis character", def: "*", options: [["*", "*"], ["_", "_"]] },
            { kind: "select", key: "strongChar", label: "Strong character", def: "**", options: [["**", "**"], ["__", "__"]] },
            { kind: "select", key: "headingStyle", label: "Heading style", def: "atx", options: [["atx", "# Heading"], ["setext", "Heading + underline (levels 1–2)"]] },
            { kind: "toggle", key: "prettyPrintTables", label: "Pretty-print tables", def: true },
          ],
        },
        {
          title: "HTML",
          controls: [{ kind: "toggle", key: "allowIframes", label: "Allow iframes in HTML", def: false, hint: "Applies to open windows immediately." }],
        },
        {
          title: "Line Endings",
          controls: [
            {
              kind: "select",
              key: "defaultLineEnding",
              label: "Default line ending for new files",
              def: h.isWindows ? "crlf" : "lf",
              options: [
                ["lf", "LF"],
                ["crlf", "CRLF"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "export",
      title: "Export",
      groups: [
        {
          title: "PDF",
          controls: [
            {
              kind: "select",
              key: "exportPdfPageSize",
              label: "Page size",
              def: "A4",
              options: [
                ["A4", "A4"],
                ["Letter", "Letter"],
                ["Legal", "Legal"],
                ["A3", "A3"],
                ["A5", "A5"],
                ["custom", "Custom"],
              ],
            },
            { kind: "number", key: "exportPdfCustomWidth", label: "Custom width", def: 210, min: 20, max: 2000, unit: "mm" },
            { kind: "number", key: "exportPdfCustomHeight", label: "Custom height", def: 297, min: 20, max: 2000, unit: "mm" },
            {
              kind: "select",
              key: "exportPdfOrientation",
              label: "Orientation",
              def: "portrait",
              options: [
                ["portrait", "Portrait"],
                ["landscape", "Landscape"],
              ],
            },
            { kind: "number", key: "exportPdfMarginTop", label: "Top margin", def: 18, min: 0, max: 200, unit: "mm" },
            { kind: "number", key: "exportPdfMarginBottom", label: "Bottom margin", def: 18, min: 0, max: 200, unit: "mm" },
            { kind: "number", key: "exportPdfMarginLeft", label: "Left margin", def: 16, min: 0, max: 200, unit: "mm" },
            { kind: "number", key: "exportPdfMarginRight", label: "Right margin", def: 16, min: 0, max: 200, unit: "mm" },
            { kind: "toggle", key: "exportPdfPageBreakBeforeH1", label: "Page break before each h1", def: false },
            { kind: "select", key: "exportPdfTheme", label: "Theme for PDF", def: "current", options: () => [["current", "Current theme"], ["none", "No theme"], ...themeOptions()] },
          ],
        },
        {
          title: "PDF header and footer",
          hint: "{{title}}, {{page}}, {{pages}}, {{date}}",
          controls: [
            { kind: "text", key: "exportPdfHeaderLeft", label: "Header left", def: "" },
            { kind: "text", key: "exportPdfHeaderCenter", label: "Header center", def: "" },
            { kind: "text", key: "exportPdfHeaderRight", label: "Header right", def: "" },
            { kind: "text", key: "exportPdfFooterLeft", label: "Footer left", def: "" },
            { kind: "text", key: "exportPdfFooterCenter", label: "Footer center", def: "{{page}}" },
            { kind: "text", key: "exportPdfFooterRight", label: "Footer right", def: "" },
          ],
        },
        {
          title: "HTML",
          controls: [
            { kind: "select", key: "exportHtmlTheme", label: "Theme", def: "current", options: () => [["current", "Current theme"], ["none", "No theme"], ...themeOptions()] },
            { kind: "toggle", key: "exportHtmlEmbedImages", label: "Embed images and theme assets", def: false },
            { kind: "textarea", key: "exportHtmlHead", label: "Extra <head> content", def: "", placeholder: "<meta …>" },
            { kind: "textarea", key: "exportHtmlBodyEnd", label: "Content appended to <body>", def: "" },
          ],
        },
        {
          title: "Pandoc",
          controls: [
            { kind: "text", key: "pandocPath", label: "Pandoc path", def: "", placeholder: "auto-detect" },
            { kind: "info", label: "Detected", text: () => h.pandocVersion() || "not found" },
            { kind: "text", key: "exportPandocReferenceDocx", label: "Reference .docx for Word", def: "", placeholder: "none" },
          ],
        },
        {
          title: "Custom export commands",
          hint: "{{input}}, {{output}}, {{dir}}, {{name}}; the document is saved first",
          controls: [{ kind: "commands", key: "exportCustomCommands", label: "Commands" }],
        },
      ],
    },
    { id: "customize", title: "Customize", visible: h.customizeAvailable, groups: [] },
  ];
}

import { describe, expect, it } from "vitest";
import { Dispatcher, normalizeAccelerator, type CommandDef } from "../editor/keys";
import { commandItems, labelKey, nativeAccelerator, shortcutOverrides } from "./menu";
import { menuTree } from "./menutree";

const tree = menuTree({
  isWindows: false,
  recent: () => ({ files: [], folders: [] }),
  openRecent: () => {},
  clearRecent: () => {},
  themes: () => [],
  currentTheme: () => "",
  setTheme: () => {},
  checked: () => false,
  debugging: () => true,
  hasPath: () => true,
  pandoc: () => true,
  customExports: () => [],
  runCustomExport: () => {},
  pandocHelp: () => {},
  spellLanguages: () => [],
  spellLanguage: () => "auto",
  setSpellLanguage: () => {},
});

describe("accelerators", () => {
  it("normalizes user-written accelerators", () => {
    expect(normalizeAccelerator("Ctrl+Shift+B")).toBe("Ctrl+Shift+B");
    expect(normalizeAccelerator("shift+ctrl+b")).toBe("Ctrl+Shift+B");
    expect(normalizeAccelerator("CmdOrCtrl+Alt+Up")).toBe("Ctrl+Alt+Up");
    expect(normalizeAccelerator("Mod+Shift+=")).toBe("Ctrl+Shift+=");
    expect(normalizeAccelerator("Ctrl+Plus")).toBe("Ctrl+=");
    expect(normalizeAccelerator("F7")).toBe("F7");
    expect(normalizeAccelerator("Ctrl+Escape")).toBe("Ctrl+Esc");
    expect(normalizeAccelerator("Ctrl+KeyK")).toBe("Ctrl+K");
    expect(normalizeAccelerator("Ctrl+B+C")).toBeNull();
    expect(normalizeAccelerator("Ctrl+")).toBeNull();
    expect(normalizeAccelerator("Ctrl+Bogus")).toBeNull();
  });
});

describe("shortcuts overrides (12)", () => {
  it("finds items by English label, ignoring case, … and .", () => {
    expect(labelKey("Open Folder…")).toBe("open folder");
    const { overrides, problems } = shortcutOverrides(tree, { strong: "Ctrl+Shift+B", "open folder...": "Ctrl+Alt+O", Hyperlink: "", Nope: "F2", Code: 3 });
    expect(overrides.get("format.strong")).toBe("Ctrl+Shift+B");
    expect(overrides.get("file.openFolder")).toBe("Ctrl+Alt+O");
    expect(overrides.get("format.link")).toBe("");
    expect(problems).toHaveLength(2);
  });

  it("global: entries are separate", () => {
    const { overrides, global } = shortcutOverrides(tree, { "Quick Open": "global:Ctrl+Alt+P" });
    expect(overrides.size).toBe(0);
    expect(global.get("file.quickOpen")).toBe("Ctrl+Alt+P");
  });

  it("every menu command label is unique", () => {
    const labels = commandItems(tree).map((n) => labelKey(n.label));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("rebinding moves keys and frees them", () => {
    const ran: string[] = [];
    const cmd = (id: string, key: string): CommandDef => ({ id, key, scope: "global", run: () => void ran.push(id) });
    const d = new Dispatcher([cmd("a", "Ctrl+B"), cmd("b", "Ctrl+Shift+B")], () => true);
    d.rebind(new Map([["a", "Ctrl+Shift+B"]]));
    expect(d.keyOf("a")).toBe("Ctrl+Shift+B");
    expect(d.keyOf("b")).toBe(""); // taken by the override
    expect(d.dispatch("Ctrl+B")).toBe(false);
    expect(d.dispatch("Ctrl+Shift+B")).toBe(true);
    expect(ran).toEqual(["a"]);
    d.rebind(new Map());
    expect(d.keyOf("a")).toBe("Ctrl+B");
    expect(d.keyOf("b")).toBe("Ctrl+Shift+B");
  });
});

describe("native accelerators (QA-LOG Q-017)", () => {
  it("only global commands get one, never clipboard keys", () => {
    expect(nativeAccelerator("Ctrl+S", true)).toBe("CmdOrCtrl+S");
    expect(nativeAccelerator("Ctrl+B", false)).toBeUndefined();
    expect(nativeAccelerator("Ctrl+C", true)).toBeUndefined();
    expect(nativeAccelerator("F11", true)).toBe("F11");
  });
});

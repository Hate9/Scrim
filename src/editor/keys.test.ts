import { describe, expect, it } from "vitest";
import { keyIdentity } from "./keys";

const ev = (key: string, code: string, shiftKey = false, altKey = false) => ({ key, code, shiftKey, altKey, ctrlKey: true });

describe("key identity (01 rule 5)", () => {
  it("Latin letters are layout-logical", () => {
    expect(keyIdentity(ev("b", "KeyB"))).toBe("B");
    expect(keyIdentity(ev("a", "KeyQ"))).toBe("A"); // AZERTY A key
  });
  it("non-Latin letters fall back to the US key", () => {
    expect(keyIdentity(ev("и", "KeyB"))).toBe("B"); // Russian layout
  });
  it("punctuation and digits", () => {
    expect(keyIdentity(ev("[", "BracketLeft"))).toBe("[");
    expect(keyIdentity(ev("~", "Backquote", true))).toBe("`"); // Shift held → US char
    expect(keyIdentity(ev("+", "Equal", true))).toBe("=");
    expect(keyIdentity(ev("ü", "BracketLeft"))).toBe("["); // German layout
    expect(keyIdentity(ev("%", "Digit5", true, true))).toBe("5");
    expect(keyIdentity(ev("1", "Digit1"))).toBe("1");
  });
  it("named keys", () => {
    expect(keyIdentity(ev("ArrowUp", "ArrowUp"))).toBe("Up");
    expect(keyIdentity(ev("F8", "F8"))).toBe("F8");
    expect(keyIdentity(ev(" ", "Space"))).toBe("Space");
    expect(keyIdentity(ev("Control", "ControlLeft"))).toBeNull();
  });
});

import { Dispatcher } from "./keys";

describe("dispatcher", () => {
  it("runs repeated presses, drops the other source's duplicate", () => {
    let n = 0;
    const d = new Dispatcher([{ id: "x", key: "Ctrl+B", scope: "global", run: () => void n++ }], () => true);
    d.dispatch("Ctrl+B", "dom");
    d.dispatch("Ctrl+B", "dom");
    expect(n).toBe(2);
    d.dispatch("Ctrl+B", "native");
    expect(n).toBe(2);
    d.dispatch("Ctrl+B", "native");
    expect(n).toBe(3);
    expect(d.dispatch("Ctrl+C")).toBe(false);
  });
});

// Keys that belong to an input method's composition (E-9). The key that commits a
// composition (Enter or Space with Japanese IMEs) must not also run an editing command:
// Enter in an empty heading turned it back into a paragraph before the committed text
// was in. WebKitGTK can report that key with `isComposing` false and keyCode 229, or as a
// plain Enter right after compositionend, so every signal counts.

let composing = false;
let endedAt = -1e9;
if (typeof document !== "undefined") {
  document.addEventListener("compositionstart", () => (composing = true), true);
  document.addEventListener(
    "compositionend",
    () => {
      composing = false;
      endedAt = performance.now();
    },
    true,
  );
  // A composition cut short (focus moved away) never ends with compositionend.
  window.addEventListener("blur", () => (composing = false));
  document.addEventListener("focusout", () => (composing = false), true);
}

/** True for a keydown that is part of a composition, or the Enter that committed one. */
export function composingKey(e: KeyboardEvent, viewComposing = false): boolean {
  if (e.isComposing || e.keyCode === 229 || e.key === "Process" || composing || viewComposing) return true;
  return e.key === "Enter" && performance.now() - endedAt < 60;
}

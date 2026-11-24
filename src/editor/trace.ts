// Keystroke tracing for E-14 (QA-LOG Q-027, follow-up): while on, records how long each plugin's
// state apply, appendTransaction and view update, each update hook, and each forced
// layout read take, with timestamps, so a slow keystroke can be explained. Off, the
// wrappers cost one test per call.

import type { Plugin } from "prosemirror-state";

export interface TraceEntry {
  t: number;
  what: string;
  ms: number;
}

let log: TraceEntry[] | null = null;

/** Start (a new log) or stop tracing; `layout` also times layout reads (wrapping DOM
 * prototypes, so left off for the open's trace in every window). */
export function traceOn(on: boolean, layout = true): TraceEntry[] | null {
  log = on ? [] : null;
  if (on) {
    wrapTimers();
    if (layout) wrapLayout();
  }
  return log;
}

/** Run `f`, timed while tracing; `what` may be a function so its label is only built then. */
export function timed<T>(what: string | (() => string), f: () => T): T {
  if (!log) return f();
  const t = performance.now();
  try {
    return f();
  } finally {
    log?.push({ t, what: typeof what === "string" ? what : what(), ms: performance.now() - t });
  }
}

/** Time every plugin's state apply, appendTransaction and view update. */
export function tracePlugins(plugins: Plugin[]): void {
  plugins.forEach((p, i) => {
    const spec = p.spec as {
      key?: unknown;
      state?: { apply: (...a: unknown[]) => unknown };
      appendTransaction?: (...a: unknown[]) => unknown;
      view?: (v: unknown) => { update?: (...a: unknown[]) => void; destroy?: () => void };
    };
    const name = String((p as unknown as { key?: string }).key ?? `plugin${i}`).replace(/\$\d*$/, "") || `plugin${i}`;
    if (spec.state) {
      const apply = spec.state.apply;
      spec.state.apply = function (this: unknown, ...a: unknown[]) {
        return timed(`apply ${name}`, () => apply.apply(this, a));
      };
    }
    if (spec.appendTransaction) {
      const append = spec.appendTransaction;
      spec.appendTransaction = function (this: unknown, ...a: unknown[]) {
        return timed(`append ${name}`, () => append.apply(this, a));
      };
    }
    if (spec.view) {
      const make = spec.view;
      spec.view = function (this: unknown, v: unknown) {
        const pv = make.call(this, v);
        if (pv?.update) {
          const update = pv.update.bind(pv);
          pv.update = (...a: unknown[]) => timed(`view ${name}`, () => update(...a));
        }
        return pv;
      };
    }
  });
}

let wrapped = false;
/** Time layout reads (a slow one is a forced layout). */
function wrapLayout() {
  if (wrapped) return;
  wrapped = true;
  const wrapMethod = (proto: object, name: string) => {
    const orig = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
    (proto as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) {
      return timed(`layout ${name}`, () => orig.apply(this, a));
    };
  };
  wrapMethod(Element.prototype, "getBoundingClientRect");
  wrapMethod(Element.prototype, "getClientRects");
  wrapMethod(Range.prototype, "getBoundingClientRect");
  wrapMethod(Range.prototype, "getClientRects");
  wrapMethod(Document.prototype, "elementFromPoint");
  for (const prop of ["offsetHeight", "offsetWidth", "offsetTop", "clientHeight", "scrollHeight", "scrollTop"]) {
    const proto = prop.startsWith("offset") ? HTMLElement.prototype : Element.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.get) continue;
    const get = d.get;
    Object.defineProperty(proto, prop, { ...d, get(this: Element) { return timed(`layout ${prop}`, () => get.call(this)); } });
  }
}

let timersWrapped = false;
/** Time timers, idle callbacks and animation frames, labelled by their first characters. */
function wrapTimers() {
  if (timersWrapped) return;
  timersWrapped = true;
  const wrapTimer = (name: "setTimeout" | "requestIdleCallback" | "requestAnimationFrame") => {
    const w = window as unknown as Record<string, (f: (...a: unknown[]) => void, ...r: unknown[]) => number>;
    const orig = w[name];
    if (!orig) return;
    w[name] = (f, ...r) => orig.call(window, (...a: unknown[]) => (typeof f === "function" ? timed(`${name} ${String(f).slice(0, 60)}`, () => f(...a)) : undefined), ...r);
  };
  wrapTimer("setTimeout");
  wrapTimer("requestIdleCallback");
  wrapTimer("requestAnimationFrame");
}

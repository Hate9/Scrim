// CodeMirror 6's injected styles (its base theme and EditorView.theme rules) go in the
// cascade layer `scrim-cm` (spec 10.3; QA-LOG Q-019). Unlayered CSS always beats layered
// CSS, so any theme rule wins over them regardless of specificity (for example a theme's
// `.cm-s-inner.CodeMirror { background: … }`).
//
// CodeMirror mounts its styles with style-mod's `StyleModule.mount`; each module's rules
// are wrapped once, before they are first mounted. Import this module before any
// CodeMirror view is created.

import { StyleModule } from "style-mod";

const LAYERED = Symbol("scrim-cm-layered");
type Layered = StyleModule & { rules: string[]; [LAYERED]?: true };

const mount = StyleModule.mount.bind(StyleModule);
StyleModule.mount = (root, modules, options) => {
  for (const m of (Array.isArray(modules) ? modules : [modules]) as Layered[]) {
    if (m[LAYERED]) continue;
    m.rules = m.rules.map((r) => `@layer scrim-cm { ${r} }`);
    m[LAYERED] = true;
  }
  mount(root, modules, options);
};

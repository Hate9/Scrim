// Focus mode (spec 15): the block holding the cursor gets class `md-focus`; inside lists the
// unit is the innermost list item. The class is a node decoration so ProseMirror owns it.
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export function createFocusPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        if (!document.body.classList.contains("on-focus-mode")) return null;
        const $p = state.selection.$head;
        if ($p.depth < 1) return null;
        let depth = 1;
        for (let d = $p.depth; d >= 1; d--) {
          if ($p.node(d).type.name === "list_item") {
            depth = d;
            break;
          }
        }
        const from = $p.before(depth);
        const node = $p.node(depth);
        return DecorationSet.create(state.doc, [Decoration.node(from, from + node.nodeSize, { class: "md-focus" })]);
      },
    },
  });
}

// A step that swaps a textblock's content for the same text with other marks (QA-LOG
// Q-027 follow-up). Presentation marks used to be synced with one removeMark and one addMark per
// mark: about ten steps per block, each copying the path to the block, so marking 300
// blocks of a 1 MB document took 300 ms. Marks never move positions, so this step maps
// nothing (like ProseMirror's mark steps) and keeps selections and decorations in place.

import { Fragment, Slice, type Node, type Schema } from "prosemirror-model";
import { Step, StepMap, StepResult, type Mappable } from "prosemirror-transform";

export class SetMarksStep extends Step {
  /** `pos`: the textblock's position; `content`: its new content (same text and size). */
  constructor(
    readonly pos: number,
    readonly content: Fragment,
  ) {
    super();
  }

  apply(doc: Node): StepResult {
    const node = doc.nodeAt(this.pos);
    if (!node || !node.isTextblock || node.content.size !== this.content.size) return StepResult.fail("content does not match");
    return StepResult.fromReplace(doc, this.pos + 1, this.pos + 1 + node.content.size, new Slice(this.content, 0, 0));
  }

  getMap(): StepMap {
    return StepMap.empty;
  }

  invert(doc: Node): Step {
    return new SetMarksStep(this.pos, doc.nodeAt(this.pos)!.content);
  }

  map(mapping: Mappable): Step | null {
    const r = mapping.mapResult(this.pos, 1);
    return r.deletedAfter ? null : new SetMarksStep(r.pos, this.content);
  }

  toJSON() {
    return { stepType: "scrimSetMarks", pos: this.pos, content: this.content.toJSON() };
  }

  static fromJSON(schema: Schema, json: { pos: number; content: unknown }) {
    return new SetMarksStep(json.pos, Fragment.fromJSON(schema, json.content));
  }
}

Step.jsonID("scrimSetMarks", SetMarksStep);

// Lenient forms accepted when strict mode is off (spec 02, "Toggleable"):
// - a line starting with 1–6 `#` directly followed by a letter (`#Heading`) is a heading;
// - an ordered list starting with a number other than 1 may interrupt a paragraph.
// Everything else follows CommonMark. Both are micromark constructs tried before the
// CommonMark ones; anything they do not accept falls through to CommonMark.

import { headingAtx, list } from "micromark-core-commonmark";
import { markdownLineEnding, markdownSpace } from "micromark-util-character";
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from "micromark-util-types";

const HASH = 35;
const isLetter = (code: Code) => code !== null && code > 0 && /\p{L}/u.test(String.fromCodePoint(code));

/** `#Heading`: the CommonMark ATX heading tokens, with text right after the sequence.
 * The heading text then ends like an ATX heading's (closing sequence, trailing spaces);
 * CommonMark's resolver builds the content. */
const laxHeading: Construct = {
  name: "laxHeadingAtx",
  resolve: headingAtx.resolve,
  tokenize(effects: Effects, ok: State, nok: State): State {
    let size = 0;
    const sequenceOpen: State = (code) => {
      if (code === HASH && size++ < 6) {
        effects.consume(code);
        return sequenceOpen;
      }
      // Only the lenient case; `# Heading` and the rest are CommonMark's.
      if (size > 6 || !isLetter(code)) return nok(code);
      effects.exit("atxHeadingSequence");
      effects.enter("atxHeadingText");
      return data(code);
    };
    const atBreak: State = (code) => {
      if (code === HASH) {
        effects.enter("atxHeadingSequence");
        return sequenceFurther(code);
      }
      if (code === null || markdownLineEnding(code)) {
        effects.exit("atxHeading");
        return ok(code);
      }
      if (markdownSpace(code)) {
        effects.enter("whitespace");
        return space(code);
      }
      effects.enter("atxHeadingText");
      return data(code);
    };
    const space: State = (code) => {
      if (markdownSpace(code)) {
        effects.consume(code);
        return space;
      }
      effects.exit("whitespace");
      return atBreak(code);
    };
    const sequenceFurther: State = (code) => {
      if (code === HASH) {
        effects.consume(code);
        return sequenceFurther;
      }
      effects.exit("atxHeadingSequence");
      return atBreak(code);
    };
    const data: State = (code) => {
      if (code === null || code === HASH || markdownLineEnding(code) || markdownSpace(code)) {
        effects.exit("atxHeadingText");
        return atBreak(code);
      }
      effects.consume(code);
      return data;
    };
    return (code) => {
      effects.enter("atxHeading");
      effects.enter("atxHeadingSequence");
      return sequenceOpen(code);
    };
  },
};

/** CommonMark's list, except that while reading an ordered marker it does not see that
 * it interrupts a paragraph (so any start number is allowed); from the marker on it
 * does (an empty item still cannot interrupt). */
const laxList: Construct = {
  ...list,
  name: "laxList",
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const self = this;
    let relaxed = true;
    const view = new Proxy(self, {
      get(target, key) {
        if (key === "interrupt" && relaxed) return undefined;
        const v = Reflect.get(target, key, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
      set(target, key, value) {
        return Reflect.set(target, key, value, target);
      },
    });
    const fx: Effects = {
      ...effects,
      enter(type, fields) {
        if (type === "listItemMarker") relaxed = false;
        return effects.enter(type, fields);
      },
    };
    return list.tokenize.call(view, fx, ok, nok);
  },
};

const DIGITS = Object.fromEntries([48, 49, 50, 51, 52, 53, 54, 55, 56, 57].map((c) => [c, laxList]));

export const lenient: Extension = {
  flow: { [HASH]: laxHeading },
  document: DIGITS,
};

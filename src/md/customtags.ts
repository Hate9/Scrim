// Custom HTML tags (spec 17): names the user registers in local.json so they render as
// real elements. The registry is module state shared by the inline analyzer, the block
// parser, and the HTML sanitizer; `version` changes with every update so caches keyed on
// it re-analyze.

import { htmlBlockNames } from "micromark-util-html-tag-name";

/**
 * Element names of the HTML Living Standard's element index, plus `svg`, `math`, SVG and
 * MathML element names, and obsolete elements. None of them can be registered: that would
 * let `script`, `iframe`, `style`, `object`, … past the sanitizer (17, "Registration").
 */
export const STANDARD_ELEMENTS = new Set(
  (
    // HTML Living Standard element index
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup " +
    "data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 " +
    "head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript " +
    "object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small " +
    "source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var " +
    "video wbr selectedcontent " +
    // embedded vocabularies
    "svg math " +
    // obsolete and non-conforming
    "acronym applet basefont bgsound big blink center command content dir element font frame frameset image isindex keygen " +
    "listing marquee menuitem multicol nextid nobr noembed noframes plaintext rb rtc shadow spacer strike tt xmp param " +
    // SVG elements
    "animate animatemotion animatetransform circle clippath defs desc ellipse feblend fecolormatrix fecomponenttransfer " +
    "fecomposite feconvolvematrix fediffuselighting fedisplacementmap fedistantlight fedropshadow feflood fefunca fefuncb " +
    "fefuncg fefuncr fegaussianblur feimage femerge femergenode femorphology feoffset fepointlight fespecularlighting " +
    "fespotlight fetile feturbulence filter foreignobject g line lineargradient marker mask metadata mpath path pattern " +
    "polygon polyline radialgradient rect set stop switch symbol text textpath tspan use view " +
    // MathML elements
    "maction annotation annotation-xml merror mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow " +
    "ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover semantics"
  ).split(/\s+/),
);

export type TagProblem = "not a tag name" | "standard HTML element";

/** Why a name cannot be registered, or null if it can (17). */
export function tagProblem(name: string): TagProblem | null {
  const n = name.toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(n)) return "not a tag name";
  if (STANDARD_ELEMENTS.has(n)) return "standard HTML element";
  return null;
}

/** Names separated by commas or spaces, split into valid (lowercased) and ignored. */
export function parseTagList(text: string): { names: string[]; ignored: { name: string; why: TagProblem }[] } {
  const names: string[] = [];
  const ignored: { name: string; why: TagProblem }[] = [];
  for (const raw of text.split(/[\s,]+/).filter(Boolean)) {
    const why = tagProblem(raw);
    if (why) ignored.push({ name: raw, why });
    else if (!names.includes(raw.toLowerCase())) names.push(raw.toLowerCase());
  }
  return { names, ignored };
}

export const customTags = {
  inline: new Set<string>(),
  block: new Set<string>(),
  version: 0,
};

/** CommonMark's HTML block type 6 names (micromark's list), before any registration. */
const STANDARD_BLOCK_NAMES = new Set(htmlBlockNames);

/**
 * Replace the registered names (invalid ones are dropped). Block names join the parser's
 * type-6 list, so a line starting with `<callout` starts an HTML block that ends at the
 * next blank line (17, "Block tags"). Returns whether anything changed.
 */
export function setCustomTags(inline: unknown, block: unknown): boolean {
  const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !tagProblem(x)).map((x) => x.toLowerCase()) : []);
  const nextInline = new Set(clean(inline));
  const nextBlock = new Set(clean(block));
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  if (same(nextInline, customTags.inline) && same(nextBlock, customTags.block)) return false;
  for (const n of customTags.block) {
    const i = htmlBlockNames.indexOf(n);
    if (i >= 0 && !STANDARD_BLOCK_NAMES.has(n)) htmlBlockNames.splice(i, 1);
  }
  for (const n of nextBlock) if (!htmlBlockNames.includes(n)) htmlBlockNames.push(n);
  customTags.inline = nextInline;
  customTags.block = nextBlock;
  customTags.version++;
  return true;
}

/** Registered names, for the sanitizer allowlist. */
export function allCustomTags(): string[] {
  return [...customTags.inline, ...customTags.block];
}

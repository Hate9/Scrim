// Markdown → HTML for the clipboard's text/html flavor (spec 06, 6.1). Raw HTML in the
// source is escaped, not passed through.
import { micromark } from "micromark";
import { gfmAutolinkLiteral, gfmAutolinkLiteralHtml } from "micromark-extension-gfm-autolink-literal";
import { gfmFootnote, gfmFootnoteHtml } from "micromark-extension-gfm-footnote";
import { gfmStrikethrough, gfmStrikethroughHtml } from "micromark-extension-gfm-strikethrough";
import { gfmTable, gfmTableHtml } from "micromark-extension-gfm-table";

export function markdownToHtml(md: string): string {
  return micromark(md, {
    extensions: [gfmAutolinkLiteral(), gfmFootnote(), gfmStrikethrough({ singleTilde: false }), gfmTable()],
    htmlExtensions: [gfmAutolinkLiteralHtml(), gfmFootnoteHtml(), gfmStrikethroughHtml(), gfmTableHtml()],
  });
}

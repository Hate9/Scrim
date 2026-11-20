"""Extract the examples from the CommonMark and GFM spec texts into
tests/corpus/spec-examples.json (round-trip corpus, spec 20 R-1).

Sources (CC-BY-SA 4.0, see THIRD_PARTY.md):
  CommonMark 0.31.2: https://raw.githubusercontent.com/commonmark/commonmark-spec/0.31.2/spec.txt
  GFM 0.29 (extensions only): https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt

Usage: python3 scripts/extract-spec-examples.py CM_SPEC.txt GFM_SPEC.txt OUT.json
"""
import json
import re
import sys

FENCE = "`" * 32


def examples(path, source, extensions_only=False):
    out = []
    section = ""
    lines = open(path, encoding="utf-8").read().split("\n")
    i = 0
    number = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^#{1,6} (.*)", line)
        if m:
            section = m.group(1).strip()
        if line.startswith(FENCE + " example"):
            ext = line[len(FENCE + " example"):].strip()
            number += 1
            md, html = [], []
            i += 1
            while lines[i] != ".":
                md.append(lines[i])
                i += 1
            i += 1
            while lines[i] != FENCE:
                html.append(lines[i])
                i += 1
            if not extensions_only or ext:
                def fix(s):
                    return s.replace("→", "\t")
                out.append({
                    "source": source,
                    "number": number,
                    "section": section,
                    "extension": ext or None,
                    "markdown": fix("\n".join(md) + "\n") if md else "",
                    "html": fix("\n".join(html) + "\n") if html else "",
                })
        i += 1
    return out


cm = examples(sys.argv[1], "commonmark-0.31.2")
gfm = examples(sys.argv[2], "gfm-0.29", extensions_only=True)
data = {
    "license": "CC-BY-SA 4.0. Examples extracted from the CommonMark Spec (John MacFarlane) "
    "and the GitHub Flavored Markdown Spec. See THIRD_PARTY.md.",
    "examples": cm + gfm,
}
with open(sys.argv[3], "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=0)
    f.write("\n")
print(f"{len(cm)} CommonMark + {len(gfm)} GFM extension examples")

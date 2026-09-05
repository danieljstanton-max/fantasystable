#!/usr/bin/env python3
"""
Turn Dan's course and going cheat sheet into data/course-guide.json.

Dan, 2026-09-01: "I have built a course and going cheat sheet - please use this
moving forward daily and write into our model."

Kept as a converter rather than a one-off paste so that when he updates the
workbook the repo can be brought back in line with one command:

    python3 scripts/import-course-guide.py ~/Downloads/UK_Ireland_Racecourse_Cheat_Sheet.xlsx

Reads the xlsx by hand out of its zip rather than pulling in openpyxl — one
more build dependency for four sheets of text is not worth it, and this file
has to keep working on a machine where nobody has run pip.
"""
import json, sys, zipfile, pathlib
import xml.etree.ElementTree as ET

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                   else pathlib.Path.home() / "Downloads/UK_Ireland_Racecourse_Cheat_Sheet.xlsx")
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "course-guide.json"


def sheets(z):
    shared = []
    try:
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si"):
            shared.append("".join(t.text or "" for t in si.iter(M + "t")))
    except KeyError:
        pass
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    out = {}
    for s in wb.iter(M + "sheet"):
        target = "xl/" + rels[s.get(R + "id")].lstrip("/").replace("xl/", "")
        ws = ET.fromstring(z.read(target))
        rows = []
        for row in ws.iter(M + "row"):
            cells = {}
            for c in row.iter(M + "c"):
                v, inline = c.find(M + "v"), c.find(M + "is")
                if inline is not None:
                    val = "".join(t.text or "" for t in inline.iter(M + "t"))
                elif v is None:
                    continue
                elif c.get("t") == "s":
                    val = shared[int(v.text)]
                else:
                    val = v.text
                ref = "".join(ch for ch in c.get("r") if ch.isalpha())
                n = 0
                for ch in ref:
                    n = n * 26 + ord(ch) - 64
                cells[n - 1] = (val or "").strip()
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        out[s.get("name")] = rows
    return out


def table(rows, first_col_header):
    """Rows from the header line onward, as dicts. The sheets carry two banner
    rows above the header, so the header is found by its first cell."""
    head = next(i for i, r in enumerate(rows) if r and r[0] == first_col_header)
    keys = rows[head]
    return [
        {keys[i]: (r[i] if i < len(r) else "") for i in range(len(keys))}
        for r in rows[head + 1:]
        if r and r[0]
    ]


def main():
    if not SRC.exists():
        sys.exit(f"cheat sheet not found: {SRC}")
    z = zipfile.ZipFile(SRC)
    sh = sheets(z)

    profiles = table(sh["Course Profiles"], "Racecourse")
    going = {r["Racecourse"]: r for r in table(sh["Going Guide"], "Racecourse")}

    draw = {}
    for r in table(sh["Draw Bias 2023-26"], "Racecourse / variant"):
        draw.setdefault(r["Racecourse / variant"], []).append({
            "surface": r.get("Surface", ""),
            "races": r.get("Course races", ""),
            "sprint": r.get("5–6f strongest IV", ""),
            "mile": r.get("7–8f strongest IV", ""),
            "middle": r.get("9–12f strongest IV", ""),
            "staying": r.get("13f+ strongest IV", ""),
            "confidence": r.get("Evidence confidence", ""),
            "reading": r.get("Practical interpretation", ""),
        })

    out = []
    for p in profiles:
        name = p["Racecourse"]
        g = going.get(name, {})
        out.append({
            "course": name,
            "nation": p.get("Nation / region", ""),
            "code": p.get("Code", ""),
            "surfaces": p.get("Surface(s)", ""),
            "direction": p.get("Direction", ""),
            "profile": p.get("Track profile", ""),
            "pace": p.get("Pace / riding tendency", ""),
            "drawHeadline": p.get("Draw headline", ""),
            "angle": p.get("Best quick angle", ""),
            "trap": p.get("Main trap", ""),
            "groundNote": p.get("Ground / surface note", ""),
            "confidence": p.get("Guide confidence", ""),
            "going": {
                "firm": g.get("Firm / fast", ""),
                "good": g.get("Good", ""),
                "soft": g.get("Soft", ""),
                "heavy": g.get("Heavy", ""),
            },
            "draw": draw.get(name, []),
        })

    OUT.write_text(json.dumps(
        {"source": SRC.name,
         "note": "Dan's cheat sheet. Converted by scripts/import-course-guide.py — edit the workbook, not this file.",
         "courses": out},
        indent=2, ensure_ascii=False) + "\n")
    print(f"  {len(out)} courses -> {OUT}")
    missing = [c["course"] for c in out if not c["going"]["soft"]]
    if missing:
        print(f"  no going guide for: {', '.join(missing)}")


main()

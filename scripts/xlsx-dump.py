# Print the first rows of every sheet of an .xlsx (used by the Probe workflow to show the real layout of an official spreadsheet).
# Usage: python3 scripts/xlsx-dump.py file.xlsx [rows]. Standard library only.
import sys, zipfile, re
import xml.etree.ElementTree as ET
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
def col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1
z = zipfile.ZipFile(sys.argv[1]); limit = int(sys.argv[2]) if len(sys.argv) > 2 else 70
shared = []
if "xl/sharedStrings.xml" in z.namelist():
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
        shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
wb = ET.fromstring(z.read("xl/workbook.xml"))
rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
for sh in wb.find("m:sheets", NS):
    rid = sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
    path = "xl/" + rels[rid].lstrip("/").replace("xl/", "")
    print("--- SHEET:", sh.get("name"))
    shown = 0
    for row in ET.fromstring(z.read(path)).iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS); t = c.get("t")
            if t == "inlineStr": val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is None: continue
            elif t == "s": val = shared[int(v.text)]
            else: val = v.text
            cells[col(c.get("r"))] = val
        if cells:
            print("|".join(cells.get(i, "") for i in range(max(cells) + 1))); shown += 1
        if shown >= limit: break

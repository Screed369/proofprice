import sys, zipfile, re, collections
import xml.etree.ElementTree as ET
M="{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
def col(ref):
    n=0
    for ch in re.match(r"[A-Z]+",ref).group(0): n=n*26+ord(ch)-64
    return n-1
z=zipfile.ZipFile(sys.argv[1])
sh=[ "".join(t.text or "" for t in si.iter(M+"t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M+"si")]
def rows(path):
    for row in ET.fromstring(z.read(path)).iter(M+"row"):
        d={}
        for c in row.findall(M+"c"):
            v=c.find(M+"v"); t=c.get("t")
            if t=="inlineStr": val="".join(x.text or "" for x in c.iter(M+"t"))
            elif v is None: continue
            elif t=="s": val=sh[int(v.text)]
            else: val=v.text
            d[col(c.get("r"))]=val
        if d: yield [d.get(i,"") for i in range(max(d)+1)]
print(z.read("xl/workbook.xml").decode()[:1500])
for p in ("xl/worksheets/sheet5.xml","xl/worksheets/sheet4.xml"):
    R=list(rows(p)); print("=====",p,len(R)); print(R[0])
    per=collections.Counter((r[0],r[1]) for r in R[1:] if len(r)>2)
    print("periods",sorted(per.items()))
    last=sorted(per)[-1] if per else None
    seg=collections.Counter((r[2],r[3],r[4],r[7],r[8]) for r in R[1:] if len(r)>8 and (r[0],r[1])==last)
    for k,v in sorted(seg.items()): print(" ",k,v)
    n=0
    for r in R[1:]:
        if len(r)>8 and (r[0],r[1])==last and r[2]=="Woning" and r[3]=="Elektriciteit" and r[4]=="Afname" and r[8].startswith("Enkelvoudige meter dag") and n<14:
            print("SAMPLE",r[:9],r[-1]); n+=1
    n=0
    for r in R[1:]:
        if len(r)>8 and (r[0],r[1])==last and r[2]=="Woning" and r[3]=="Gas" and r[4]=="Afname" and n<8:
            print("GAS",r[:9],r[-1]); n+=1
    vals=collections.Counter(r[7] for r in R[1:] if len(r)>7)
    print("vast/var",vals)

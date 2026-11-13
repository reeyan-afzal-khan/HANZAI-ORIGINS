"""build-fonts.py — the Chinese faces the app carries for devices that have none.

    KaiTi.ttf, if a path to one is given; else LXGWWenKai-Regular.ttf, fetched
                                               ->  app/fonts/hskker-kai.woff2       (楷 Kai)
    ZhuqueFangsong-Regular.ttf (fetched)                  ->  app/fonts/hskker-fangsong.woff2  (仿宋 FangSong)

KaiTi and FangSong are faces Windows and macOS ship and Android does not, so
on a phone the picker's Kai and FangSong did nothing. The app therefore
carries a Kai and a FangSong of its own. For Kai, a KaiTi.ttf named on the
command line — the owner's own copy of the Windows face, which is not an open
font and is not in the repository — is used when it is there, so the app
shows the same KaiTi on every device; otherwise the open LXGW WenKai
(霞鹜文楷) is fetched and used. For FangSong, the device's own face is asked
for first and the open Zhuque Fangsong (朱雀仿宋) stands in; both open faces
are under the SIL Open Font License 1.1.

The full fonts are 25 MB and 9 MB, so each is cut to the characters this app
can show: every hanzi in app/data (the syllabus, both scripts, the sentences),
all of GB 2312 and the first level of Big5 — some 9,000 characters, which
covers ordinary modern text in either script — plus pinyin letters and
Chinese punctuation, and written as WOFF2. Anything rarer falls through to
the next face in the stack, glyph by glyph. The subsets are renamed, as the
OFL asks of modified versions, and the originals are credited in
app/fonts/LICENSES.txt.

Needs Python with fonttools and brotli (pip install fonttools brotli). The
source fonts are fetched into node_modules/.cache/hskker/fonts/ if they are not there.
"""
import glob, io, os, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "node_modules", ".cache", "hskker", "fonts")
OUT = os.path.join(ROOT, "app", "fonts")
os.makedirs(SRC, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    import brotli  # noqa: F401  (woff2 needs it)
except ImportError:
    sys.exit("needs fonttools and brotli: pip install fonttools brotli")

KAITI = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, "KaiTi.ttf")
FACES = [
    {
        "src": KAITI,
        "out": os.path.join(OUT, "hskker-kai.woff2"),
        "family": "HSKKER Kai",
        "credit": "KaiTi (楷体) 5.01 — © Beijing ZhongYi Electronics Co., 1995-2005. The owner's own copy of the "
                  "Windows face, supplied by its owner; not an open font, and not for redistribution "
                  "beyond this app.",
    } if os.path.exists(KAITI) else {
        "src": os.path.join(SRC, "LXGWWenKai-Regular.ttf"),
        "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf",
        "out": os.path.join(OUT, "hskker-kai.woff2"),
        "family": "HSKKER Kai",
        "credit": "LXGW WenKai (霞鹜文楷) Regular v1.522 — Copyright 2021-2026 LXGW (https://github.com/lxgw/LxgwWenKai), "
                  "derived from Klee One, Copyright 2020 The Klee Project Authors. SIL Open Font License 1.1.",
    },
    {
        "src": os.path.join(SRC, "zhuque", "ZhuqueFangsong-Regular.ttf"),
        "url": "https://github.com/TrionesType/zhuque/releases/download/v0.212/ZhuqueFangsong-v0.212.zip",
        "zip": True,
        "out": os.path.join(OUT, "hskker-fangsong.woff2"),
        "family": "HSKKER FangSong",
        "credit": "Zhuque Fangsong (朱雀仿宋) Regular v0.212 — Copyright 2023 JadeFoci (https://github.com/TrionesType/zhuque). "
                  "SIL Open Font License 1.1.",
    },
]

def fetch(face):
    if os.path.exists(face["src"]):
        return
    print("fetching", face["url"])
    if face.get("zip"):
        tmp = face["src"] + ".zip"
        urllib.request.urlretrieve(face["url"], tmp)
        with zipfile.ZipFile(tmp) as z:
            z.extractall(os.path.dirname(face["src"]))
        os.remove(tmp)
    else:
        urllib.request.urlretrieve(face["url"], face["src"])

def charset():
    """Every hanzi the app itself can show, all of GB 2312, Big5 level 1."""
    chars = set()
    for f in glob.glob(os.path.join(ROOT, "app", "data", "**", "*.js"), recursive=True):
        if "strokes" in f.replace("\\", "/").split("/"):
            continue
        s = io.open(f, encoding="utf-8", errors="ignore").read()
        chars.update(c for c in s if 0x3400 <= ord(c) <= 0x9FFF or 0xF900 <= ord(c) <= 0xFAFF)
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try: chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError: pass
    for hi in range(0xA4, 0xC7):
        for lo in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            try:
                c = bytes([hi, lo]).decode("big5")
                if 0x4E00 <= ord(c) <= 0x9FFF: chars.add(c)
            except UnicodeDecodeError: pass
    codes = set(ord(c) for c in chars)
    # Latin and pinyin (tone marks and the letters that carry them), Chinese
    # punctuation, fullwidth forms, radicals, bopomofo.
    for a, b in [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x1CD, 0x1DC), (0x300, 0x36F),
                 (0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF), (0x2E80, 0x2EFF),
                 (0x2F00, 0x2FDF), (0x3100, 0x312F)]:
        codes.update(range(a, b + 1))
    codes.update([0x1E3E, 0x1E3F])   # ḿ
    return codes

def rename(font, family):
    """A modified version under the OFL takes a name of its own."""
    name = font["name"]
    for rec in list(name.names):
        nid = rec.nameID
        if nid in (1, 16):
            rec.string = family
        elif nid in (4, 3):
            rec.string = family + (" Regular" if nid == 4 else "")
        elif nid == 6:
            rec.string = family.replace(" ", "") + "-Regular"
        elif nid in (7,):
            name.removeNames(nameID=nid)

def build(face, codes):
    font = TTFont(face["src"])
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=codes)
    s.subset(font)
    rename(font, face["family"])
    font.flavor = "woff2"
    font.save(face["out"])
    cmap = font.getBestCmap()
    have = sum(1 for c in codes if c in cmap)
    print(f"  {os.path.relpath(face['src'], ROOT)} -> {os.path.relpath(face['out'], ROOT)}  "
          f"{os.path.getsize(face['out']) // 1024} KB  {len(font.getGlyphOrder())} glyphs  ({have}/{len(codes)} of the set)")

codes = charset()
print(f"character set: {len(codes)} code points")
for face in FACES:
    fetch(face)
    build(face, codes)

ofl = os.path.join(SRC, "OFL.txt")
if not os.path.exists(ofl):
    urllib.request.urlretrieve("https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt", ofl)
body = io.open(ofl, encoding="utf-8").read()
body = body[body.index("SIL OPEN FONT LICENSE"):] if "SIL OPEN FONT LICENSE" in body else body
io.open(os.path.join(OUT, "LICENSES.txt"), "w", encoding="utf-8", newline="\n").write(
    "The Chinese faces bundled with HANZAI-ORIGINS: a Kai, and a FangSong for devices that have none of\n"
    "their own. Each is a subset (about 9,000 characters) of its source, renamed; the sources are:\n\n"
    + f"  hskker-kai.woff2       {FACES[0]['credit']}\n  hskker-fangsong.woff2  {FACES[1]['credit']}\n"
    + "\nThe open faces are under the SIL Open Font License 1.1 (LXGW WenKai additionally permits\n"
    "subsetted web-font versions to keep its Reserved Font Names; this build renames anyway):\n\n" + body)
print("wrote app/fonts/LICENSES.txt")

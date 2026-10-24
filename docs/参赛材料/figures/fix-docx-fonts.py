"""Make every run use one concrete CJK font on all four font slots.

Some DOCX viewers ignore w:eastAsia and fall back to w:ascii. If w:ascii is a
Latin-only font (Times New Roman), Chinese disappears or turns into boxes.
Setting ascii/hAnsi/eastAsia/cs to Microsoft YaHei makes the same font apply
no matter which slot the viewer honors.
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path

DOCX = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else Path(__file__).resolve().parents[1] / "AI就业小助手-项目介绍文档.docx"
)
TMP = DOCX.with_suffix(".tmp.docx")
FONT = "Microsoft YaHei"


def fix_rfonts(xml: str) -> str:
    def repl(_match: re.Match) -> str:
        return (
            f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" '
            f'w:eastAsia="{FONT}" w:cs="{FONT}" w:hint="eastAsia"/>'
        )

    return re.sub(r"<w:rFonts\b[^>]*/>", repl, xml)


def main() -> None:
    with zipfile.ZipFile(DOCX, "r") as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}

    for name in list(entries):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        try:
            text = entries[name].decode("utf-8")
        except UnicodeDecodeError:
            continue
        entries[name] = fix_rfonts(text).encode("utf-8")

    theme_name = "word/theme/theme1.xml"
    if theme_name in entries:
        theme = entries[theme_name].decode("utf-8")
        for tag in ("latin", "ea", "cs"):
            theme = re.sub(
                rf'(<a:{tag} typeface=")[^"]*(")',
                rf"\g<1>{FONT}\g<2>",
                theme,
            )
        entries[theme_name] = theme.encode("utf-8")

    with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)
    shutil.move(str(TMP), str(DOCX))
    print("font-fixed:", DOCX)


if __name__ == "__main__":
    main()

"""Noto KR 글꼴을 정적 Regular로 만들고 PDF의 유니코드 역매핑을 보존합니다."""
from copy import deepcopy
from pathlib import Path
import subprocess
import tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root=Path(__file__).resolve().parents[1]/'public/fonts'
revision='809e4d8b8d7e9364a914909bb777679606c178b8'
root.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='dalpdf-fonts-') as directory:
    for family,label in [('sans','NotoSansKR'),('serif','NotoSerifKR')]:
        source=Path(directory)/(family+'.ttf')
        url=f'https://raw.githubusercontent.com/google/fonts/{revision}/ofl/{label.lower()}/{label}%5Bwght%5D.ttf'
        subprocess.run(['curl','-fL','--retry','3',url,'-o',str(source)],check=True)
        font=TTFont(source)
        instantiateVariableFont(font,{'wght':400},inplace=True)
        # 같은 글리프를 공유하는 日/⽇ 등의 문자가 PDF에서 서로 바뀌지 않게 분리합니다.
        seen=set();order=list(font.getGlyphOrder())
        for codepoint,glyph in sorted(font.getBestCmap().items()):
            if glyph not in seen:
                seen.add(glyph);continue
            name=f'dalpdf.uni{codepoint:06X}'
            font['glyf'][name]=deepcopy(font['glyf'][glyph])
            font['hmtx'][name]=font['hmtx'][glyph]
            if 'vmtx' in font:font['vmtx'][name]=font['vmtx'][glyph]
            order.append(name)
            for cmap in font['cmap'].tables:
                if cmap.isUnicode() and codepoint in getattr(cmap,'cmap',{}):cmap.cmap[codepoint]=name
        font.setGlyphOrder(order)
        font.save(root/(family+'.ttf'))

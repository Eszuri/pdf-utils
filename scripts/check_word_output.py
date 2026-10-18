"""Compare any source PDF, generated DOCX, and optional rendered PDF."""
import argparse
from collections import Counter
from contextlib import redirect_stdout
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
from zipfile import ZipFile

import pymupdf
from lxml import etree

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from pdf_word.convert import characters
from pdf_word.extract import extract_page
from pdf_word.markdown import HeadingParser, normalize_page


def normalized(text):
    return Counter(c for c in unicodedata.normalize('NFKC',text) if not c.isspace())


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--rendered-pdf',type=Path)
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    with pymupdf.open(args.source) as pdf:
        texts=[p.get_text() for p in pdf]
        sizes=[(p.rect.width,p.rect.height) for p in pdf]
    with ZipFile(args.output) as package:
        root=etree.fromstring(package.read('word/document.xml'))
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        output=''.join(root.xpath('//w:t/text()',namespaces=ns))
        geometry=[(int(s.get('{'+ns['w']+'}w'))/20,int(s.get('{'+ns['w']+'}h'))/20)
                  for s in root.xpath('//w:pgSz',namespaces=ns)]
        tables=len(root.xpath('//w:tbl',namespaces=ns))
        heading_count=len(root.xpath('//w:pPr/w:pStyle[starts-with(@w:val,"Heading")]',namespaces=ns))
    removed=['']*len(texts)
    if heading_count:
        parser=HeadingParser()
        with pymupdf.open(args.source) as pdf, redirect_stdout(sys.stderr):
            for i,page in enumerate(pdf):
                removed[i]=normalize_page(extract_page(page,i+1),parser).removed_markdown
    expected=characters(''.join(texts))-characters(''.join(removed)); actual=characters(output)
    report={'sourcePages':len(texts),'docxSections':len(geometry),'nativeTables':tables,
            'missingCharacters':sum((expected-actual).values()),'addedCharacters':sum((actual-expected).values()),
            'markdownHeadings':heading_count,'removedMarkdownCharacters':sum(characters(''.join(removed)).values()),
            'pageGeometryMatches':len(sizes)==len(geometry) and all(abs(a-c)<.1 and abs(b-d)<.1 for (a,b),(c,d) in zip(sizes,geometry)),
            'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
            'outputSha256':hashlib.sha256(args.output.read_bytes()).hexdigest()}
    if args.rendered_pdf:
        with pymupdf.open(args.rendered_pdf) as rendered:
            report['renderedPages']=len(rendered)
            differences=[]
            for i,source in enumerate(texts):
                text=rendered[i].get_text() if i<len(rendered) else ''
                missing=(normalized(source)-normalized(removed[i]))-normalized(text)
                if missing:
                    differences.append({'page':i+1,'count':sum(missing.values()),
                                        'characters':dict(missing)})
            report['renderedTextDifferences']=differences
    data=json.dumps(report,ensure_ascii=True,indent=2)
    print(data)
    if args.report: args.report.write_text(data,encoding='utf-8')
    return int(bool(report['missingCharacters'] or report['addedCharacters'] or not report['pageGeometryMatches']))


if __name__=='__main__':
    sys.exit(main())

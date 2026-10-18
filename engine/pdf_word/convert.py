import os
import sys
import tempfile
from contextlib import redirect_stdout
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

import pymupdf
from lxml import etree

from .extract import extract_page
from .markdown import HeadingParser, normalize_page
from .write import Writer, clean_text


def characters(text):
    return Counter(c for c in clean_text(text) if not c.isspace())


def validate(path, source_text, image_count, removed_markdown=''):
    with ZipFile(path) as package:
        bad = package.testzip()
        if bad:
            raise ValueError(f'Invalid DOCX archive: {bad}')
        root = etree.fromstring(package.read('word/document.xml'))
        ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
              'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
        text = ''.join(root.xpath('//w:t/text()',namespaces=ns))
        expected = characters(source_text)-characters(removed_markdown)
        missing = expected-characters(text)
        added = characters(text)-expected
        if missing or added:
            raise ValueError(f'TEXT_VALIDATION_FAILED: missing {sum(missing.values())}, added {sum(added.values())} characters')
        if len(root.xpath('//a:blip',namespaces=ns)) != image_count:
            raise ValueError('IMAGE_VALIDATION_FAILED: image count differs from source')
        return len(text)


def convert(input_path, output_path, emit=lambda event:None):
    source, target = Path(input_path).resolve(), Path(output_path).resolve()
    if not source.is_file() or source.suffix.lower() != '.pdf':
        raise ValueError('INVALID_INPUT: select an existing PDF file')
    if target.suffix.lower() != '.docx' or source == target:
        raise ValueError('INVALID_OUTPUT: output must be a separate .docx file')
    if not target.parent.is_dir():
        raise ValueError('INVALID_OUTPUT: output directory does not exist')
    external_temp = os.environ.get('PDF_WORD_TEMP')
    if external_temp:
        path = Path(external_temp).resolve()
        if path.parent != target.parent or not path.name.startswith('.pdf-utils-') or not path.is_file():
            raise ValueError('INVALID_TEMP: invalid job temporary file')
        temp_path = str(path)
    else:
        fd, temp_path = tempfile.mkstemp(prefix='.pdf-utils-',suffix='.docx',dir=target.parent)
        os.close(fd)
    def check_cancelled():
        marker = os.environ.get('PDF_WORD_CANCEL')
        if marker and Path(marker).is_file():
            raise InterruptedError('CANCELLED')
    try:
        check_cancelled()
        with pymupdf.open(source) as pdf:
            if pdf.needs_pass:
                raise ValueError('PASSWORD_REQUIRED: encrypted PDF is not supported yet')
            if not len(pdf):
                raise ValueError('EMPTY_PDF: document has no pages')
            writer = Writer()
            headings = HeadingParser()
            texts, warnings = [], []
            removed = []
            heading_count = 0
            image_count = table_count = graphics_count = 0
            emit({'kind':'progress','phase':'reading','page':0,'total':len(pdf)})
            for index in range(len(pdf)):
                check_cancelled()
                with redirect_stdout(sys.stderr):
                    page = extract_page(pdf[index],index+1)
                page = normalize_page(page, headings)
                writer.page(page)
                texts.append(page.source_text)
                removed.append(page.removed_markdown)
                heading_count += page.markdown_headings
                warnings.extend(page.warnings)
                image_count += len(page.pictures)
                graphics_count += bool(page.background)
                table_count += len(page.tables)
                emit({'kind':'progress','phase':'converting','page':index+1,'total':len(pdf)})
            emit({'kind':'progress','phase':'validating','page':len(pdf),'total':len(pdf)})
            writer.save(temp_path)
            count = validate(temp_path,''.join(texts),image_count+graphics_count,''.join(removed))
            result = {'kind':'result','pages':len(pdf),'tables':table_count,'images':image_count,
                      'graphicsPages':graphics_count,'markdownHeadings':heading_count,
                      'characters':count,'warnings':warnings,'outputPath':str(target)}
        check_cancelled()
        os.replace(temp_path,target)
        emit(result)
        return result
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

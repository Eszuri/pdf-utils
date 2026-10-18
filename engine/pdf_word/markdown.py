"""Recognize ATX heading syntax without changing literal hash characters."""
from dataclasses import replace
import re

from .layout import reading_order
from .model import Line


class HeadingParser:
    def __init__(self):
        self.fence = None

    def parse(self, line):
        text = ''.join(span.text for span in line.spans)
        fence = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', text)
        if self.fence:
            if (fence and fence[1][0] == self.fence[0]
                    and len(fence[1]) >= self.fence[1] and not fence[2].strip()):
                self.fence = None
            return line, ''
        if fence:
            self.fence = (fence[1][0], len(fence[1]))
            return line, ''
        # A source code comment rendered with a monospace font stays a comment.
        content = [span for span in line.spans if span.text.strip()]
        if content and all(span.flags & 8 for span in content):
            return line, ''
        # PDF font encodings can expose a visual space as a nonbreaking space.
        # Accept horizontal Unicode whitespace without joining separate lines.
        opening = re.match(r'^ {0,3}(#{1,6})[^\S\r\n]+(?=\S)', text)
        if not opening:
            return line, ''
        start, end = opening.end(), len(text)
        closing = re.search(r'[^\S\r\n]+#+[^\S\r\n]*$', text[start:])
        if closing:
            end = start + closing.start()
        if not text[start:end].strip():
            return line, ''
        spans, position = [], 0
        for span in line.spans:
            left, right = max(0, start-position), min(len(span.text), end-position)
            if right > left:
                spans.append(replace(span, text=span.text[left:right]))
            position += len(span.text)
        return replace(line, spans=spans, heading_level=len(opening[1])), text[:start]+text[end:]


def normalize_page(page, parser):
    """Return a new page and an exact ledger of intentionally removed markup."""
    lines, tables, removed = [], [], []
    headings = 0
    for region in reading_order(page.lines + page.tables, page.height):
        if isinstance(region, Line):
            line, markup = parser.parse(region)
            lines.append(line)
            removed.append(markup)
            headings += line.heading_level is not None
        else:
            cells = []
            for cell in region.cells:
                # Code fences in a cell must not affect another cell or the body.
                cell_parser = HeadingParser()
                cell_lines = []
                for original in sorted(cell.lines, key=lambda l:(l.spans[0].origin[1],l.spans[0].origin[0])):
                    line, markup = cell_parser.parse(original)
                    cell_lines.append(line)
                    removed.append(markup)
                    headings += line.heading_level is not None
                cells.append(replace(cell, lines=cell_lines))
            tables.append(replace(region, cells=cells))
    return replace(page, lines=lines, tables=tables,
                   removed_markdown=''.join(removed), markdown_headings=headings)

"""Read source geometry without document-specific text or filename rules."""
import math

import pymupdf

from .model import Cell, Line, Page, Picture, Span, Table
from .images import extract_picture
from .cells import merge_cell_lines
from .graphics import table_grid, border_style, recover_underlines


def _edges(values):
    result = []
    for value in sorted(values):
        if not result or value - result[-1] > 1:
            result.append(value)
    return result


def _contains(box, span):
    x = (span.bbox[0] + span.bbox[2]) / 2
    y = (span.bbox[1] + span.bbox[3]) / 2
    return box[0] - .5 <= x <= box[2] + .5 and box[1] - .5 <= y <= box[3] + .5


def extract_page(source, number):
    # Rotation is display metadata. Work on the page's unrotated coordinate system.
    rotation = source.rotation
    if rotation:
        source.set_rotation(0)
    data = source.get_text('rawdict', flags=pymupdf.TEXTFLAGS_DICT)
    lines, pictures, warnings = [], [], []
    for block in data['blocks']:
        if block['type'] == 1:
            picture = extract_picture(source,block)
            if picture:
                pictures.append(picture)
        elif block['type'] == 0:
            for raw in block['lines']:
                spans = []
                for s in raw['spans']:
                    text = ''.join(c['c'] for c in s['chars'])
                    if not text or not all(math.isfinite(v) for v in s['bbox']):
                        continue
                    spans.append(Span(text, tuple(s['bbox']), tuple(s['origin']),
                                      s['font'], s['size'], s['flags'],
                                      s.get('char_flags', 0), s['color'],
                                      [(c['c'],tuple(c['bbox']),tuple(c['origin'])) for c in s['chars']]))
                if spans:
                    lines.append(Line(spans, tuple(raw['bbox']), tuple(raw['dir'])))

    source_text = ''.join(s.text for line in lines for s in line.spans)
    if pictures and not source_text.strip():
        raise ValueError(f'OCR_REQUIRED: page {number} contains images without selectable text')
    if any(abs(line.direction[1]) > .05 for line in lines):
        warnings.append(f'Page {number}: rotated text is preserved as editable horizontal text.')
    if rotation:
        warnings.append(f'Page {number}: page rotation {rotation} normalized to source orientation.')

    tables = []
    try:
        detected = source.find_tables(strategy='lines_strict', snap_tolerance=4, join_tolerance=4)
        for t in detected.tables:
            boxes = list(dict.fromkeys(tuple(c) for row in t.rows for c in row.cells if c))
            xs = _edges([x for b in boxes for x in (b[0], b[2])])
            ys = _edges([y for b in boxes for y in (b[1], b[3])])
            if len(xs) < 3 or len(ys) < 3:
                continue
            cells = []
            for box in boxes:
                c0, c1 = [min(range(len(xs)), key=lambda k: abs(xs[k] - x)) for x in (box[0], box[2])]
                r0, r1 = [min(range(len(ys)), key=lambda k: abs(ys[k] - y)) for y in (box[1], box[3])]
                if c1 > c0 and r1 > r0:
                    cells.append(Cell(r0, c0, r1-r0, c1-c0, box))
            tables.append(Table(tuple(t.bbox), xs, ys, cells))
    except Exception as error:
        warnings.append(f'Page {number}: table detection unavailable; text preserved ({type(error).__name__}).')

    # Assign each span exactly once, keeping all unassigned text as paragraphs.
    remaining = []
    for line in lines:
        groups = {}
        outside = []
        for span in line.spans:
            match = next(((ti, ci) for ti, t in enumerate(tables)
                          for ci, cell in enumerate(t.cells) if _contains(cell.bbox, span)), None)
            if match is None:
                outside.append(span)
            else:
                groups.setdefault(match, []).append(span)
        for (ti, ci), spans in groups.items():
            box = (min(s.bbox[0] for s in spans), min(s.bbox[1] for s in spans),
                   max(s.bbox[2] for s in spans), max(s.bbox[3] for s in spans))
            tables[ti].cells[ci].lines.append(Line(spans, box, line.direction))
        if outside:
            bbox = (min(s.bbox[0] for s in outside), min(s.bbox[1] for s in outside),
                    max(s.bbox[2] for s in outside), max(s.bbox[3] for s in outside))
            remaining.append(Line(outside, bbox, line.direction))

    # PDF list markers and item text often belong to different text blocks.
    # Rejoin fragments on the same baseline before heading recognition/writing.
    for table in tables:
        for cell in table.cells:
            cell.lines = merge_cell_lines(cell.lines)

    # Cell shading comes from source filled vector rectangles, not text labels.
    drawings = source.get_drawings()
    all_lines = remaining+[line for table in tables for cell in table.cells for line in cell.lines]
    decorations = recover_underlines(all_lines,drawings,tables)
    for t in tables:
        border_style(t,drawings)
        for cell in t.cells:
            for drawing in drawings:
                fill = drawing.get('fill')
                rect = drawing['rect']
                overlap = rect & pymupdf.Rect(cell.bbox)
                area = (cell.bbox[2]-cell.bbox[0])*(cell.bbox[3]-cell.bbox[1])
                if fill and overlap.get_area() >= area*.9:
                    cell.fill = ''.join(f'{min(255, max(0, round(v*255))):02X}' for v in fill[:3])
    page = Page(number, source.rect.width, source.rect.height, remaining, tables, pictures, source_text, warnings)
    # Preserve vector-only artwork as a transparent background. Text and native
    # table content are never rasterized into this image.
    with pymupdf.open() as graphics:
        canvas = graphics.new_page(width=page.width, height=page.height)
        count = 0
        for di,d in enumerate(drawings):
            shape = canvas.new_shape()
            supported = True
            kept = 0
            for ii,item in enumerate(d['items']):
                # Exclude only reconstructed grid edges/shading and native
                # underlines, never all artwork inside a table's rectangle.
                if (di,ii) in decorations or any(table_grid(item,t) for t in tables):
                    continue
                kept += 1
                if item[0] == 'l': shape.draw_line(item[1],item[2])
                elif item[0] == 're': shape.draw_rect(item[1])
                elif item[0] == 'qu': shape.draw_quad(item[1])
                elif item[0] == 'c': shape.draw_bezier(*item[1:5])
                else: supported = False
            if not kept:
                continue
            if not supported:
                warnings.append(f'Page {number}: an unsupported vector path could not be reconstructed.')
            shape.finish(color=d.get('color'), fill=d.get('fill'), width=d.get('width') or 0,
                         closePath=d.get('closePath',False), even_odd=d.get('even_odd',False),
                         stroke_opacity=d.get('stroke_opacity') if d.get('stroke_opacity') is not None else 1,
                         fill_opacity=d.get('fill_opacity') if d.get('fill_opacity') is not None else 1,
                         dashes=d.get('dashes') or '[] 0')
            shape.commit()
            count += 1
        if count:
            # Word can render SVG paths at any zoom. Older readers use the PNG.
            fallback = canvas.get_pixmap(dpi=300,alpha=True).tobytes('png')
            svg = canvas.get_svg_image(text_as_path=False).encode('utf-8')
            page.background = Picture((0,0,page.width,page.height),fallback,svg)
    if rotation:
        source.set_rotation(rotation)
    return page

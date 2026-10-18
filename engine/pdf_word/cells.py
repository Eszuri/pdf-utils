"""Reconstruct visual lines within a cell, independent of PDF text blocks."""
from dataclasses import replace


def baseline(line):
    size = max(s.size for s in line.spans)
    return max(s.origin[1] for s in line.spans if s.size >= size*.85)


def merge_cell_lines(lines):
    rows = []
    for line in sorted(lines, key=lambda item:(baseline(item), item.bbox[0])):
        size = max(s.size for s in line.spans)
        match = None
        for row in reversed(rows):
            difference = baseline(line)-baseline(row)
            if difference > max(2, size*.2):
                break
            horizontal = abs(line.direction[1]) < .05 and abs(row.direction[1]) < .05
            tolerance = max(.5, min(size, max(s.size for s in row.spans))*.15)
            separate = line.bbox[0] >= row.bbox[2]-.5 or row.bbox[0] >= line.bbox[2]-.5
            if horizontal and abs(difference) <= tolerance and separate:
                match = row
                break
        if match is None:
            rows.append(line)
        else:
            index = rows.index(match)
            spans = sorted(match.spans+line.spans, key=lambda span:span.bbox[0])
            box = (min(match.bbox[0],line.bbox[0]), min(match.bbox[1],line.bbox[1]),
                   max(match.bbox[2],line.bbox[2]), max(match.bbox[3],line.bbox[3]))
            rows[index] = replace(match, spans=spans, bbox=box)
    return rows


def span_gaps(spans):
    """Return horizontal gaps that need a tab rather than an ordinary space."""
    # PDF position rounding is sub-point. A font-size-relative cutoff drops
    # real short gaps, especially after wider, multi-digit list markers.
    return {i:span.bbox[0] for i,span in enumerate(spans) if i
            and span.bbox[0]-spans[i-1].bbox[2] > .5}


def vertical_alignment(cell):
    spans=[span for line in cell.lines for span in line.spans if span.text.strip()]
    if not spans:
        return 'top'
    top=min(span.bbox[1] for span in spans)-cell.bbox[1]
    bottom=cell.bbox[3]-max(span.bbox[3] for span in spans)
    tolerance=max(span.size for span in spans)*.5
    if top <= tolerance:
        return 'top'
    if bottom <= tolerance:
        return 'bottom'
    if abs(top-bottom) <= max(tolerance,(cell.bbox[3]-cell.bbox[1])*.05):
        return 'center'
    return 'top'  # Custom inset is retained separately from alignment semantics.


def top_baselines(table):
    """Use top-aligned source peers to retain a font's first-line inset."""
    result={}
    for cell in table.cells:
        visible=[line for line in cell.lines if any(s.text.strip() for s in line.spans)]
        if not visible:
            continue
        line=min(visible,key=baseline)
        span=max((s for s in line.spans if s.text.strip()),key=lambda s:s.size)
        if min(s.bbox[1] for s in line.spans if s.text.strip())-cell.bbox[1] > max(3,span.size*.4):
            continue
        key=(span.font,round(span.size,1))
        offset=baseline(line)-cell.bbox[1]
        result[key]=min(result.get(key,offset),offset)
    return result

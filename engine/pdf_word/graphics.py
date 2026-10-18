"""Distinguish table edges, native text decoration, and independent artwork."""
from collections import Counter, defaultdict
from dataclasses import replace


def table_grid(item, table):
    kind = item[0]
    if kind == 'l':
        a,b = item[1:3]
        x0,x1 = sorted((a.x,b.x)); y0,y1 = sorted((a.y,b.y))
    elif kind == 're':
        x0,y0,x1,y1 = item[1]
    else:
        return False
    left,top,right,bottom = table.bbox
    if not (left-1 <= x0 <= x1 <= right+1 and top-1 <= y0 <= y1 <= bottom+1):
        return False
    near_x = lambda x:any(abs(x-edge) <= 1 for edge in table.xs)
    near_y = lambda y:any(abs(y-edge) <= 1 for edge in table.ys)
    if x1-x0 <= 2 and near_x((x0+x1)/2):
        return True
    if y1-y0 <= 2 and near_y((y0+y1)/2):
        return True
    return kind == 're' and near_x(x0) and near_x(x1) and near_y(y0) and near_y(y1)


def border_style(table, drawings):
    colors, widths = Counter(), Counter()
    for drawing in drawings:
        for item in drawing['items']:
            if not table_grid(item,table):
                continue
            if item[0] == 're' and drawing.get('fill') is not None:
                rect=item[1]
                width=min(rect.width,rect.height)
                if width > 2:
                    continue  # Cell shading is not a border.
                color=drawing['fill']
            else:
                width=drawing.get('width') or .5
                color=drawing.get('color')
            if color is not None:
                colors[''.join(f'{min(255,max(0,round(c*255))):02X}' for c in color[:3])]+=1
                widths[round(width,2)]+=1
    if colors:
        table.border_color=colors.most_common(1)[0][0]
        table.border_width=widths.most_common(1)[0][0]


def horizontal_rule(item, drawing):
    if item[0] == 'l':
        a,b=item[1:3]
        if abs(a.y-b.y) <= .25 and (drawing.get('width') or 0) <= 2:
            return min(a.x,b.x),(a.y+b.y)/2,max(a.x,b.x)
    elif item[0] == 're' and drawing.get('fill') is not None:
        rect=item[1]
        if rect.height <= 2 and rect.width > max(1,rect.height*3):
            return rect.x0,(rect.y0+rect.y1)/2,rect.x1
    return None


def recover_underlines(lines, drawings, tables):
    """Map thin rules to the glyphs they cover, including partial-span rules."""
    spans=[span for line in lines if abs(line.direction[1]) < .05 for span in line.spans]
    marked=defaultdict(set)
    handled=set()
    for di,drawing in enumerate(drawings):
        for ii,item in enumerate(drawing['items']):
            if any(table_grid(item,table) for table in tables):
                continue
            rule=horizontal_rule(item,drawing)
            if rule is None:
                continue
            x0,y,x1=rule
            matches,intervals=[],[]
            for span in spans:
                if not .02*span.size <= y-span.origin[1] <= .35*span.size:
                    continue
                for gi,(text,box,_) in enumerate(span.glyphs):
                    if x0 <= (box[0]+box[2])/2 <= x1:
                        matches.append((span,gi,text))
                        intervals.append((max(x0,box[0]),min(x1,box[2])))
            # A long form rule under a short label is independent artwork.
            covered=0; end=x0
            for left,right in sorted(intervals):
                covered+=max(0,right-max(left,end)); end=max(end,right)
            if covered < (x1-x0)*.85 or not any(text.strip() for _,_,text in matches):
                continue
            handled.add((di,ii))
            for span,gi,_ in matches:
                marked[id(span)].add(gi)
    for line in lines:
        result=[]
        for span in line.spans:
            indexes=marked.get(id(span))
            if not indexes:
                result.append(span)
                continue
            start=0
            while start < len(span.glyphs):
                underlined=start in indexes
                end=start+1
                while end < len(span.glyphs) and (end in indexes) == underlined:
                    end+=1
                glyphs=span.glyphs[start:end]
                box=(min(g[1][0] for g in glyphs),min(g[1][1] for g in glyphs),
                     max(g[1][2] for g in glyphs),max(g[1][3] for g in glyphs))
                result.append(replace(span,text=''.join(g[0] for g in glyphs),bbox=box,
                                      origin=glyphs[0][2],glyphs=glyphs,
                                      char_flags=span.char_flags | (2 if underlined else 0)))
                start=end
        line.spans=result
    return handled

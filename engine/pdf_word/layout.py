"""Order geometric regions without matching their contents."""


def reading_order(elements, page_height):
    top = [e for e in elements if e.bbox[3] < page_height*.06]
    bottom = [e for e in elements if e.bbox[1] > page_height*.94]
    body = [e for e in elements if e not in top and e not in bottom]

    def order(items):
        if len(items) > 10:
            starts = sorted(set(round(e.bbox[0],1) for e in items))
            gaps = sorted(((b-a,b-2) for a,b in zip(starts,starts[1:]) if b-a > 24),reverse=True)
            for _,cut in gaps:
                left = [e for e in items if e.bbox[0] < cut]
                right = [e for e in items if e.bbox[0] >= cut]
                crossing = sum(e.bbox[2] > cut+2 for e in left)
                if len(left) >= 5 and len(right) >= 5 and crossing <= max(1,len(items)*.04):
                    return order(left) + order(right)
        return sorted(items,key=lambda e:(round(e.bbox[1]/2),e.bbox[0]))

    return order(top) + order(body) + order(bottom)

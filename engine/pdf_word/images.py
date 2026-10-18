"""Keep source image pixels; rasterize transformed images only when necessary."""
import math

import pymupdf

from .model import Picture


def extract_picture(source, block):
    original_rect = pymupdf.Rect(block['bbox'])
    rect = original_rect & source.rect
    if rect.is_empty:
        return None
    a,b,c,d,_,_ = block['transform']
    ordinary = abs(b) < .001 and abs(c) < .001 and a > 0 and d > 0
    unclipped = all(abs(x-y) < .01 for x,y in zip(rect,original_rect))
    if ordinary and unclipped:
        data = block['image']
        if block.get('mask'):
            base = pymupdf.Pixmap(data)
            if base.alpha:
                base = pymupdf.Pixmap(base,0)
            if base.colorspace and base.colorspace.n not in (1,3):
                base = pymupdf.Pixmap(pymupdf.csRGB,base)
            mask = pymupdf.Pixmap(block['mask'])
            data = pymupdf.Pixmap(base,mask).tobytes('png')
        elif (block['ext'].lower() not in ('png','jpeg','jpg','gif','bmp','tif','tiff')
              or block.get('colorspace',3) not in (1,3)):
            pix = pymupdf.Pixmap(data)
            if pix.colorspace and pix.colorspace.n not in (1,3):
                pix = pymupdf.Pixmap(pymupdf.csRGB,pix)
            data = pix.tobytes('png')
        return Picture(tuple(rect),data)
    # Rotation, shear, mirroring, or clipping requires the displayed transform.
    # Retain at least the source sampling density and a 300-DPI fallback.
    scale = max(300/72, block['width']/max(original_rect.width,.01),
                block['height']/max(original_rect.height,.01))
    if not math.isfinite(scale):
        raise ValueError('INVALID_IMAGE_TRANSFORM')
    pix = source.get_pixmap(matrix=pymupdf.Matrix(scale,scale),clip=rect,alpha=True)
    return Picture(tuple(rect),pix.tobytes('png'))

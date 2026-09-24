# Builds tvos/Resources/Mixtape/deck/well_open.png: the deck plate's door
# rectangle with the door removed, so the door layers can be drawn (and tilted)
# over it without the baked door showing twice. Glass pixels are un-composited
# (plate = interior*(1-a) + glass*a, solved for interior); the opaque frame
# parts are filled from the adjacent interior, darkened like a recess wall.
import json, numpy as np
from PIL import Image
root='tvos/Resources/Mixtape/deck/'
pm=json.load(open('art-src/mixtape/plates/plate-manifest.json'))
plate=np.asarray(Image.open(root+'deck_empty.png').convert('RGB'),np.float32)
glass=np.asarray(Image.open(root+'door_glass.png').convert('RGBA'),np.float32)
frame=np.asarray(Image.open(root+'door_frame.png').convert('RGBA'),np.float32)
H,W=plate.shape[:2]
def px(r): return int(round(r['x']*W)),int(round(r['y']*H)),int(round((r['x']+r['w'])*W)),int(round((r['y']+r['h'])*H))
x0,y0,x1,y1=px(pm['door'])
a=glass[...,3:4]/255.0
interior=(plate-glass[...,:3]*a)/np.maximum(1-a,1e-3)
interior=np.clip(interior,0,255)
out=interior.copy()
op=frame[...,3]>127
# fill opaque parts: vertical pass from the nearest interior row, darkened
for (ox0,oy0,ox1,oy1) in [px(r) for r in pm['door_opaque_parts']]:
    w,h=ox1-ox0,oy1-oy0
    if w>h*3:   # rails: copy the interior row just inside, darken with depth
        top = oy0 < (y0+y1)/2
        src_y = oy1+2 if top else oy0-2
        row=interior[src_y,ox0:ox1]
        for yy in range(oy0,oy1):
            depth=(oy1-yy)/h if top else (yy-oy0)/h
            out[yy,ox0:ox1]=row*((0.75-0.45*depth) if top else (0.45-0.3*depth))
    else:       # pillars: copy the interior column just inside
        left = ox0 < (x0+x1)/2
        src_x = ox1+2 if left else ox0-2
        col=interior[oy0:oy1,src_x]
        for xx in range(ox0,ox1):
            depth=(ox1-xx)/w if left else (xx-ox0)/w
            out[oy0:oy1,xx]=col*(0.75-0.45*depth)
crop=np.clip(out[y0:y1,x0:x1],0,255).astype(np.uint8)
Image.fromarray(crop,'RGB').save(root+'well_open.png')
print('well_open',crop.shape,(x0,y0,x1,y1))

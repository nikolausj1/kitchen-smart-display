# Removes the baked VU needles from the 4K deck plate so MixtapeView can draw
# live ones. Input: art-src/mixtape/plates/deck_empty_4k.png.
# Output: tvos/Resources/Mixtape/deck/deck_empty.png. Hough-detects each needle
# inside its face, masks a 34 px band from the tip down to the dome top, and
# fills it with cv2.inpaint (Telea).
import cv2, numpy as np
src='art-src/mixtape/plates/deck_empty_4k.png'
dst='tvos/Resources/Mixtape/deck/deck_empty.png'
im=cv2.imread(src)
H,W=im.shape[:2]
faces={'left':(0.04366,0.20202,0.19557,0.19351,0.39341),'right':(0.76077,0.20202,0.19498,0.19351,0.39341)}
mask=np.zeros((H,W),np.uint8)
for k,(x,y,w,h,domey) in faces.items():
    x0,y0,x1,y1=int((x+0.1*w)*W),int((y+0.1*h)*H),int((x+0.9*w)*W),int((y+h)*H)
    g=cv2.cvtColor(im[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY)
    dark=(g<90).astype(np.uint8)*255
    lines=cv2.HoughLinesP(dark,1,np.pi/720,60,minLineLength=120,maxLineGap=8)
    best=None
    for l in lines.reshape(-1,4):
        a,b,c,d=[int(v) for v in l]
        if b>d: a,b,c,d=c,d,a,b
        L=np.hypot(c-a,d-b); ang=np.degrees(np.arctan2(a-c,d-b))
        if 8<abs(ang)<60 and (best is None or L>best[0]): best=(L,a+x0,b+y0,c+x0,d+y0)
    _,a,b,c,d=best
    ux,uy=(c-a)/np.hypot(c-a,d-b),(d-b)/np.hypot(c-a,d-b)
    top=(int(a-ux*25),int(b-uy*25))
    ybot=int((domey-0.022)*H)
    t=(ybot-b)/uy
    bot=(int(a+ux*t),int(ybot))
    cv2.line(mask,top,bot,255,34)
    print(k,top,bot)
out=cv2.inpaint(im,mask,7,cv2.INPAINT_TELEA)
cv2.imwrite(dst,out)

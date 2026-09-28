const IRIS={right:[468,469,470,471,472],left:[473,474,475,476,477]};
const focalPixels=(w,hfov)=>w/(2*Math.tan((hfov*Math.PI/180)/2));
function irisDiameterPx(lm,ids,w,h){
  const p=ids.slice(1).map(i=>lm[i]);
  const d1=Math.hypot((p[0].x-p[2].x)*w,(p[0].y-p[2].y)*h);
  const d2=Math.hypot((p[1].x-p[3].x)*w,(p[1].y-p[3].y)*h);
  return (d1+d2)*.5;
}
export class EyePoseEstimator{
  estimate(lm,video,c){
    if(!lm||lm.length<478)return null;
    const w=video.videoWidth,h=video.videoHeight,f=focalPixels(w,c.cameraHFovDeg);
    const dr=irisDiameterPx(lm,IRIS.right,w,h),dl=irisDiameterPx(lm,IRIS.left,w,h);
    const diameter=(dr+dl)*.5;if(!Number.isFinite(diameter)||diameter<1)return null;
    const z=f*c.irisDiameterM/diameter;
    const rc=lm[IRIS.right[0]],lc=lm[IRIS.left[0]];
    const u=(rc.x+lc.x)*.5*w,v=(rc.y+lc.y)*.5*h;
    // camera coordinates: +x right, +y up, +z toward viewer
    const x=-(u-w*.5)*z/f;
    const y=-(v-h*.5)*z/f;
    // camera is near the top-center of the S21 Ultra display.
    return{x:x+c.cameraOffsetXM,y:y+c.cameraOffsetYM,z};
  }
}
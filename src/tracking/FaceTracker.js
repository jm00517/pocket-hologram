import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export class FaceTracker {
  constructor(video,onEye){this.video=video;this.onEye=onEye;this.landmarker=null;this.running=false;this.last=-1;this.smooth={x:0,y:0,z:.42};}
  async init(){
    const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    this.landmarker=await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},
      runningMode:'VIDEO',numFaces:1
    });
  }
  async start(){
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    this.video.srcObject=stream;await this.video.play();this.running=true;this.loop();
  }
  stop(){this.running=false;this.video.srcObject?.getTracks().forEach(t=>t.stop());}
  loop=()=>{
    if(!this.running)return;
    const now=performance.now();
    if(this.video.readyState>=2 && this.video.currentTime!==this.last){
      this.last=this.video.currentTime;
      const out=this.landmarker?.detectForVideo(this.video,now);
      const lm=out?.faceLandmarks?.[0];
      if(lm){
        const le=lm[33],re=lm[263];
        const cx=(le.x+re.x)*.5,cy=(le.y+re.y)*.5;
        const eyePx=Math.hypot((le.x-re.x)*this.video.videoWidth,(le.y-re.y)*this.video.videoHeight);
        const assumedIPD=0.063;
        const fx=this.video.videoWidth*1.15;
        const z=Math.min(1.2,Math.max(.16,fx*assumedIPD/Math.max(eyePx,1)));
        const scaleX=z/fx;
        const x=-(cx-.5)*this.video.videoWidth*scaleX;
        const y= (.5-cy)*this.video.videoHeight*scaleX;
        const a=.18;
        this.smooth.x+=a*(x-this.smooth.x);this.smooth.y+=a*(y-this.smooth.y);this.smooth.z+=a*(z-this.smooth.z);
        this.onEye({...this.smooth});
      }
    }
    requestAnimationFrame(this.loop);
  }
}
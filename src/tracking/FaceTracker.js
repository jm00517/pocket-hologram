import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { EyePoseEstimator } from './EyePoseEstimator.js';
import { PoseFilter } from './OneEuroFilter.js';

export class FaceTracker{
  constructor(video,onEye,getCalibration){this.video=video;this.onEye=onEye;this.getCalibration=getCalibration;this.landmarker=null;this.running=false;this.last=-1;this.estimator=new EyePoseEstimator();this.filter=new PoseFilter();}
  async init(){
    if(this.landmarker)return;
    const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
    this.landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numFaces:1});
  }
  async start(){
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
    this.video.srcObject=stream;await this.video.play();this.running=true;this.loop();
  }
  stop(){this.running=false;this.video.srcObject?.getTracks().forEach(t=>t.stop())}
  loop=()=>{
    if(!this.running)return;
    const now=performance.now();
    if(this.video.readyState>=2&&this.video.currentTime!==this.last){
      this.last=this.video.currentTime;
      const lm=this.landmarker?.detectForVideo(this.video,now)?.faceLandmarks?.[0];
      if(lm){
        const raw=this.estimator.estimate(lm,this.video,this.getCalibration());
        if(raw)this.onEye(this.filter.filter(raw,now/1000),raw);
      }
    }
    requestAnimationFrame(this.loop);
  }
}
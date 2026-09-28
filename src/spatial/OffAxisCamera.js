import * as THREE from 'three';

export class OffAxisCamera {
  constructor(camera,{screenWidth=0.068,screenHeight=0.151,near=0.01,far=50}={}){
    this.camera=camera;this.screenWidth=screenWidth;this.screenHeight=screenHeight;this.near=near;this.far=far;
  }
  update(eye){
    const {x,y,z}=eye;
    const n=this.near,f=this.far;
    const d=Math.max(z,0.08);
    const l=n*((-this.screenWidth/2)-x)/d;
    const r=n*(( this.screenWidth/2)-x)/d;
    const b=n*((-this.screenHeight/2)-y)/d;
    const t=n*(( this.screenHeight/2)-y)/d;
    this.camera.position.set(x,y,z);
    this.camera.quaternion.identity();
    const m=new THREE.Matrix4();
    m.makePerspective(l,r,t,b,n,f);
    this.camera.projectionMatrix.copy(m);
    this.camera.projectionMatrixInverse.copy(m).invert();
  }
}
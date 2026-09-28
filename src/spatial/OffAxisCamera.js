import * as THREE from 'three';

/**
 * Generalized perspective for a planar screen.
 * Screen plane is z=0, centered at origin; +z points toward the viewer.
 * Written independently from the standard off-axis frustum derivation.
 */
export class OffAxisCamera{
  constructor(camera,{near=.01,far=50}={}){this.camera=camera;this.near=near;this.far=far;this.calibration=null}
  setCalibration(c){this.calibration=c}
  update(eye){
    const c=this.calibration;if(!c)return;
    const n=this.near,f=this.far,d=Math.max(eye.z,.06);
    const halfW=c.screenWidthM/2,halfH=c.screenHeightM/2;
    const left=n*(-halfW-eye.x)/d,right=n*(halfW-eye.x)/d;
    const bottom=n*(-halfH-eye.y)/d,top=n*(halfH-eye.y)/d;
    this.camera.position.set(eye.x,eye.y,eye.z);
    this.camera.quaternion.identity();
    this.camera.projectionMatrix.makePerspective(left,right,top,bottom,n,f);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }
}
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
    // Everything is behind the screen plane, so the near plane can sit halfway to it. Depth precision goes with
    // near: at 0.01 units a castle 1.5 km out resolved only in ~150 m steps; at d/2 it is ~0.2 m.
    const d=Math.max(eye.z,.06),n=Math.max(this.near,d*.5),f=this.far;
    this.camera.near=n;this.camera.far=f; // passes that read them (GTAO) must agree with the projection
    const halfW=c.screenWidthM/2,halfH=c.screenHeightM/2;
    const left=n*(-halfW-eye.x)/d,right=n*(halfW-eye.x)/d;
    const bottom=n*(-halfH-eye.y)/d,top=n*(halfH-eye.y)/d;
    this.camera.position.set(eye.x,eye.y,eye.z);
    this.camera.quaternion.identity();
    this.camera.projectionMatrix.makePerspective(left,right,top,bottom,n,f);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }
}
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export class ModelLoader{
  async fromFile(file){
    const url=URL.createObjectURL(file);
    try{
      const ext=file.name.split('.').pop().toLowerCase();
      let obj;
      if(ext==='glb'||ext==='gltf') obj=(await new GLTFLoader().loadAsync(url)).scene;
      else if(ext==='fbx') obj=await new FBXLoader().loadAsync(url);
      else throw new Error('Unsupported model format');
      this.normalize(obj);
      return obj;
    } finally { setTimeout(()=>URL.revokeObjectURL(url),2000); }
  }
  normalize(obj){
    const box=new THREE.Box3().setFromObject(obj),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const s=1.2/Math.max(size.x,size.y,size.z,0.001);
    obj.scale.multiplyScalar(s);obj.position.sub(center.multiplyScalar(s));obj.position.y-=0.25;obj.position.z=-1.6;
  }
}
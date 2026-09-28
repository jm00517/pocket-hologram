import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';

const MODEL_EXT=/\.(glb|gltf|fbx|pmx|pmd)$/i;
const base=u=>decodeURIComponent(u).split(/[\\/]/).pop().toLowerCase();

export class ModelLoader{
  // files: FileList/File[] dropped or picked together (model + textures/.bin). Textures resolve by basename.
  async fromFiles(files){
    const list=[...files],model=list.find(f=>MODEL_EXT.test(f.name));
    if(!model)throw new Error('Unsupported model format (.glb .gltf .fbx .pmx .pmd)');
    const urls=new Map(list.map(f=>[f.name.toLowerCase(),URL.createObjectURL(f)]));
    const manager=new THREE.LoadingManager();manager.setURLModifier(u=>urls.get(base(u))??u);
    const ext=model.name.split('.').pop().toLowerCase();
    const loader=ext==='fbx'?new FBXLoader(manager):ext==='pmx'||ext==='pmd'?new MMDLoader(manager):new GLTFLoader(manager);
    try{
      const res=await loader.loadAsync(urls.get(model.name.toLowerCase()));
      const obj=res.scene??res;
      return obj;
    } finally { setTimeout(()=>urls.forEach(u=>URL.revokeObjectURL(u)),5000); }
  }
  fromFile(file){return this.fromFiles([file])}
  // Fit inside a w×h×d box behind the screen, standing on its floor, centered in depth.
  static place(obj,w,h,d){
    obj.scale.setScalar(1);obj.position.set(0,0,0);obj.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(obj),size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
    const s=Math.min(h*.8/Math.max(size.y,1e-6),w*.9/Math.max(size.x,1e-6),d*.9/Math.max(size.z,1e-6));
    obj.scale.setScalar(s);
    obj.position.set(-c.x*s,-h/2-box.min.y*s,-d/2-c.z*s);
  }
}

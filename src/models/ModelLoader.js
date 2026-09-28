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
      this.normalize(obj);
      return obj;
    } finally { setTimeout(()=>urls.forEach(u=>URL.revokeObjectURL(u)),5000); }
  }
  fromFile(file){return this.fromFiles([file])}
  normalize(obj){
    const box=new THREE.Box3().setFromObject(obj),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    const s=1.2/Math.max(size.x,size.y,size.z,0.001);
    obj.scale.multiplyScalar(s);obj.position.sub(center.multiplyScalar(s));obj.position.y-=0.25;obj.position.z=-1.6;
  }
}

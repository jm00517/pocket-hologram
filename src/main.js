import * as THREE from 'three';
import './style.css';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';

const canvas=document.querySelector('#scene'),video=document.querySelector('#camera'),status=document.querySelector('#status');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x05070b);
const camera=new THREE.PerspectiveCamera(45,1,.01,50);
const spatial=new OffAxisCamera(camera);
let eye={x:0,y:0,z:.42};

scene.add(new THREE.HemisphereLight(0xffffff,0x223344,2));
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(2,3,2);key.castShadow=true;scene.add(key);

const room=new THREE.Group();
const floor=new THREE.Mesh(new THREE.PlaneGeometry(3,4),new THREE.MeshStandardMaterial({color:0x161b25,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.set(0,-.85,-1.6);floor.receiveShadow=true;room.add(floor);
for(const [x,z] of [[-.9,-1.8],[.9,-1.8],[-.9,-2.8],[.9,-2.8]]){const p=new THREE.Mesh(new THREE.BoxGeometry(.08,1.8,.08),new THREE.MeshStandardMaterial({color:0x6b7488}));p.position.set(x,0,z);room.add(p)}
scene.add(room);

const cube=new THREE.Mesh(new THREE.BoxGeometry(.7,.7,.7),new THREE.MeshStandardMaterial({color:0x8aa8ff,metalness:.15,roughness:.45}));cube.position.set(0,-.35,-1.65);cube.castShadow=true;scene.add(cube);
let current=cube;

const loader=new ModelLoader();
document.querySelector('#modelFile').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;status.textContent='loading model...';try{const obj=await loader.fromFile(file);scene.remove(current);current=obj;scene.add(obj);status.textContent=file.name}catch(err){status.textContent=String(err.message||err)}});

const tracker=new FaceTracker(video,p=>eye=p);
document.querySelector('#start').onclick=async()=>{try{status.textContent='initializing face tracker...';await tracker.init();await tracker.start();status.textContent='tracking'}catch(err){console.error(err);status.textContent='camera/tracker error'}};
document.querySelector('#fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();

function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false)}
addEventListener('resize',resize);resize();

function frame(){spatial.update(eye);renderer.render(scene,camera);requestAnimationFrame(frame)}frame();

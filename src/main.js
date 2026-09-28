import * as THREE from 'three';
import './style.css';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';
import { Calibration } from './calibration/Calibration.js';
import { bindCalibrationPanel } from './ui/CalibrationPanel.js';
import { createTestChamber } from './scene/TestChamber.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration');
const calibration=new Calibration();
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x03050a);
const camera=new THREE.PerspectiveCamera(45,1,.01,50),spatial=new OffAxisCamera(camera);spatial.setCalibration(calibration.data);
let eye={x:0,y:0,z:.42},rawEye={...eye};

scene.add(new THREE.HemisphereLight(0xffffff,0x172033,2));
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(1,2,1);scene.add(key);
createTestChamber(scene);
const cube=new THREE.Mesh(new THREE.BoxGeometry(.28,.28,.28),new THREE.MeshStandardMaterial({color:0x8aa8ff,roughness:.4}));cube.position.set(0,0,-.8);scene.add(cube);let current=cube;

const loader=new ModelLoader();
$('#modelFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;status.textContent='loading model...';try{const obj=await loader.fromFile(f);scene.remove(current);current=obj;scene.add(obj);status.textContent=f.name}catch(err){status.textContent=String(err.message||err)}});

const tracker=new FaceTracker(video,(p,r)=>{eye=p;rawEye=r},()=>calibration.data);
$('#start').onclick=async()=>{try{status.textContent='initializing...';await tracker.init();await tracker.start();status.textContent='tracking'}catch(e){console.error(e);status.textContent='camera/tracker error'}};
$('#fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
$('#calibrate').onclick=()=>calPanel.classList.toggle('hidden');
$('#debug').onclick=()=>debugPanel.classList.toggle('hidden');
bindCalibrationPanel(calPanel,calibration,c=>spatial.setCalibration(c));

function resize(){renderer.setSize(innerWidth,innerHeight,false)}addEventListener('resize',resize);resize();
function frame(){
  spatial.update(eye);
  debugPanel.textContent=`filtered eye (m)\nx ${eye.x.toFixed(3)}\ny ${eye.y.toFixed(3)}\nz ${eye.z.toFixed(3)}\n\nraw z ${rawEye.z.toFixed(3)}\nHFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°`;
  renderer.render(scene,camera);requestAnimationFrame(frame)
}frame();
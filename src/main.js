import * as THREE from 'three';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';
import { Calibration } from './calibration/Calibration.js';
import { bindCalibrationPanel } from './ui/CalibrationPanel.js';
import { createTestChamber } from './scene/TestChamber.js';
import { Character, BUILTIN_MOTIONS, IDLE_POSE } from './character/Character.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration'),motionSel=$('#motion');
const calibration=new Calibration();
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x03050a);
const camera=new THREE.PerspectiveCamera(45,1,.01,5000),spatial=new OffAxisCamera(camera,{far:5000});
let eye={x:0,y:0,z:.42},rawEye={...eye};
window.setEye=p=>{eye={...eye,...p}}; // debug: fake a viewer position (meters) without the camera

scene.add(new THREE.HemisphereLight(0xffffff,0x172033,2));
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(1,2,1);scene.add(key);

// Scene units per meter. MMD physics breaks on scaled meshes, so instead of shrinking the model
// we grow the screen/eye/room by K. Generic (glTF/FBX) models use K=1 and get scaled themselves.
let K=1;
const DEPTH=.15,STAGE_Z=.025; // character stands 2.5 cm behind the glass
// Viewport = physical screen width; height follows the canvas aspect so the frustum matches what's drawn.
// ponytail: ignores the URL bar shifting the viewport center; use Fullscreen for exact geometry.
const dims=()=>{const w=calibration.data.screenWidthM;return{...calibration.data,screenWidthM:w*K,screenHeightM:w*innerHeight/innerWidth*K}};
const stage=new THREE.Group();scene.add(stage); // floor-center of the room; the character stands here
let chamber,current=null,character=null;
function layout(){
  const d=dims();spatial.setCalibration(d);
  if(chamber)scene.remove(chamber);
  chamber=createTestChamber(scene,{width:d.screenWidthM,height:d.screenHeightM,depth:DEPTH*K,step:.01*K});
  stage.position.set(0,-d.screenHeightM/2,-STAGE_Z*K);
  if(current)ModelLoader.place(current,d.screenWidthM,d.screenHeightM,DEPTH*K);
}

function clearModels(){if(current){scene.remove(current);current=null}if(character){stage.remove(character.mesh);character=null}}

async function loadCharacter(url,manager){
  status.textContent='loading character...';
  const c=new Character();const mesh=await c.load(url,manager);
  clearModels();character=c;window.character=c; // console / future LLM hook
  const h=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
  K=h/(.8*calibration.data.screenHeightM);
  stage.add(mesh);layout();
  motionSel.innerHTML=['idle',...Object.keys(BUILTIN_MOTIONS).filter(n=>n!==IDLE_POSE)].map(n=>`<option>${n}</option>`).join('');
  motionSel.classList.remove('hidden');
  status.textContent='ready';
}
motionSel.onchange=async()=>{
  const n=motionSel.value;status.textContent=`loading ${n}...`;
  try{character.idle=n==='idle'||n.startsWith('pose');await character.play(n==='idle'?IDLE_POSE:n);status.textContent=n}
  catch(e){status.textContent='error: '+(e.message||e)}
};

const loader=new ModelLoader();
async function useFiles(files){
  const list=[...(files||[])];if(!list.length)return;
  try{
    const motions=list.filter(f=>/\.(vmd|vpd)$/i.test(f.name));
    if(motions.length&&character&&!list.some(f=>/\.(pmx|pmd|glb|gltf|fbx)$/i.test(f.name))){
      for(const f of motions){const n=f.name.replace(/\.\w+$/,'');await character.addMotion(n,f);motionSel.add(new Option(n))}
      motionSel.value=motions.at(-1).name.replace(/\.\w+$/,'');motionSel.onchange();return;
    }
    const mmd=list.find(f=>/\.(pmx|pmd)$/i.test(f.name));
    if(mmd){const {url,manager}=ModelLoader.fileManager(list);await loadCharacter(url(mmd),manager);return}
    status.textContent='loading model...';
    const obj=await loader.fromFiles(list);clearModels();K=1;current=obj;scene.add(obj);layout();motionSel.classList.add('hidden');
    status.textContent=`${list.length} file(s)`;
  }catch(err){console.error(err);status.textContent='error: '+(err.message||err)}
}
$('#modelFile').addEventListener('change',e=>useFiles(e.target.files));
const drop=$('#drop');
addEventListener('dragover',e=>{e.preventDefault();drop.classList.remove('hidden')});
addEventListener('dragleave',()=>drop.classList.add('hidden'));
addEventListener('drop',e=>{e.preventDefault();drop.classList.add('hidden');useFiles(e.dataTransfer.files)});

const tracker=new FaceTracker(video,(p,r)=>{eye=p;rawEye=r},()=>calibration.data);
$('#start').onclick=async()=>{try{status.textContent='initializing...';await tracker.init();await tracker.start();status.textContent='tracking'}catch(e){console.error(e);status.textContent='error: '+(e.name||'')+' '+(e.message||e)}};
$('#fullscreen').onclick=()=>{document.documentElement.requestFullscreen?.();screen.orientation?.lock?.('portrait').catch(()=>{})};
$('#calibrate').onclick=()=>calPanel.classList.toggle('hidden');
$('#debug').onclick=()=>debugPanel.classList.toggle('hidden');
bindCalibrationPanel(calPanel,calibration,layout);

function resize(){renderer.setSize(innerWidth,innerHeight,false);layout()}addEventListener('resize',resize);resize();
loadCharacter().catch(e=>{console.error(e);status.textContent='error: '+(e.message||e)});

const clock=new THREE.Clock();
function frame(){
  const dt=Math.min(clock.getDelta(),.1);
  spatial.update({x:eye.x*K,y:eye.y*K,z:eye.z*K});
  if(character){character.lookTarget=camera.position;character.update(dt)}
  debugPanel.textContent=`filtered eye (m)\nx ${eye.x.toFixed(3)}\ny ${eye.y.toFixed(3)}\nz ${eye.z.toFixed(3)}\n\nraw z ${rawEye.z.toFixed(3)}\nHFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°\nK ${K.toFixed(1)}`;
  renderer.render(scene,camera);requestAnimationFrame(frame)
}frame();

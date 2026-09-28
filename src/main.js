import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';
import { Calibration, isMobile } from './calibration/Calibration.js';
import { bindCalibrationPanel } from './ui/CalibrationPanel.js';
import { createTestChamber } from './scene/TestChamber.js';
import { Character, BUILTIN_MOTIONS, IDLE_POSE } from './character/Character.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration'),motionSel=$('#motion');
const calibration=new Calibration();
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x03050a);
const camera=new THREE.PerspectiveCamera(45,1,.01,5000),spatial=new OffAxisCamera(camera,{far:5000});
let eye={x:0,y:0,z:isMobile?.42:.6},rawEye={...eye};
window.setEye=p=>{eye={...eye,...p}}; // debug: fake a viewer position (meters) without the camera

// Same lighting as three.js's MMD example; MMD toon materials are tuned for it.
scene.add(new THREE.AmbientLight(0xaaaaaa,3));
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(-1,1,1);scene.add(key);
const outline=new OutlineEffect(renderer); // MMD's ink lines; most of the "MMD look"
window.outline=true;

// Scene units per meter. MMD physics breaks on scaled meshes, so instead of shrinking the model
// we grow the screen/eye/room by K. Generic (glTF/FBX) models use K=1 and get scaled themselves.
let K=1;
// Room depth and where the character stands scale with the window, so a monitor gets a proportionally
// deeper room and the feet land on visible floor instead of the bottom edge. Phone: ~15 cm deep, ~2.5 cm back.
const roomDepth=v=>Math.max(.15,v.w*.5), standZ=v=>v.h*.2;
// Meters per CSS px from the calibrated physical screen width. The viewport (not the whole screen)
// is the window into the scene, so its size and its offset from the screen center both matter.
const mPerPx=()=>calibration.data.screenWidthM/screen.width;
function viewport(){
  const m=mPerPx();
  // viewport center relative to screen center, meters, +y up. Browser chrome is assumed to sit on top.
  const left=(screenX||0)+(outerWidth-innerWidth)/2, top=(screenY||0)+Math.max(0,outerHeight-innerHeight);
  const full=document.fullscreenElement||(innerWidth===screen.width&&innerHeight===screen.height);
  const ox=full?0:(left+innerWidth/2-screen.width/2)*m, oy=full?0:-(top+innerHeight/2-screen.height/2)*m;
  return{w:innerWidth*m,h:innerHeight*m,ox,oy};
}
const dims=()=>{const v=viewport();return{...calibration.data,screenWidthM:v.w*K,screenHeightM:v.h*K}};
let charHeight=0;
const stage=new THREE.Group();scene.add(stage); // floor-center of the room; the character stands here
let chamber,current=null,character=null;
// Contact shadow: a soft dark blob under the feet. Without it the eye reads the character as floating.
const blob=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),r=g.createRadialGradient(64,64,0,64,64,64);
  r.addColorStop(0,'rgba(0,0,0,.75)');r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(0,0,128,128);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));
  m.material.userData.outlineParameters={visible:false};m.rotation.x=-Math.PI/2;m.visible=false;stage.add(m);return m})();
function layout(){
  if(charHeight)K=charHeight/(.8*viewport().h); // character fills 80% of the window height
  const d=dims();spatial.setCalibration(d);
  if(chamber)scene.remove(chamber);
  const v=viewport(),depth=roomDepth(v)*K;
  chamber=createTestChamber(scene,{width:d.screenWidthM,height:d.screenHeightM,depth,step:Math.max(.01,v.w/12)*K});
  stage.position.set(0,-d.screenHeightM/2,-standZ(v)*K);
  if(current)ModelLoader.place(current,d.screenWidthM,d.screenHeightM,depth);
  character?.resetPhysics();
}

function clearModels(){blob.visible=false;if(current){scene.remove(current);current=null}if(character){stage.remove(character.mesh);character=null}}

async function loadCharacter(url,manager){
  status.textContent='loading character...';
  const c=new Character();const mesh=await c.load(url,manager);
  clearModels();character=c;window.character=c; // console / future LLM hook
  const h=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
  charHeight=h;
  stage.add(mesh);blob.scale.set(h*.45,h*.3,1);blob.visible=true;layout();
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
    const obj=await loader.fromFiles(list);clearModels();charHeight=0;K=1;current=obj;scene.add(obj);layout();motionSel.classList.add('hidden');
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

function resize(){renderer.setSize(innerWidth,innerHeight,false);layout()}addEventListener('resize',resize);addEventListener('fullscreenchange',resize);resize();
loadCharacter(new URLSearchParams(location.search).get('model')||undefined).catch(e=>{console.error(e);status.textContent='error: '+(e.message||e)});

const clock=new THREE.Clock();
function frame(){
  const dt=Math.min(clock.getDelta(),.1);
  const vp=viewport();spatial.update({x:(eye.x-vp.ox)*K,y:(eye.y-vp.oy)*K,z:eye.z*K});
  if(character){character.lookTarget=camera.position;character.update(dt);const c=character.bones['センター'].getWorldPosition(blob.position);stage.worldToLocal(c);c.y=.01}
  debugPanel.textContent=`filtered eye (m)\nx ${eye.x.toFixed(3)}\ny ${eye.y.toFixed(3)}\nz ${eye.z.toFixed(3)}\n\nraw z ${rawEye.z.toFixed(3)}\nHFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°\nK ${K.toFixed(1)}`;
  (window.outline?outline:renderer).render(scene,camera);requestAnimationFrame(frame)
}frame();

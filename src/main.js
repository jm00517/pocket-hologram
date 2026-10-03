import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createEngine, connectBridge } from '../engine/index.js';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';
import { Calibration, isMobile } from './calibration/Calibration.js';
import { bindCalibrationPanel } from './ui/CalibrationPanel.js';
import { mountChatBar } from './ui/ChatBar.js';
import { createTestChamber } from './scene/TestChamber.js';
import { allMaps } from './maps/index.js';
import { mountParamsPanel } from './ui/ParamsPanel.js';
import { Character, BUILTIN_MOTIONS, IDLE_POSE, DEFAULT_MODEL } from './character/Character.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration'),motionSel=$('#motion'),modelSel=$('#modelSel');
const calibration=new Calibration();
// The engine owns renderer, scene, camera, lights, post and maps; this file is the app around it: head tracking,
// calibration/window layout, the MMD character, the drawer UI. Agents drive the engine over the bridge (engine/INDEX.md).
const query=new URLSearchParams(location.search);
const engine=createEngine({canvas});window.engine=engine;
const {renderer,scene,camera,stage,post}=engine;
const spatial=new OffAxisCamera(camera,{far:30000});
let eye={x:0,y:0,z:isMobile?.42:.6},rawEye={...eye};
const restEye={...eye},viewEye={...eye},viewVel={x:0,y:0,z:0};
// critically damped spring toward target (Holden), per axis; mutates pos/vel
function dampSpring(pos,vel,target,halflife,dt){
  const y=(4*Math.LN2)/halflife/2,e=Math.exp(-y*dt);
  for(const k of ['x','y','z']){const j0=pos[k]-target[k],j1=vel[k]+j0*y;pos[k]=e*(j0+j1*dt)+target[k];vel[k]=e*(vel[k]-j1*y*dt)}
}
window.setEye=p=>{eye={...eye,...p}}; // debug: fake a viewer position (meters) without the camera

for(const m of allMaps({crossing:{weather:query.get('weather')||'sunset',foliage:query.get('foliage')??'full'}}))engine.registerMap(m);
let bg=query.get('bg')||'crossing'; // map id, or 'grid' = no map (calibration room)
engine.setMap(bg==='grid'?null:bg);
// no map: the calibration grid room and a contact blob stand in for a world
engine.on('map',id=>{if(chamber)chamber.visible=!id;blob.material.opacity=id?0:1;bgSel.value=id??'grid'});

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
  chamber.visible=!(engine.map&&charHeight);
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
  engine.setSubject(mesh,{height:h}).catch(e=>console.error('map',e));
  motionSel.innerHTML=['idle',...Object.keys(BUILTIN_MOTIONS).filter(n=>n!==IDLE_POSE)].map(n=>`<option>${n}</option>`).join('');
  // Library: every clip the director loaded (idle stands, fidgets, gestures), for previewing one by one.
  c.directorReady.then(()=>{
    const g=document.createElement('optgroup');g.label='library';
    for(const n of [...c.director.have].sort())g.append(new Option(n,'lib:'+n));
    if(g.children.length)motionSel.insertBefore(g,motionSel.querySelector('optgroup'));
  });
  motionSel.classList.remove('hidden');
  status.textContent='ready';
}
const resetBtn=document.createElement('button');resetBtn.textContent='포즈 리셋';resetBtn.type='button';
resetBtn.onclick=()=>{if(!character)return;character.reset();character.idle=true;character.director.enabled=true;motionSel.value='idle';status.textContent='reset'};
const bgSel=document.createElement('select');bgSel.innerHTML=[...engine.maps(),{id:'grid',label:'그리드'}].map(m=>`<option value="${m.id}">배경: ${m.label}</option>`).join('');bgSel.value=bg;
bgSel.onchange=()=>{bg=bgSel.value;engine.setMap(bg==='grid'?null:bg).catch(e=>{console.error(e);status.textContent='error: '+e.message})};
// Free camera: F or the button toggles; click the view to grab the mouse (Esc releases). WASD move,
// Space/C up/down, Shift fast. The head-coupled window view is suspended while it's on.
const freeCam={on:false,keys:new Set(),controls:new PointerLockControls(camera,canvas)};
const freeBtn=$('#freeBtn');
function toggleFree(){freeCam.on=!freeCam.on;engine.cameraMode='rig';freeBtn.classList.toggle('on',freeCam.on);if(!freeCam.on)freeCam.controls.unlock()}
freeBtn.onclick=toggleFree;
// Moving her: in free cam with the mouse grabbed, a click sends her to the map's walkable ground under the
// crosshair (maps that support it expose walkable + moveTo; the crossing does).
const ray=new THREE.Raycaster();
const crosshair=Object.assign(document.createElement('div'),{style:'position:fixed;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 3px #000;pointer-events:none;display:none;z-index:50'});
document.body.append(crosshair);
freeCam.controls.addEventListener('lock',()=>crosshair.style.display='block');
freeCam.controls.addEventListener('unlock',()=>crosshair.style.display='none');
canvas.addEventListener('click',()=>{
  if(!freeCam.on||!character)return;
  if(!freeCam.controls.isLocked){freeCam.controls.lock();return}
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  const m=engine.mapInstance,hit=m?.moveTo&&ray.intersectObjects(m.walkable??[],false)[0];
  if(hit)m.moveTo(m.group.worldToLocal(hit.point.clone()));
});
addEventListener('keydown',e=>{if(e.target.closest?.('input,textarea,select'))return;if(e.code==='KeyF')toggleFree();freeCam.keys.add(e.code);if(freeCam.on&&/^(Key[WASDC]|Space)$/.test(e.code))e.preventDefault()}); // Space would click the last-focused button
addEventListener('keyup',e=>freeCam.keys.delete(e.code));
addEventListener('blur',()=>freeCam.keys.clear());
function flyFreeCam(dt){
  const k=freeCam.keys,v=(charHeight||1.6)/1.6*(k.has('ShiftLeft')||k.has('ShiftRight')?10:2.5)*dt; // 2.5 m/s, 10 with Shift
  freeCam.controls.moveForward(((k.has('KeyW')?1:0)-(k.has('KeyS')?1:0))*v);
  freeCam.controls.moveRight(((k.has('KeyD')?1:0)-(k.has('KeyA')?1:0))*v);
  camera.position.y+=((k.has('Space')?1:0)-(k.has('KeyC')?1:0))*v;
  camera.aspect=innerWidth/innerHeight;camera.fov=60;camera.updateProjectionMatrix();
}
$('#sceneCtl').append(bgSel);
$('#motion').after(resetBtn);
$('#menuBtn').onclick=()=>{$('#drawer').classList.toggle('hidden');$('#menuBtn').classList.toggle('on')};

// Graphics: every engine/map param as a live control; '맵 기본값으로' re-applies the map (and its weather).
const panel=mountParamsPanel(engine,$('#gfxCtl'),{onReset:()=>engine.setMap(engine.map)});
$('#drawer').addEventListener('toggle',e=>{if(e.target.open)panel.sync()},true);
motionSel.onchange=async()=>{
  const n=motionSel.value;status.textContent=`loading ${n}...`;
  try{
    character.idle=n==='idle'||n.startsWith('pose')||n.startsWith('lib:');character.director.enabled=n==='idle';
    if(n==='idle')character.director.toBase();else await character.play(n.startsWith('lib:')?n.slice(4):n);status.textContent=n}
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
window.chat=mountChatBar(()=>character?.behavior,$('#charRows'));

function resize(){engine.resize();layout()}addEventListener('resize',resize);addEventListener('fullscreenchange',resize);resize();
// Local models live in assets/ (gitignored, MMD licenses forbid redistribution). The first one that exists
// is the default; without assets/ (e.g. GitHub Pages) the three.js sample Miku is used.
const MODELS=[
  ['Sour Black','assets/sour/Sour式初音ミクVer.1.02/Black.pmx'],
  ['Sour White','assets/sour/Sour式初音ミクVer.1.02/White.pmx'],
  ['Classic',DEFAULT_MODEL],
];
(async()=>{
  const ok=await Promise.all(MODELS.map(([,u])=>u===DEFAULT_MODEL||fetch(encodeURI(u),{method:'HEAD'}).then(r=>r.ok,()=>false)));
  const avail=MODELS.filter((_,i)=>ok[i]);
  const param=query.get('model');
  if(param&&!avail.some(([,u])=>u===param))avail.unshift([param.split('/').pop(),param]);
  modelSel.innerHTML=avail.map(([n,u])=>`<option value="${u}">${n}</option>`).join('');
  modelSel.value=param||avail[0][1];
  modelSel.onchange=()=>loadCharacter(modelSel.value).catch(e=>{console.error(e);status.textContent='error: '+(e.message||e)});
  modelSel.onchange();
})();

// per frame, before the engine ticks the map and renders: camera rig + character
engine.on('beforeFrame',dt=>{
  // Head motion: critically damped spring (kills tracker jitter) + parallax strength around the rest pose.
  // A physically exact window (parallax 1) swings the far background as much as the head moves.
  const c=calibration.data,P=c.parallax??1,hl=Math.max(.001,c.smoothing??0);
  dampSpring(viewEye,viewVel,eye,hl,dt);const rest=restEye;
  const ve={x:rest.x+(viewEye.x-rest.x)*P,y:rest.y+(viewEye.y-rest.y)*P,z:rest.z+(viewEye.z-rest.z)*P};
  if(engine.cameraMode==='rig'){if(freeCam.on)flyFreeCam(dt);else{const vp=viewport();spatial.update({x:(ve.x-vp.ox)*K,y:(ve.y-vp.oy)*K,z:ve.z*K})}}
  if(character){character.lookTarget=camera.position;character.update(dt);const c=character.bones['センター'].getWorldPosition(blob.position);stage.worldToLocal(c);c.y=.01}
  debugPanel.textContent=`filtered eye (m)
x ${eye.x.toFixed(3)}
y ${eye.y.toFixed(3)}
z ${eye.z.toFixed(3)}

raw z ${rawEye.z.toFixed(3)}
HFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°
K ${K.toFixed(1)}`;
});
engine.start();
connectBridge(engine);

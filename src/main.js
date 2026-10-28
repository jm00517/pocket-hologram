import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
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
import { Life } from './character/Life.js';
import { Touch } from './character/Touch.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration'),motionSel=$('#motion'),modelSel=$('#modelSel');
const calibration=new Calibration();
// The engine owns renderer, scene, camera, lights, post and maps; this file is the app around it: head tracking,
// calibration/window layout, the MMD character, the drawer UI. Agents drive the engine over the bridge (engine/INDEX.md).
const query=new URLSearchParams(location.search);
const engine=createEngine({canvas});window.engine=engine;
const {renderer,scene,camera,stage}=engine;
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
engine.on('cue',c=>character?.life.notice(c));
engine.on('map',id=>{character?.life.mapChanged(id);if(chamber)chamber.visible=!id;blob.material.opacity=id?0:1;bgSel.value=id??'grid'});

// Scene units per meter. MMD physics breaks on scaled meshes, so instead of shrinking the model
// we grow the screen/eye/room by K. Generic (glTF/FBX) models use K=1 and get scaled themselves.
let K=1;
// Room depth and where the character stands scale with the window, so a monitor gets a proportionally
// deeper room and the feet land on visible floor instead of the bottom edge. Phone: ~15 cm deep, ~2.5 cm back.
const roomDepth=v=>Math.max(.15,v.w*.5), standZ=v=>v.h*.2;
// Meters per CSS px from the calibrated physical screen width. The viewport (not the whole screen)
// is the window into the scene, so its size and its offset from the screen center both matter.
const mPerPx=()=>calibration.data.screenWidthM/screen.width||.0254/96;
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
// her inner life (src/character/Life.js): shared by whichever model is loaded
const lifeP={on:1,chatter:.5,curiosity:1,wind:1};
engine.params.define([
  {id:'life.on',label:'생동감',doc:'Inner life on/off: gaze that wanders and comes back, reactions to the viewer (webcam), spoken asides.',min:0,max:1,step:1,get:()=>lifeP.on,set:v=>{lifeP.on=v}},
  {id:'life.chatter',label:'혼잣말',doc:'How often she talks to herself and whether greetings are spoken (0 = silent).',min:0,max:2,step:.05,get:()=>lifeP.chatter,set:v=>{lifeP.chatter=v}},
  {id:'life.wind',label:'머리카락 바람',doc:'How hard the world wind (wind.*) pushes her hair and skirt; 0 = still air for her.',min:0,max:4,step:.05,get:()=>lifeP.wind,set:v=>{lifeP.wind=v}},
  {id:'life.curiosity',label:'호기심',doc:'How often her gaze leaves you to look around or at things in the map.',min:0,max:3,step:.05,get:()=>lifeP.curiosity,set:v=>{lifeP.curiosity=v}},
]);
// Contact shadow: a soft dark blob under the feet. Without it the eye reads the character as floating.
const blob=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),r=g.createRadialGradient(64,64,0,64,64,64);
  r.addColorStop(0,'rgba(0,0,0,.75)');r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(0,0,128,128);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));
  m.material.userData.outlineParameters={visible:false};m.rotation.x=-Math.PI/2;m.visible=false;stage.add(m);return m})();
function layout(){
  // character fills 80% of the window height. A page opened in a hidden window has a 0-size viewport (and
  // screen); skip then, or K = Infinity turns the stage position NaN and blacks out the scene until a reload.
  if(charHeight&&innerHeight)K=charHeight/(.8*viewport().h);
  const d=dims();spatial.setCalibration(d);
  if(chamber){scene.remove(chamber);chamber.traverse(o=>{o.geometry?.dispose();o.material?.dispose()})} // layout runs on every resize
  const v=viewport(),depth=roomDepth(v)*K;
  chamber=createTestChamber(scene,{width:d.screenWidthM,height:d.screenHeightM,depth,step:Math.max(.01,v.w/12)*K});
  chamber.visible=!(engine.map&&charHeight);
  stage.position.set(0,-d.screenHeightM/2,-standZ(v)*K);
  if(current)ModelLoader.place(current,d.screenWidthM,d.screenHeightM,depth);
  character?.resetPhysics();
}

function clearModels(){blob.visible=false;if(current){scene.remove(current);current=null}if(character){stage.remove(character.mesh);character.dispose();character=null}}

let loadSeq=0; // the latest pick wins: an older, slower load must not replace it when it finally arrives
async function loadCharacter(url,manager){
  status.textContent='loading character...';
  const my=++loadSeq,c=new Character();const mesh=await c.load(url,manager);
  if(my!==loadSeq){c.dispose();return}
  clearModels();character=c;window.character=c; // console / future LLM hook
  const aside=t=>window.chat?.say(t,{interrupt:false}); // her own lines never cut off one she's saying
  c.life=new Life(c,{say:aside,P:lifeP});
  c.touch=new Touch(c,{say:aside,P:lifeP});
  c.bones['頭'].add(voice3d);
  const h=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).y;
  charHeight=h;
  stage.add(mesh);blob.scale.set(h*.45,h*.3,1);blob.visible=true;layout();
  engine.setSubject(mesh,{height:h}).catch(e=>console.error('map',e));
  motionSel.innerHTML=['idle',...Object.keys(BUILTIN_MOTIONS).filter(n=>n!==IDLE_POSE)].map(n=>`<option>${n}</option>`).join('');
  // Library: every clip the director loaded (idle stands, fidgets, gestures), for previewing one by one.
  c.directorReady.then(()=>{
    if(my!==loadSeq)return;
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
// Outside free cam (or at the crosshair inside it) a click on a map's pokeable surface pokes it (the pool's water rings).
canvas.addEventListener('click',e=>{
  const m=engine.mapInstance,poke=()=>{const hit=m?.poke&&ray.intersectObjects(m.pokeable??[],false)[0];if(hit)m.poke(m.group.worldToLocal(hit.point.clone()));return hit};
  if(!freeCam.on){const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);poke();return}
  if(!freeCam.controls.isLocked){freeCam.controls.lock();return} // mouse-look works with or without a character
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  if(poke()||!character)return;
  const hit=m?.moveTo&&ray.intersectObjects(m.walkable??[],false)[0];
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
  camera.aspect=innerWidth/innerHeight;camera.fov=60;camera.near=(charHeight||1.6)/1.6*.05;camera.updateProjectionMatrix(); // 5 cm: close enough to fly up to her
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

// lastFace: when the webcam last saw a face (null until tracking starts) -> her sense of whether you are there
let lastFace=null;
const tracker=new FaceTracker(video,(p,r)=>{eye=p;rawEye=r;lastFace=performance.now()},()=>calibration.data);
$('#start').onclick=async()=>{try{status.textContent='initializing...';await tracker.init();await tracker.start();lastFace??=0;status.textContent='tracking'}catch(e){console.error(e);status.textContent='error: '+(e.name||'')+' '+(e.message||e)}};
$('#fullscreen').onclick=()=>{document.documentElement.requestFullscreen?.();screen.orientation?.lock?.('portrait').catch(()=>{})};
$('#calibrate').onclick=()=>calPanel.classList.toggle('hidden');
$('#debug').onclick=()=>debugPanel.classList.toggle('hidden');
bindCalibrationPanel(calPanel,calibration,layout);
// her voice comes from her head: a 3D sound on the head bone (in VR you hear where she is)
const voice3d=new THREE.PositionalAudio(engine.listener);voice3d.setVolume(1.3);
engine.on('map',()=>voice3d.setRefDistance(2.5*engine.units)); // full volume within 2.5 m (the window view sits ~4 m off)
window.chat=mountChatBar(()=>character?.behavior,$('#charRows'),{route:el=>{voice3d.source?.disconnect();voice3d.setMediaElementSource(el);engine.listener.context.resume()}});

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
const viewer=new THREE.Vector3(),herHead=new THREE.Vector3();
// VR hands: the Touch controllers (their own models), in the rig so they scale with it; Touch.js reads them
const controllerModels=new XRControllerModelFactory();
const grips=[0,1].map(i=>{const g=renderer.xr.getControllerGrip(i);g.add(controllerModels.createControllerModel(g));
  g.addEventListener('connected',e=>{g.userData.src=e.data});g.addEventListener('disconnected',()=>{g.userData.src=null});engine.rig.add(g);return g});
// talking in VR: hold a trigger (or, hands tracked, a pinch) to speak to her; a buzz says it's listening
for(const i of [0,1]){const c=renderer.xr.getController(i);
  c.addEventListener('selectstart',()=>{window.chat?.listenStart();grips[i].userData.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.3,60)});
  c.addEventListener('selectend',()=>window.chat?.listenStop())}
const mapHands=[];
// VR locomotion on the sticks: left glides where you look (1.5 m/s), right snaps you 30° around your head.
// It moves the rig, so walking through a map's doors (portals) works the same as stepping through in the room;
// "up" and "a metre" are the rig's own, since a door may have turned it onto a wall or shrunk it.
const xrTurn={latch:false};
function xrMove(dt){
  const rig=engine.rig,k=rig.scale.x,up=new THREE.Vector3(0,1,0).applyQuaternion(rig.quaternion);
  for(const g of grips){const s=g.userData.src,ax=s?.gamepad?.axes;if(!ax||ax.length<4)continue;const x=ax[2],y=ax[3];
    if(s.handedness==='left'&&Math.hypot(x,y)>.15){
      const f=camera.getWorldDirection(new THREE.Vector3()).projectOnPlane(up).normalize(),r=new THREE.Vector3().crossVectors(f,up);
      rig.position.addScaledVector(f,-y*1.5*k*dt).addScaledVector(r,x*1.5*k*dt)}
    if(s.handedness==='right'){
      if(Math.abs(x)>.7&&!xrTurn.latch){xrTurn.latch=true;const head=camera.getWorldPosition(new THREE.Vector3()),q=new THREE.Quaternion().setFromAxisAngle(up,-Math.sign(x)*Math.PI/6);
        rig.position.sub(head).applyQuaternion(q).add(head);rig.quaternion.premultiply(q)}
      else if(Math.abs(x)<.3)xrTurn.latch=false}}
}
engine.on('beforeFrame',dt=>{
  // Head motion: critically damped spring (kills tracker jitter) + parallax strength around the rest pose.
  // A physically exact window (parallax 1) swings the far background as much as the head moves.
  const c=calibration.data,P=c.parallax??1,hl=Math.max(.001,c.smoothing??0);
  dampSpring(viewEye,viewVel,eye,hl,dt);const rest=restEye;
  const ve={x:rest.x+(viewEye.x-rest.x)*P,y:rest.y+(viewEye.y-rest.y)*P,z:rest.z+(viewEye.z-rest.z)*P};
  // in VR the headset is the camera; the window rig (tracking, off-axis) stands down
  if(engine.xr)xrMove(dt);else if(engine.cameraMode==='rig'){if(freeCam.on)flyFreeCam(dt);else{const vp=viewport();spatial.update({x:(ve.x-vp.ox)*K,y:(ve.y-vp.oy)*K,z:ve.z*K})}}
  // VR hands in the map (the pool's water): map metres and speed in m/s
  const mi=engine.mapInstance;
  if(mi?.touch){const hs=engine.xr?grips.filter(g=>g.userData.src):[];mi.touch(hs.map((g,i)=>{const p=mi.group.worldToLocal(g.getWorldPosition(new THREE.Vector3())),q=mapHands[i]??p;mapHands[i]=p;return{p,v:p.clone().sub(q).divideScalar(Math.max(dt,1e-3))}}),dt);mapHands.length=hs.length}
  if(character){
    // VR: the headset off your face (session hidden) counts as away, so putting it back on is a return
    const inst=engine.mapInstance,xr=engine.xr,present=xr?renderer.xr.getSession()?.visibilityState!=='hidden':lastFace===null?null:performance.now()-lastFace<1500;
    camera.getWorldPosition(viewer); // the camera sits in engine.rig (scaled in VR)
    const close=xr?viewer.distanceTo(character.bones['頭'].getWorldPosition(herHead))<.45*engine.units:present&&viewEye.z<restEye.z*.62; // the real eye, not the parallax-scaled one (parallax is only a look)
    character.life.update(dt,{viewer,present,close,map:engine.map,night:(inst?.sky?.values.elev??30)<-6,
      interests:(inst?.interests?.()??[]).map(i=>({p:engine.toWorld(i.p),label:i.label}))});
    character.applyWorld({wind:{dir:engine.wind.uniforms.uWindDir.value,amp:engine.wind.uniforms.uWindAmp.value,gain:lifeP.wind},hands:xr?grips.filter(g=>g.userData.src).map(g=>g.getWorldPosition(new THREE.Vector3())):[],radius:.05*engine.units});
    character.touch.update(dt,{hands:xr?grips.filter(g=>g.userData.src).map(g=>({p:g.getWorldPosition(new THREE.Vector3()),src:g.userData.src})):[],viewer,U:engine.units});
    character.update(dt);const c=character.bones['センター'].getWorldPosition(blob.position);stage.worldToLocal(c);c.y=.01}
  debugPanel.textContent=`filtered eye (m)
x ${eye.x.toFixed(3)}
y ${eye.y.toFixed(3)}
z ${eye.z.toFixed(3)}

raw z ${rawEye.z.toFixed(3)}
HFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°
K ${K.toFixed(1)}`;
});
engine.start();
addEventListener('pagehide',()=>character?.life.save());

// One clock for every world: the real time of day (this browser's clock, latitude time.lat) drives the sky maps'
// sun (`<map>.elev`) and the crossing's weather (day / sunset / night). Moving a sun by hand turns it off.
const clock={real:1,lat:37.5,set:{}};
engine.params.define([
  {id:'time.real',label:'실제 시각',doc:"Sun follows the real time of day (sky maps' elevation, the crossing's day/sunset/night). Setting a map's sun by hand turns this off.",min:0,max:1,step:1,get:()=>clock.real,set:v=>{clock.real=v;if(v)clock.set={};tickClock()}},
  {id:'time.lat',label:'위도',doc:'Latitude (deg) for the real-time sun: how high it climbs and how long the evening lasts. Default Seoul.',min:-66,max:66,step:.5,get:()=>clock.lat,set:v=>{clock.lat=v;tickClock()}},
]);
function sunElevation(d=new Date()){ // ponytail: solar time = clock time (no longitude/equation of time), off by up to ~40 min
  const R=Math.PI/180,doy=(d-new Date(d.getFullYear(),0,0))/864e5,dec=23.44*Math.sin(2*Math.PI*(284+doy)/365)*R;
  const H=(d.getHours()+d.getMinutes()/60-12)*15*R,lat=clock.lat*R;
  return Math.asin(Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(H))/R;
}
async function tickClock(){
  const id=engine.map;if(!clock.real||!id)return;
  const e=Math.max(-18,Math.round(sunElevation()*2)/2),p=`${id}.elev`,has=engine.params.list().some(d=>d.id===p);
  if(has){
    const cur=engine.params.get(p);
    if(clock.set[p]!==undefined&&Math.abs(cur-clock.set[p])>.6){clock.real=0;return} // someone moved the sun: hands off
    if(cur!==e)await engine.params.set(p,e);clock.set[p]=e;
  }
  if(id==='crossing'){const w=e>12?'day':e>-4?'sunset':'night';if(clock.weather!==w){clock.weather=w;await engine.params.set('crossing.weather',w)}}
}
engine.on('map',()=>{clock.set={};clock.weather=null;setTimeout(tickClock,500)});
setInterval(tickClock,20000);
// VR: an ENTER VR button when a headset is there (Quest via Link/Air Link + Chrome/Edge on this PC).
// ?xremu fakes a Quest 2 in the browser (Meta's IWER) to test without one.
(async()=>{
  if(query.has('xremu')){const {XRDevice,metaQuest2}=await import('https://cdn.jsdelivr.net/npm/iwer@2.4.0/build/iwer.module.min.js');window.xrDevice=new XRDevice(metaQuest2);window.xrDevice.installRuntime({forceInstall:true})}
  if(await navigator.xr?.isSessionSupported('immersive-vr').catch(()=>false))document.body.appendChild(VRButton.createButton(renderer));
})();
connectBridge(engine);

import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { FaceTracker } from './tracking/FaceTracker.js';
import { OffAxisCamera } from './spatial/OffAxisCamera.js';
import { ModelLoader } from './models/ModelLoader.js';
import { Calibration, isMobile } from './calibration/Calibration.js';
import { bindCalibrationPanel } from './ui/CalibrationPanel.js';
import { mountChatBar } from './ui/ChatBar.js';
import { createTestChamber } from './scene/TestChamber.js';
import { createCrossing, REFS, groundY } from './scene/Crossing.js';
import { createPost } from './scene/Post.js';
import { createWeather } from './scene/Weather.js';
import { addFoliage } from './scene/Foliage.js';
import { createGI } from './scene/GI.js';
import { Character, BUILTIN_MOTIONS, IDLE_POSE, DEFAULT_MODEL } from './character/Character.js';

const $=s=>document.querySelector(s),canvas=$('#scene'),video=$('#camera'),status=$('#status'),debugPanel=$('#debugPanel'),calPanel=$('#calibration'),motionSel=$('#motion'),modelSel=$('#modelSel');
const calibration=new Calibration();
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1; // applied by the post chain's OutputPass
const scene=new THREE.Scene();scene.background=new THREE.Color(0x03050a);
const camera=new THREE.PerspectiveCamera(45,1,.01,30000),spatial=new OffAxisCamera(camera,{far:30000});
let eye={x:0,y:0,z:isMobile?.42:.6},rawEye={...eye};
const restEye={...eye},viewEye={...eye},viewVel={x:0,y:0,z:0};
// critically damped spring toward target (Holden), per axis; mutates pos/vel
function dampSpring(pos,vel,target,halflife,dt){
  const y=(4*Math.LN2)/halflife/2,e=Math.exp(-y*dt);
  for(const k of ['x','y','z']){const j0=pos[k]-target[k],j1=vel[k]+j0*y;pos[k]=e*(j0+j1*dt)+target[k];vel[k]=e*(vel[k]-j1*y*dt)}
}
window.setEye=p=>{eye={...eye,...p}}; // debug: fake a viewer position (meters) without the camera

// three.js MMD example lighting, a bit dimmer (3/3 blew out skin on Sour-style models).
const ambient=new THREE.AmbientLight(0xaaaaaa,2);scene.add(ambient);
const gi=createGI(renderer);window.gi=gi; // debug: gi.strength.value, gi.key
const key=gi.key; // the character's own key light: lights only her (see GI.js), driven per weather
const outline=new OutlineEffect(renderer); // MMD's ink lines; most of the "MMD look"
window.outline=true;window.scene=scene; // debug
const post=createPost(renderer,scene,camera,outline);window.post=post; // debug

// Background: the railway crossing (default) or the calibration grid room.
const crossing=createCrossing(renderer);window.crossing=crossing; // debug
const weather=createWeather({renderer,scene,crossing,post,ambient,key});window.weather=weather;
// re-shoot the character's bounce light whenever what surrounds her changes (weather, background)
const captureGI=()=>character&&gi.capture(scene,character.mesh.getWorldPosition(new THREE.Vector3()).setY(stage.position.y+charHeight*.6),character.mesh);
let foliage=null;const foliageLevel=new URLSearchParams(location.search).get('foliage')??'full'; // full | grass | off
if(foliageLevel!=='off')addFoliage(crossing.group,renderer,{models:foliageLevel==='full'}).then(f=>foliage=f).catch(e=>console.error('foliage',e));
let weatherName=new URLSearchParams(location.search).get('weather')||'sunset';
let bg=new URLSearchParams(location.search).get('bg')||'crossing',weatherSel=null;
function applyBackground(){
  const on=bg==='crossing'&&!!charHeight;
  crossing.group.visible=on;
  if(chamber)chamber.visible=!on;
  blob.material.opacity=on?0:1; // real sun shadows replace the blob
  if(!on)scene.background=new THREE.Color(0x03050a);
  if(on){const U=charHeight/1.6;crossing.fit(scene,U);post.setScale(U);weather.set(weatherName,U).then(n=>{if(weatherSel)weatherSel.value=n;captureGI()})}
  else{crossing.unfit(scene);post.grade(null);renderer.toneMappingExposure=1;ambient.color.set('#aaaaaa');ambient.intensity=2;key.color.set('#ffffff');key.intensity=2.5;key.position.set(-1,1,1);captureGI()}
}

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
  chamber.visible=!(bg==='crossing'&&charHeight);
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
  for(const m of [].concat(mesh.material))gi.patch(m);
  mesh.castShadow=true;if(!crossing.group.parent)stage.add(crossing.group);applyBackground();
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
const bgSel=document.createElement('select');bgSel.innerHTML='<option value="crossing">배경: 踏切</option><option value="grid">배경: 그리드</option>';bgSel.value=bg;
bgSel.onchange=()=>{bg=bgSel.value;applyBackground()};
const bellBtn=document.createElement('button');bellBtn.type='button';bellBtn.textContent='🔔 종소리 꺼짐';let bellOn=false;
bellBtn.onclick=()=>{bellOn=!bellOn;crossing.setSound(bellOn);bellBtn.textContent=bellOn?'🔔 종소리 켜짐':'🔔 종소리 꺼짐'};
weatherSel=document.createElement('select');weatherSel.innerHTML=weather.list().map(([k,l])=>`<option value="${k}">${l}</option>`).join('');weatherSel.value=weatherName;
weatherSel.onchange=()=>{weatherName=weatherSel.value;if(bg==='crossing')weather.set(weatherName,charHeight/1.6).then(()=>{captureGI();gfxUndo.length=gfxRedo.length=0;syncGfx()})}; // a new weather is a new baseline
// Free camera: F or the button toggles; click the view to grab the mouse (Esc releases). WASD move,
// Space/C up/down, Shift fast. The head-coupled window view is suspended while it's on.
const freeCam={on:false,keys:new Set(),controls:new PointerLockControls(camera,canvas)};
const freeBtn=$('#freeBtn');
function toggleFree(){freeCam.on=!freeCam.on;freeBtn.classList.toggle('on',freeCam.on);if(!freeCam.on)freeCam.controls.unlock()}
freeBtn.onclick=toggleFree;
// Moving her: she stays put at the window's centre and the crossing slides under her (focus = her spot in
// crossing metres), so her physics never sees a jump. In free cam with the mouse grabbed, a click sends her to
// the walkable ground under the crosshair; the camera moves with the world so on screen it's her that moves.
const focus=new THREE.Vector3(),ray=new THREE.Raycaster();
function moveMiku(p){
  const U=crossing.group.scale.x;
  camera.position.addScaledVector(p.clone().sub(focus),-U);
  focus.copy(p);crossing.group.position.copy(p).multiplyScalar(-U);crossing.setFocus(p);
  clearTimeout(moveMiku.t);moveMiku.t=setTimeout(captureGI,300); // re-shoot her bounce light where she landed
}
window.moveMiku=(x,z)=>moveMiku(new THREE.Vector3(x,groundY(z),z)); // debug
const crosshair=Object.assign(document.createElement('div'),{style:'position:fixed;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 3px #000;pointer-events:none;display:none;z-index:50'});
document.body.append(crosshair);
freeCam.controls.addEventListener('lock',()=>crosshair.style.display='block');
freeCam.controls.addEventListener('unlock',()=>crosshair.style.display='none');
canvas.addEventListener('click',()=>{
  if(!freeCam.on||!character)return;
  if(!freeCam.controls.isLocked){freeCam.controls.lock();return}
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  const hit=ray.intersectObjects(REFS.walkable,false)[0];
  if(hit)moveMiku(crossing.group.worldToLocal(hit.point.clone()));
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
$('#sceneCtl').append(bgSel,weatherSel,bellBtn);
$('#motion').after(resetBtn);
$('#menuBtn').onclick=()=>{$('#drawer').classList.toggle('hidden');$('#menuBtn').classList.toggle('on')};

// Graphics: live sliders over the values the weather presets set. Picking a weather re-reads them.
const GFX=[ // label, get, set, min, max, step
  ['노출',()=>renderer.toneMappingExposure,v=>renderer.toneMappingExposure=v,0.3,2,0.01],
  ['앰비언트',()=>ambient.intensity,v=>ambient.intensity=v,0,3,0.01],
  ['키라이트',()=>gi.key.intensity,v=>gi.key.intensity=v,0,6,0.05],
  ['GI 색조',()=>gi.strength.value,v=>gi.strength.value=v,0,1.5,0.01],
  ['발광체 빛',()=>gi.emGain.value,v=>gi.emGain.value=v,0,5,0.05],
  ['해',()=>crossing.sun.intensity,v=>crossing.sun.intensity=v,0,8,0.05],
  ['하늘 반사',()=>scene.environmentIntensity,v=>scene.environmentIntensity=v,0,2,0.01],
  ['하늘 밝기',()=>scene.backgroundIntensity,v=>scene.backgroundIntensity=v,0,2,0.01],
  ['블룸',()=>post.bloom.strength,v=>post.bloom.strength=v,0,2,0.01],
  ['블룸 기준',()=>post.bloom.threshold,v=>post.bloom.threshold=v,0.2,3,0.01],
  ['AO',()=>post.ao.blendIntensity,v=>post.ao.blendIntensity=v,0,1.5,0.01],
  ['채도',()=>post.gradeU.sat.value,v=>post.gradeU.sat.value=v,0,2,0.01],
  ['대비',()=>post.gradeU.contrast.value,v=>post.gradeU.contrast.value=v,0.5,1.5,0.01],
  ['세피아',()=>post.gradeU.sepia.value,v=>post.gradeU.sepia.value=v,0,1,0.01],
  ['비네트',()=>post.gradeU.vignette.value,v=>post.gradeU.vignette.value=v,0,1,0.01],
];
const gfxCtl=$('#gfxCtl');
gfxCtl.innerHTML=GFX.map(([l,,,mn,mx,st],i)=>`<label class="slider">${l}<input type="range" min="${mn}" max="${mx}" step="${st}" data-i="${i}"><output></output></label>`).join('')+'<button type="button" data-gfx-reset>날씨 기본값으로</button>';
const setGfx=(i,v)=>{GFX[i][2](v);const el=gfxCtl.querySelector(`[data-i="${i}"]`);el.value=v;el.nextElementSibling.textContent=(+v).toFixed(2)};
// undo history: one entry per drag (value before pointer-down/keyboard nudge), Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y
const gfxUndo=[],gfxRedo=[];
gfxCtl.querySelectorAll('input').forEach(el=>{
  const i=+el.dataset.i,mark=()=>{el._before??=GFX[i][1]()};
  el.addEventListener('pointerdown',mark);el.addEventListener('keydown',mark);
  el.oninput=()=>{mark();setGfx(i,+el.value)};
  el.onchange=()=>{if(el._before!==undefined&&el._before!==+el.value){gfxUndo.push([i,el._before]);gfxRedo.length=0}el._before=undefined};
});
addEventListener('keydown',e=>{
  if(!(e.ctrlKey||e.metaKey)||e.target.closest?.('input[type=text],textarea,select,#chat'))return;
  const redo=e.code==='KeyY'||(e.code==='KeyZ'&&e.shiftKey),undo=e.code==='KeyZ'&&!e.shiftKey;
  const [from,to]=undo?[gfxUndo,gfxRedo]:redo?[gfxRedo,gfxUndo]:[];
  if(!from?.length)return;
  e.preventDefault();const [i,v]=from.pop();to.push([i,GFX[i][1]()]);setGfx(i,v);
});
function syncGfx(){gfxCtl.querySelectorAll('input').forEach(el=>{const v=GFX[el.dataset.i][1]();el.value=v;el.nextElementSibling.textContent=(+v).toFixed(2)})}
gfxCtl.querySelector('[data-gfx-reset]').onclick=()=>weatherSel.onchange();
$('#drawer').addEventListener('toggle',e=>{if(e.target.open&&e.target.contains(gfxCtl))syncGfx()},true);
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

function resize(){renderer.setSize(innerWidth,innerHeight,false);post.setSize(innerWidth,innerHeight,renderer.getPixelRatio());layout()}addEventListener('resize',resize);addEventListener('fullscreenchange',resize);resize();
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
  const param=new URLSearchParams(location.search).get('model');
  if(param&&!avail.some(([,u])=>u===param))avail.unshift([param.split('/').pop(),param]);
  modelSel.innerHTML=avail.map(([n,u])=>`<option value="${u}">${n}</option>`).join('');
  modelSel.value=param||avail[0][1];
  modelSel.onchange=()=>loadCharacter(modelSel.value).catch(e=>{console.error(e);status.textContent='error: '+(e.message||e)});
  modelSel.onchange();
})();

const clock=new THREE.Clock();
function frame(){
  const dt=Math.min(clock.getDelta(),.1);
  // Head motion: critically damped spring (kills tracker jitter) + parallax strength around the rest pose.
  // A physically exact window (parallax 1) swings the far background as much as the head moves.
  const c=calibration.data,P=c.parallax??1,hl=Math.max(.001,c.smoothing??0);
  dampSpring(viewEye,viewVel,eye,hl,dt);const rest=restEye;
  const ve={x:rest.x+(viewEye.x-rest.x)*P,y:rest.y+(viewEye.y-rest.y)*P,z:rest.z+(viewEye.z-rest.z)*P};
  if(freeCam.on)flyFreeCam(dt);else{const vp=viewport();spatial.update({x:(ve.x-vp.ox)*K,y:(ve.y-vp.oy)*K,z:ve.z*K})}
  if(character){character.lookTarget=camera.position;character.update(dt);const c=character.bones['センター'].getWorldPosition(blob.position);stage.worldToLocal(c);c.y=.01}
  debugPanel.textContent=`filtered eye (m)\nx ${eye.x.toFixed(3)}\ny ${eye.y.toFixed(3)}\nz ${eye.z.toFixed(3)}\n\nraw z ${rawEye.z.toFixed(3)}\nHFOV ${calibration.data.cameraHFovDeg.toFixed(1)}°\nK ${K.toFixed(1)}`;
  crossing.tick(clock.elapsedTime,dt);weather.tick(clock.elapsedTime,dt);foliage?.tick(clock.elapsedTime);gi.tick(REFS.emitters);
  post.render();requestAnimationFrame(frame)
}frame();

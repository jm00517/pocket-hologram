const KEY='pocket-hologram-calibration-v3';
export const GALAXY_S21_ULTRA={
  name:'Galaxy S21 Ultra',
  // Physical width of the full screen (portrait). Height comes from the viewport aspect.
  screenWidthM:0.0695,
  // Front camera position relative to the physical screen center (+y up).
  cameraOffsetXM:0,
  cameraOffsetYM:0.074,
  cameraHFovDeg:65,
  irisDiameterM:0.0117
};
// Desktop: CSS px ≈ 1/96 inch on most monitors at their OS scale, webcam centered above the top bezel.
// ponytail: CSS-px heuristic is ±10% off on odd DPI monitors; measure the screen and type it in if so.
const PX=0.0254/96;
export const DESKTOP={
  name:'Desktop',
  screenWidthM:screen.width*PX,
  cameraOffsetXM:0,
  cameraOffsetYM:screen.height*PX/2+0.01,
  cameraHFovDeg:65,
  irisDiameterM:0.0117
};
export const isMobile=matchMedia('(pointer: coarse)').matches;
const preset=isMobile?GALAXY_S21_ULTRA:DESKTOP;
const key=`${KEY}-${preset.name}`;
export class Calibration{
  constructor(){this.preset=preset;this.data={...preset,...this.load()}}
  load(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return{}}}
  save(patch){this.data={...this.data,...patch};try{localStorage.setItem(key,JSON.stringify(this.data))}catch{}return this.data}
  reset(){try{localStorage.removeItem(key)}catch{}this.data={...preset};return this.data}
}

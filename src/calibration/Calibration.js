const KEY='pocket-hologram-calibration-v2';
export const GALAXY_S21_ULTRA={
  name:'Galaxy S21 Ultra',
  // Approximate visible display dimensions derived from 6.8" 20:9 geometry.
  // Calibration remains user-adjustable because browser viewport/cutouts vary.
  screenWidthM:0.0695,
  screenHeightM:0.1544,
  cameraOffsetXM:0,
  cameraOffsetYM:0.074,
  cameraHFovDeg:65,
  irisDiameterM:0.0117
};
export class Calibration{
  constructor(){this.data={...GALAXY_S21_ULTRA,...this.load()}}
  load(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return{}}}
  save(patch){this.data={...this.data,...patch};localStorage.setItem(KEY,JSON.stringify(this.data));return this.data}
  reset(){localStorage.removeItem(KEY);this.data={...GALAXY_S21_ULTRA};return this.data}
}
export function bindCalibrationPanel(root,calibration,onChange){
  const fields=[['screenWidthM','Screen W (mm)',1000],['cameraOffsetXM','Cam X (mm)',1000],['cameraOffsetYM','Cam Y (mm)',1000],['cameraHFovDeg','Cam HFOV°',1]];
  root.innerHTML='<b>Calibration</b>'+fields.map(([k,l,s])=>`<label>${l}<input data-k="${k}" type="number" step="0.1" value="${(calibration.data[k]*s).toFixed(1)}"></label>`).join('')+`<button data-reset>Reset ${calibration.preset.name} preset</button>`;
  root.querySelectorAll('input').forEach(el=>el.onchange=()=>{const def=fields.find(x=>x[0]===el.dataset.k);const v=Number(el.value)/def[2];calibration.save({[el.dataset.k]:v});onChange?.(calibration.data)});
  root.querySelector('[data-reset]').onclick=()=>{calibration.reset();bindCalibrationPanel(root,calibration,onChange);onChange?.(calibration.data)};
}
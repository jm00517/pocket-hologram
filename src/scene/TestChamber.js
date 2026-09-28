import * as THREE from 'three';
// Box behind the screen plane, sized to the physical screen so the bezel is the window frame.
export function createTestChamber(scene,{width,height,depth=.15}){
  const g=new THREE.Group();g.position.z=-depth/2;
  const mat=new THREE.LineBasicMaterial({color:0x6f7f9f,transparent:true,opacity:.8});
  const pts=[];
  const x0=-width/2,x1=width/2,y0=-height/2,y1=height/2,z0=depth/2,z1=-depth/2;
  const step=.01; // 1 cm grid
  for(let x=x0;x<=x1+1e-6;x+=step){pts.push(x,y0,z0,x,y0,z1,x,y1,z0,x,y1,z1)}
  for(let y=y0;y<=y1+1e-6;y+=step){pts.push(x0,y,z0,x0,y,z1,x1,y,z0,x1,y,z1)}
  for(let z=z1;z<=z0+1e-6;z+=step){pts.push(x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z,x0,y0,z,x0,y1,z,x1,y0,z,x1,y1,z)}
  for(let x=x0;x<=x1+1e-6;x+=step)pts.push(x,y0,z1,x,y1,z1);
  for(let y=y0;y<=y1+1e-6;y+=step)pts.push(x0,y,z1,x1,y,z1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.add(new THREE.LineSegments(geo,mat));scene.add(g);return g;
}

class LowPass {
  constructor(){this.initialized=false;this.y=0}
  filter(x,a){if(!this.initialized){this.y=x;this.initialized=true}else this.y=a*x+(1-a)*this.y;return this.y}
}
const alpha=(cutoff,dt)=>{const tau=1/(2*Math.PI*cutoff);return 1/(1+tau/Math.max(dt,1e-4))}
export class OneEuroFilter{
  constructor({minCutoff=1.2,beta=.025,dCutoff=1}={}){this.minCutoff=minCutoff;this.beta=beta;this.dCutoff=dCutoff;this.x=new LowPass();this.dx=new LowPass();this.last=null}
  filter(v,t=performance.now()/1000){
    if(this.last==null){this.last=t;return this.x.filter(v,1)}
    const dt=Math.max(t-this.last,1/240);this.last=t;
    const prev=this.x.initialized?this.x.y:v;
    const d=(v-prev)/dt;
    const ed=this.dx.filter(d,alpha(this.dCutoff,dt));
    return this.x.filter(v,alpha(this.minCutoff+this.beta*Math.abs(ed),dt));
  }
}
export class PoseFilter{
  constructor(){this.x=new OneEuroFilter({beta:.04});this.y=new OneEuroFilter({beta:.04});this.z=new OneEuroFilter({minCutoff:.8,beta:.015})}
  filter(p,t){return{x:this.x.filter(p.x,t),y:this.y.filter(p.y,t),z:this.z.filter(p.z,t)}}
}
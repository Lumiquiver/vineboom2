// Shared deterministic building layout used by the renderer and server hit validation.
const SEEDS={metro:47,atlas:129,dune:803,pine:391,oldtown:626};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function layoutHash(seed,x,z){const n=Math.sin((x+seed*.73)*12.9898+(z-seed*.21)*78.233)*43758.5453;return n-Math.floor(n);}

// Axis-aligned collision bounds for a box rotated around its vertical center axis.
// This keeps movement and server raycasts aligned with vehicle/prop visuals.
export function rotatedFootprint(width,depth,angle=0){
  const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  return {w:width*c+depth*s,d:width*s+depth*c};
}
const CENTERS={
  metro:[[-88,-88],[-88,-44],[-88,44],[-88,88],[-44,-88],[-44,-44],[-44,44],[-44,88],[44,-88],[44,-44],[44,44],[44,88],[88,-88],[88,-44],[88,44],[88,88]],
  atlas:[[-78,-78],[-78,-44],[-78,44],[-78,78],[-44,-78],[-44,78],[-28,-54],[-28,54],[28,-54],[28,54],[44,-78],[44,78],[78,-78],[78,-44],[78,44],[78,78]],
  dune:[[-84,-82],[-78,-42],[-80,4],[-82,75],[-42,-72],[-38,-22],[-42,52],[-4,-84],[-8,-47],[-4,58],[34,-76],[38,-24],[34,42],[78,-76],[82,-4],[80,72]],
  pine:[[-78,-78],[-78,-34],[-78,34],[-78,78],[-44,-78],[-44,78],[44,-78],[44,78],[78,-78],[78,-34],[78,34],[78,78]],
  oldtown:[[-88,-80],[-88,-28],[-88,34],[-78,82],[-48,-70],[-48,-18],[-48,50],[-15,-84],[-12,-42],[-18,70],[24,-76],[28,-23],[22,35],[56,-82],[61,-45],[61,16],[59,72],[88,48]],
};
export function getDistrictFootprints(mapId){
  const seed=SEEDS[mapId]||SEEDS.metro;
  const biome=mapId==='atlas'?'military':mapId==='dune'?'desert':mapId==='pine'?'forest':mapId==='oldtown'?'ruins':'city';
  const max=biome==='forest'?12:biome==='desert'?15:biome==='military'?17:20;
  const centers=CENTERS[mapId]||CENTERS.metro,out=[];
  for(let ix=0;ix<centers.length&&out.length<max;ix++){
    const [cx,cz]=centers[ix];
    if(biome==='forest'&&layoutHash(seed,ix,cz)>.89)continue;
    const n=biome==='desert'?1:layoutHash(seed,ix,cz)>.7?2:1;
    for(let j=0;j<n&&out.length<max;j++){
      const ox=n===1?0:(j===0?-6.6:6.6),oz=n===1?0:(j===0?4.6:-4.6);
      const w=(biome==='military'?12:13)+layoutHash(seed+ix,cz+j,ix)*7;
      const d=(biome==='military'?12:13)+layoutHash(seed+cz,ix+j,cz)*7;
      let h=biome==='military'?layoutHash(seed,ix+j,cz)*4+4.5:biome==='desert'?layoutHash(seed,ix,cz+j)*4.5+4.5:biome==='forest'?layoutHash(seed,ix+j,cz)*4.5+4:layoutHash(seed,ix+j,cz)*10+5.5;
      if(mapId==='oldtown')h=Math.max(2.4,h*.64);
      out.push({x:cx+ox,z:cz+oz,w,d,h,index:out.length});
    }
  }
  return out;
}
export function getSpawnCandidates(mapId,team=null){
  const side=team===1?1:-1;
  const xLanes=mapId==='pine'?[side*58,side*56,side*61]:[side*111,side*108,side*104];
  const zLanes=[-84,-63,-42,-21,0,21,42,63,84];
  const result=[];
  for(const x of xLanes)for(const z of zLanes)result.push({x,y:0,z,team});
  return result;
}
export function getStaticBlockers(mapId){
  const out=getDistrictFootprints(mapId).map(b=>({...b,y:0}));
  if(mapId==='atlas')out.push({x:0,y:0,z:0,w:31,d:17,h:7});
  else if(mapId==='pine')out.push({x:0,y:0,z:0,w:28,d:18,h:5});
  else if(mapId==='oldtown')out.push({x:0,y:0,z:0,w:21,d:16,h:5.2});
  if(mapId==='pine'){
    const seed=SEEDS.pine;for(let i=0;i<175;i++){let x,z;const side=i%4;if(side===0){x=-106+layoutHash(seed,i,2)*45;z=-105+layoutHash(seed,2,i)*210;}else if(side===1){x=61+layoutHash(seed,i,3)*45;z=-105+layoutHash(seed,3,i)*210;}else if(side===2){x=-105+layoutHash(seed,i,4)*210;z=-108+layoutHash(seed,4,i)*37;}else{x=-105+layoutHash(seed,i,5)*210;z=70+layoutHash(seed,5,i)*36;}if(Math.abs(x)<13||Math.abs(z)<13)continue;if(Math.abs((Math.abs(x)%44)-22)<7||Math.abs((Math.abs(z)%44)-22)<7)continue;const scale=.7+layoutHash(seed,i,8)*.7;if(layoutHash(seed,i,10)>.75)out.push({x,y:0,z,w:.85*scale,h:4*scale,d:.85*scale});}
  }
  // Hard perimeter walls are shared collision references too.
  out.push({x:0,y:0,z:-119,w:240,d:2,h:8},{x:0,y:0,z:119,w:240,d:2,h:8},{x:-119,y:0,z:0,w:2,d:240,h:8},{x:119,y:0,z:0,w:2,d:240,h:8});
  return out;
}

import * as THREE from 'three';
import { MAPS, POWERUPS, WORLD_LIMIT } from '../shared/game-data.js';
import { getDistrictFootprints, getSpawnCandidates, rotatedFootprint } from '../shared/map-layout.js';

const SEED = { metro: 47, atlas: 129, dune: 803, pine: 391, oldtown: 626 };
const matCache = new Map();
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function hash(seed, x, z) {
  let n = Math.sin((x + seed * .73) * 12.9898 + (z - seed * .21) * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
function tint(hex, factor) { return new THREE.Color(hex).multiplyScalar(factor); }
function textureFor(kind, hex) {
  const key = `${kind}:${hex}`;
  if (matCache.has(key)) return matCache.get(key);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex; ctx.fillRect(0,0,256,256);
  let seed = 27;
  for (let i=0;i<1700;i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x=seed%256, y=(seed>>>8)%256, a=.025 + ((seed>>>16)%35)/1000;
    ctx.fillStyle = (seed&1) ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a*1.8})`;
    ctx.fillRect(x,y,1+(seed%3),1+(seed%3));
  }
  if (kind==='asphalt' || kind==='concrete') {
    ctx.strokeStyle='rgba(0,0,0,.09)'; ctx.lineWidth=1;
    for(let y=16;y<256;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y+(y%3));ctx.stroke();}
  }
  if (kind==='brick' || kind==='ruin') {
    ctx.strokeStyle='rgba(15,15,15,.12)'; ctx.lineWidth=2;
    for(let y=0;y<256;y+=22){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(256,y);ctx.stroke();for(let x=(y%44?0:22);x<256;x+=44){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+22);ctx.stroke();}}
  }
  if (kind==='sand') {
    ctx.strokeStyle='rgba(80,54,30,.12)';
    for(let i=0;i<60;i++){let y=(i*31)%256;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(70,y-9,170,y+10,256,y-3);ctx.stroke();}
  }
  if (kind==='metal') {
    ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=2;
    for(let x=16;x<256;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,256);ctx.stroke();}
    for(let y=16;y<256;y+=32){ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.arc(8,y,2,0,Math.PI*2);ctx.fill();}
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace=THREE.SRGBColorSpace; tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.anisotropy=4;
  const material = new THREE.MeshStandardMaterial({map:tex, color:0xffffff, roughness:kind==='metal'?.53:.91, metalness:kind==='metal'?.35:.03});
  material.userData.vbShared=true;matCache.set(key,material); return material;
}

function createGrid(colliders, cellSize=8) {
  const grid = new Map();
  for (const box of colliders) {
    const minX=Math.floor((box.x-box.w/2)/cellSize), maxX=Math.floor((box.x+box.w/2)/cellSize);
    const minZ=Math.floor((box.z-box.d/2)/cellSize), maxZ=Math.floor((box.z+box.d/2)/cellSize);
    for(let x=minX;x<=maxX;x++) for(let z=minZ;z<=maxZ;z++) {
      const key=`${x},${z}`; if(!grid.has(key))grid.set(key,[]); grid.get(key).push(box);
    }
  }
  return {grid,cellSize};
}

export function buildMap(mapId) {
  const config=MAPS.find(m=>m.id===mapId)||MAPS[0];
  const seed=SEED[config.id]||47, group=new THREE.Group(), colliders=[], windows=[], treeTrunks=[], treeCrowns=[], spawns=[], props=[];
  const material=(hex,kind='concrete')=>textureFor(kind,hex);
  const addBox=(x,y,z,w,h,d,hex,kind='concrete',solid=false, opts={})=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material(hex,kind));
    mesh.position.set(x,y+h/2,z); mesh.castShadow=opts.castShadow!==false; mesh.receiveShadow=true;
    if(opts.rotationY)mesh.rotation.y=opts.rotationY;
    group.add(mesh);
    if(solid) { const footprint=rotatedFootprint(w,d,opts.rotationY||0); colliders.push({x,y,z,w:footprint.w,h,d:footprint.d,kind:opts.kind||'solid'}); }
    return mesh;
  };
  const addCylinder=(x,y,z,r,h,hex,solid=false,segments=10,collisionOverride=null)=>{
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),new THREE.MeshStandardMaterial({color:hex,roughness:.82}));m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;group.add(m);
    if(solid)colliders.push({x,y,z,w:r*2,h,d:r*2,kind:'solid',...(collisionOverride||{})});return m;
  };
  const groundColor=config.biome==='desert'?'#b9a074':config.biome==='forest'?'#51694f':config.biome==='ruins'?'#77736d':config.biome==='military'?'#777966':'#656c70';
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(240,240,1,1),material(groundColor,config.biome==='desert'?'sand':'concrete'));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.055;ground.receiveShadow=true;group.add(ground);

  // Each biome has a different circulation plan: city grid, runway base, refinery service roads,
  // winding forest trails, and broken streets. Lane markings are instanced for low draw-call cost.
  const roadHex=config.road, sidewalk=config.biome==='desert'?'#b29a75':config.biome==='forest'?'#69776a':'#90969a';
  const roadDashes=[];
  const road=(x,z,w,d,orientation='h',withMarks=true)=>{
    addBox(x,.005,z,w,.05,d,roadHex,'asphalt',false,{castShadow:false});
    if(withMarks){if(orientation==='h'){for(let xx=x-w/2+4;xx<x+w/2-3;xx+=8)roadDashes.push({x:xx,y:.047,z,w:3.3,h:.018,d:.13});}
      else{for(let zz=z-d/2+4;zz<z+d/2-3;zz+=8)roadDashes.push({x,y:.047,z:zz,w:.13,h:.018,d:3.3});}}
  };
  if(config.biome==='city'){
    for(let line=-110;line<=110;line+=44){road(line,0,9,232,'v');road(0,line,232,9,'h');
      addBox(line-6,.04,0,2,.12,232,sidewalk,'concrete',false,{castShadow:false});addBox(line+6,.04,0,2,.12,232,sidewalk,'concrete',false,{castShadow:false});
      addBox(0,.04,line-6,232,.12,2,sidewalk,'concrete',false,{castShadow:false});addBox(0,.04,line+6,232,.12,2,sidewalk,'concrete',false,{castShadow:false});}
  }else if(config.biome==='military'){
    road(0,0,22,225,'v');road(-57,0,12,200,'v');road(58,0,13,200,'v');road(0,-63,130,10,'h');road(0,65,130,10,'h');road(-22,0,8,88,'v',false);road(22,0,8,88,'v',false);
    for(let z=-100;z<=100;z+=12){addBox(0,.052,z,9,.018,1.1,'#d8d4aa','concrete',false,{castShadow:false});}
    addBox(0,.035,-108,30,.10,5,'#d4c9a0','concrete',false,{castShadow:false});addBox(0,.035,108,30,.10,5,'#d4c9a0','concrete',false,{castShadow:false});
  }else if(config.biome==='desert'){
    for(const z of [-78,-34,28,80])road(0,z,220,8,'h');
    for(const x of [-84,-22,52,91])road(x,0,7,204,'v',false);
    road(-42,-4,35,8,'h',false);road(37,49,43,8,'h',false);
  }else if(config.biome==='forest'){
    for(let z=-105;z<=105;z+=14){const x=Math.sin(z/34)*23;road(x,z,7,17,'v',false);}
    road(-4,-62,82,6,'h',false);road(10,45,102,6,'h',false);road(0,0,12,46,'v',false);
    for(const x of [-12,12])for(const z of [-78,78])addBox(x,.04,z,1,.12,16,sidewalk,'concrete',false,{castShadow:false});
  }else{
    for(const z of [-88,-35,22,79]){road(0,z,220,8,'h',false);for(const gap of [-68,-24,30,75])addBox(gap,.055,z,hash(seed,gap,z)>.5?10:4,.06,8,'#4a4947','asphalt',false,{castShadow:false});}
    for(const x of [-82,-26,42,88]){road(x,0,7,220,'v',false);for(const gap of [-74,-8,58])addBox(x,.06,gap,7,.05,hash(seed,x,gap)>.5?12:5,'#79716a','concrete',false,{castShadow:false});}
  }
  if(roadDashes.length){const marks=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material('#b8b8ad','concrete'),roadDashes.length),dummy=new THREE.Object3D();roadDashes.forEach((m,i)=>{dummy.position.set(m.x,m.y,m.z);dummy.scale.set(m.w,m.h,m.d);dummy.updateMatrix();marks.setMatrixAt(i,dummy.matrix);});marks.castShadow=false;marks.receiveShadow=true;group.add(marks);}

  const buildingHex = config.biome==='desert'?['#a88761','#987c5d','#c0a17b']:config.biome==='military'?['#777e69','#8b8a73','#a09b80']:config.biome==='forest'?['#66746d','#8c9691','#677c79']:config.biome==='ruins'?['#68615c','#7d736a','#857f76']:['#717a80','#8d969b','#626c73'];
  const roofs = config.biome==='desert'?['#70614f','#877258']:config.biome==='military'?['#555c50','#6c6d60']:config.biome==='forest'?['#46544f','#68726c']:config.biome==='ruins'?['#4c4b49','#67605b']:['#4e585e','#677278'];
  const maxBuildings= config.biome==='forest'?12:config.biome==='desert'?15:config.biome==='military'?17:20;
  let bIndex=0;
  function addBuilding(cx,cz,w,d,h,index) {
    const color=buildingHex[(index+Math.floor(hash(seed,index,cz)*3))%buildingHex.length];
    const baseY=0;
    addBox(cx,baseY,cz,w,h,d,color,config.biome==='ruins'?'ruin':config.biome==='desert'?'sand':'concrete',true);
    addBox(cx,h,cz,w+.35,.32,d+.35,roofs[index%roofs.length],'metal',true);
    // Banding, window recesses and rooftop HVAC units.
    if(config.biome==='city'||config.biome==='ruins'){
      const winRows=Math.max(1,Math.floor((h-1.3)/2.15)), cols=Math.max(2,Math.floor(w/2.7));
      for(let row=0;row<winRows;row++)for(let col=0;col<cols;col++){
        if(hash(seed+index,col,row)>.15){
          const wx=cx-w/2+.85+col*(w-1.7)/Math.max(1,cols-1), wy=1.2+row*2.1;
          windows.push({x:wx,y:wy,z:cz-d/2-.035,w:.65,h:.92,rot:0,color:config.biome==='ruins'?(hash(seed,row,col)>.45?'#242a2b':'#3c3834'):'#263e4a'});
          windows.push({x:wx,y:wy,z:cz+d/2+.035,w:.65,h:.92,rot:Math.PI,color:config.biome==='ruins'?'#38322e':'#304853'});
        }
      }
      for(let floor=0;floor<Math.floor(w/4);floor++){
        const wx=cx-w/2+2+floor*3.8;
        windows.push({x:wx,y:Math.max(1.3,h*.47),z:cz-d/2-.04,w:1.2,h:.14,rot:0,color:'#555e62'});
      }
    }
    if(index%3===0){
      addBox(cx-w*.21,h+.34,cz,1.7,.65,1.25,'#62676a','metal',false);
      addBox(cx+w*.22,h+.34,cz-d*.13,1.1,.65,1.1,'#777b7d','metal',false);
    }
    if(h<=7.6 && index%2===0) {
      const count=Math.ceil(h/.25), sx=cx-w/2-1.7, startZ=cz-d/2+1.5;
      for(let s=0;s<count;s++){
        const stepH=Math.min(h,(s+1)*.25), sz=startZ+s*.42;
        addBox(sx,0,sz,2.2,stepH,.55,config.biome==='desert'?'#8d755c':'#777b7d','concrete',true,{castShadow:false});
      }
      // Broad rooftop lip/landing provides a useful elevated firing lane.
      addBox(sx,h, startZ+count*.42,2.4,.18,.9,roofs[index%roofs.length],'metal',false);
    }
    bIndex++;
  }

  if(config.biome==='forest') {
    // Thick tree line at the edges and several broken groves; reusable geometry instances keep this map light.
    const trunkGeom=new THREE.CylinderGeometry(.24,.34,3.5,7), crownGeom=new THREE.ConeGeometry(2.1,5.2,7);
    const tm=new THREE.MeshStandardMaterial({color:'#4b4034',roughness:1}), cm=new THREE.MeshStandardMaterial({color:'#2e5944',roughness:1});
    const trunks=new THREE.InstancedMesh(trunkGeom,tm,175), crowns=new THREE.InstancedMesh(crownGeom,cm,175);const dummy=new THREE.Object3D();let ti=0;
    for(let i=0;i<175;i++){
      let x,z; const side=i%4;
      if(side===0){x=-106+hash(seed,i,2)*45;z=-105+hash(seed,2,i)*210;}
      else if(side===1){x=61+hash(seed,i,3)*45;z=-105+hash(seed,3,i)*210;}
      else if(side===2){x=-105+hash(seed,i,4)*210;z=-108+hash(seed,4,i)*37;}
      else {x=-105+hash(seed,i,5)*210;z=70+hash(seed,5,i)*36;}
      if(Math.abs(x)<13||Math.abs(z)<13)continue;
      if(Math.abs((Math.abs(x)%44)-22)<7||Math.abs((Math.abs(z)%44)-22)<7)continue;
      const scale=.7+hash(seed,i,8)*.7;
      dummy.position.set(x,1.75*scale,z);dummy.scale.set(scale,scale,scale);dummy.rotation.y=hash(seed,i,9)*Math.PI;dummy.updateMatrix();trunks.setMatrixAt(ti,dummy.matrix);
      dummy.position.set(x,5.0*scale,z);dummy.scale.set(scale,scale,scale);dummy.updateMatrix();crowns.setMatrixAt(ti,dummy.matrix);
      if(hash(seed,i,10)>.75)colliders.push({x,y:0,z,w:.85*scale,h:4*scale,d:.85*scale,kind:'solid'});ti++;
    }
    trunks.count=ti;crowns.count=ti;trunks.castShadow=true;crowns.castShadow=true;group.add(trunks,crowns);
  }

  // Map-specific district footprints are shared with the server so walls, hits and spawns agree.
  for(const footprint of getDistrictFootprints(config.id))addBuilding(footprint.x,footprint.z,footprint.w,footprint.d,footprint.h,footprint.index);

  // Central landmark and map-specific traversable cover.
  if(config.biome==='city'){
    // Sunken metro station with raised platform edges, stairwells, and a train car.
    addBox(0,.04,0,24,.16,14,'#292f34','asphalt',false);
    for(const z of [-6.5,6.5]) addBox(0,.13,z,24,.55,1.0,'#9b9a8d','concrete',true);
    addBox(-2,.22,0,15,.35,3.2,'#3d515a','metal',true);addBox(-2,.58,0,14,.4,2.65,'#56676e','metal',false);
    for(let i=-5;i<=5;i++)addBox(i*1.05,.82,-1.2,.45,.12,.1,'#e9bb65','metal',false);
    for(const x of [-14,14]){addCylinder(x,0,0,.35,5,'#697479',true,8);addBox(x,5,0,1.4,.25,1.4,'#66767e','metal',false);}
  } else if(config.biome==='military'){
    // Hangar, watchtowers, blast walls, landing-pad markings.
    addBox(0,0,0,31,7,17,'#777d70','metal',true);addBox(0,7,0,32,.35,18,'#4c554c','metal',false);
    addBox(0,1.5,8.7,13,3,1.0,'#596259','metal',true);addBox(-5,0,-12,7,1.7,2.4,'#817c67','concrete',true);addBox(6,0,-12,7,1.7,2.4,'#817c67','concrete',true);
    for(const [x,z] of [[-22,-20],[22,-20],[-22,20],[22,20]]){
      addBox(x,0,z,4,5,4,'#777a6a','concrete',true);addBox(x,5,z,5,.3,5,'#41483f','metal',false);
      for(let i=0;i<15;i++)addBox(x-2.8,0,z+3+i*.25,.65,i*.32,.55,'#6d7467','concrete',true,{castShadow:false});
    }
  } else if(config.biome==='desert'){
    // Refinery pipes, storage tanks, a loading yard, and container corridors.
    for(const [x,z,r,h] of [[-9,-9,4,9],[10,8,5,7],[-12,13,3,5]]){
      const tank=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,16),new THREE.MeshStandardMaterial({color:'#9a876e',metalness:.44,roughness:.56}));tank.position.set(x,h/2,z);tank.castShadow=true;tank.receiveShadow=true;group.add(tank);colliders.push({x,y:0,z,w:r*2,h,d:r*2,kind:'solid'});
      addBox(x,h,z,r*2,.28,r*2,'#6b6256','metal',false);
    }
    for(let i=0;i<7;i++){
      const x=-35+i*10;addBox(x,0,-25,8,2.8,3.3,i%2?'#9e6048':'#5e7779','metal',true);addBox(x,2.8,-25,8,.16,3.3,'#3a4447','metal',false);
      addBox(x,0,25,8,2.8,3.3,i%2?'#5c6e71':'#a76a4c','metal',true);
    }
    for(let i=0;i<16;i++){
      const x=-100+i*13,z=(hash(seed,i,44)-.5)*155;
      if(Math.abs(z)<10)continue;
      addCylinder(x,0,z,.38,2.2,'#454b49',true,9);addBox(x,2.2,z,.75,.18,.75,'#8b5b40','metal',false);
    }
  } else if(config.biome==='forest'){
    // A research compound, fenced perimeter segments, air-handling units and covered corridors.
    addBox(0,0,0,28,5,18,'#7c8780','concrete',true);addBox(0,5,0,29,.28,19,'#4e5d56','metal',false);
    for(const x of [-9,9])for(const z of [-7,7])addBox(x,5.3,z,3,.6,2,'#526961','metal',false);
    for(let side=-1;side<=1;side+=2)for(let p=-95;p<=95;p+=9){
      const x=side*103,z=p;if(Math.abs(z)<19)continue;
      addBox(x,0,z,.24,2.1,.24,'#5c6967','metal',true,{castShadow:false});
      if(p%18===0)addBox(x,1.5,z,.22,.1,9,'#7b8a83','metal',false,{castShadow:false});
    }
    for(const [x,z] of [[-20,0],[20,0],[0,-20],[0,20]]){addBox(x,0,z,6,1.2,2.6,'#65766d','metal',true);addBox(x,1.2,z,6,.18,2.6,'#94a49a','metal',false);}
  } else {
    // Collapsed block landmark, rubble piles, concrete roadblocks, and a broken elevated walkway.
    addBox(0,0,0,21,5.2,16,'#65615c','ruin',true);addBox(0,5.2,0,21,.28,16,'#464543','concrete',false);
    addBox(-5,0,-12,10,1.8,2,'#71665c','ruin',true);addBox(8,0,13,11,1.1,2.3,'#777069','ruin',true);
    addBox(-13,2.8,0,9,.35,3,'#65615c','concrete',false);addBox(-17,1.6,0,3,2.9,3,'#716c66','ruin',true);
    for(let i=0;i<22;i++){
      const x=(hash(seed,i,12)-.5)*180,z=(hash(seed,12,i)-.5)*180;
      if(Math.abs(x%44)<10&&Math.abs(z%44)<10)continue;
      const sz=.6+hash(seed,i,13)*1.5;const b=addBox(x,0,z,sz,.2+hash(seed,i,14)*.8,sz,'#77716a','ruin',true);b.rotation.y=hash(seed,i,15)*1.3;
    }
  }

  // Strong, map-specific silhouettes make arenas readable even at a distance.
  if(config.id==='metro'){
    for(const x of [-14,14]){addBox(x,0,-38,1.3,13,1.3,'#4e626d','metal',true);addBox(x,13,-38,3,.45,3,'#d0b46d','metal',false);}
    addBox(0,3,-38,22,.28,.5,'#65c1d2','metal',false);
  }else if(config.id==='atlas'){
    for(const x of [-48,48]){addBox(x,0,0,2.2,18,2.2,'#565f54','metal',true);addBox(x,18,0,4,.65,4,'#778978','metal',false);addBox(x,19,0,2.2,.12,2.2,'#dfc67e','metal',false);}
    addBox(0,9,-20,28,.35,1,'#c7c2a1','metal',false);
  }else if(config.id==='dune'){
    for(const [x,z,r,h] of [[-58,-18,6,12],[58,18,7,15]]){const tower=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,18),new THREE.MeshStandardMaterial({color:'#9a7b59',metalness:.52,roughness:.48}));tower.position.set(x,h/2,z);tower.castShadow=true;tower.receiveShadow=true;group.add(tower);colliders.push({x,y:0,z,w:r*2,h,d:r*2,kind:'solid'});addBox(x,h,z,r*2,.32,r*2,'#544c42','metal',false);}
    for(let i=0;i<5;i++)addBox(-24+i*12,0,-48,1.0,7+(i%2)*2,1.0,'#5b6462','metal',true);
  }else if(config.id==='pine'){
    for(const [x,z] of [[-23,-40],[23,-40],[-23,40],[23,40]]){addCylinder(x,0,z,.2,11,'#747e79',true,8);const dish=new THREE.Mesh(new THREE.SphereGeometry(1.4,12,8,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:'#9ba9a6',metalness:.45,roughness:.42,side:THREE.DoubleSide}));dish.position.set(x,11,z);dish.rotation.x=Math.PI;group.add(dish);}
  }else if(config.id==='oldtown'){
    addBox(-30,0,0,3,15,3,'#4c4743','ruin',true);addBox(-30,15,0,8,.5,8,'#62574f','ruin',false);addBox(-34,10,0,5,.22,1,'#d6ad78','metal',false);
  }

  // Reusable street props; these add scale cues and tactical cover without thousands of draw calls.
  const isDesert=config.biome==='desert', isForest=config.biome==='forest';
  for(let i=0;i<36;i++){
    const road=(i%2===0), lane=-100+((i*29)%200), side=(i%4<2?-1:1), x=road?lane:side*17, z=road?side*17:lane;
    if(isForest&&Math.abs(x)<18&&Math.abs(z)<18)continue;
    if(config.biome==='city'||config.biome==='ruins'){
      // parked vehicles are low, solid cover with windshields and wheels
      const carColor=['#52616b','#8a8f8f','#576c60','#9b8d7d','#41484c'][i%5];
      addBox(x,0,z,4.4,1.05,2.0,carColor,'metal',true,{rotationY:road?0:Math.PI/2});
      addBox(x,.72,z,2.4,.65,1.55,'#39474f','metal',false,{rotationY:road?0:Math.PI/2});
      for(const s of [-1,1])for(const t of [-1,1])addCylinder(x+(road?s*1.4:.95*t),0,z+(road?.83*t:s*1.4),.3,.22,'#202527',true,8);
    } else if(config.biome==='military'||isDesert){
      addBox(x,0,z,4.8,1.2,2.2,hash(seed,i,22)>.5?'#7c806c':'#716858','metal',true,{rotationY:road?0:Math.PI/2});
      addBox(x,.7,z,1.6,.22,2.3,'#a18f73','metal',false,{rotationY:road?0:Math.PI/2});
    } else {
      addBox(x,0,z,2.4,.95,1.7,hash(seed,i,27)>.5?'#5f695f':'#686b65','concrete',true,{rotationY:hash(seed,i,28)});
    }
  }

  // Lamp posts along the streets, with small warm fixtures.
  const lampMat=new THREE.MeshStandardMaterial({color:'#d7cba3',emissive:'#655433',emissiveIntensity:.45});
  for(let i=0;i<30;i++){
    const x=-96+(i*37)%192,z=(i%2? -8:8)+Math.floor(i/2)*.6;
    if(Math.abs(x)<16&&Math.abs(z)<16)continue;
    addCylinder(x,0,z,.11,4.1,config.biome==='desert'?'#625747':'#47535a',false,7);
    const arm=addBox(x+.35,3.9,z,.85,.12,.12,'#47535a','metal',false,{castShadow:false});
    const bulb=new THREE.Mesh(new THREE.BoxGeometry(.28,.13,.25),lampMat);bulb.position.set(x+.7,3.82,z);group.add(bulb);
  }

  // Ground cover, powerup pickups and low tactical barriers are grouped around playable lanes.
  for(let i=0;i<44;i++){
    let x=-103+hash(seed,i,31)*206,z=-103+hash(seed,31,i)*206;
    if(Math.abs(x%44)<9||Math.abs(z%44)<9)continue;
    if(Math.abs(x)<18&&Math.abs(z)<18)continue;
    if(config.biome==='forest'){
      // Fallen logs and boulders create staggered cover between tree lines.
      if(i%3===0){const log=addCylinder(x,0,z,.55,3.2,'#564b3b',true,7,{w:3.2,h:1.1,d:1.1});log.position.y=.55;log.rotation.z=Math.PI/2;}
      else addBox(x,0,z,1.7,.7,1.3,'#53695a','concrete',true);
    } else if(i%3===0) {
      addBox(x,0,z,2.6,1.15,1.1,config.biome==='desert'?'#8e795d':config.biome==='ruins'?'#5b5854':'#606d70','concrete',true);
    }
  }

  // Map boundaries are physical, not just invisible coordinates.
  const boundary='#33383b';
  addBox(0,0,-119,240,8,2,boundary,'concrete',true);addBox(0,0,119,240,8,2,boundary,'concrete',true);
  addBox(-119,0,0,2,8,240,boundary,'concrete',true);addBox(119,0,0,2,8,240,boundary,'concrete',true);

  // Windows are one instanced batch per map instead of individual draw calls.
  if(windows.length){
    const geo=new THREE.BoxGeometry(1,1,.09);const glass=new THREE.MeshStandardMaterial({color:'#a2bdc7',metalness:.25,roughness:.32,emissive:'#193039',emissiveIntensity:.2});
    const instance=new THREE.InstancedMesh(geo,glass,windows.length);const obj=new THREE.Object3D(), c=new THREE.Color();
    windows.forEach((win,i)=>{obj.position.set(win.x,win.y,win.z);obj.scale.set(win.w,win.h,1);obj.rotation.y=win.rot;obj.updateMatrix();instance.setMatrixAt(i,obj.matrix);c.set(win.color);instance.setColorAt(i,c)});
    instance.castShadow=false;instance.receiveShadow=true;group.add(instance);
  }

  // Spawn lanes use open edge corridors; forest deployments stay inside the tree line.
  // Fixed lanes plus collision checks avoid remote starts inside walls/props.
  const spawnBlocked=(x,z)=>colliders.some(b=>{const cx=clamp(x,b.x-b.w/2,b.x+b.w/2),cz=clamp(z,b.z-b.d/2,b.z+b.d/2);return (x-cx)**2+(z-cz)**2<.9**2&&b.y<1.85&&b.y+b.h>.1;});
  for(const team of [0,1]){
    const candidates=getSpawnCandidates(config.id,team).filter(p=>!spawnBlocked(p.x,p.z));
    for(const p of candidates.slice(0,12))spawns.push({...p,y:0,team});
    if(candidates.length<8){
      const side=team===0?-1:1,xLanes=config.id==='pine'?[side*58,side*62,side*67,side*72]:[side*111,side*108,side*104,side*100,side*96];
      for(const x of xLanes)for(let z=-96;z<=96;z+=8){if(spawnBlocked(x,z)||spawns.some(q=>q.team===team&&Math.hypot(q.x-x,q.z-z)<4))continue;spawns.push({x,y:0,z,team});if(spawns.filter(q=>q.team===team).length>=8)break;}
    }
  }
  const objectives={ctf:config.objectivePositions.ctf.map(p=>({...p,y:0})),dom:config.objectivePositions.dom.map(p=>({...p,y:0}))};
  // Pickups are placed on open street corners with cover nearby.
  const pickups=[];
  for(let i=0;i<POWERUPS.length;i++){
    const coords=[[-22,0,-46],[22,0,46],[-66,0,0],[66,0,0],[0,0,-66],[0,0,66]][i];
    pickups.push({id:POWERUPS[i].id,x:coords[0],y:.55,z:coords[2],type:i});
  }
  const collision=createGrid(colliders);
  return {group,config,colliders,collision,spawns,objectives,pickups,seed,status:'ready',ready:Promise.resolve(null)};
}

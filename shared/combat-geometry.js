// Shared combat hitboxes use lower Y faces (not center points), matching rayAabb and map colliders.
const box=(part,x,centerY,z,w,h,d,head=false)=>({part,x,y:centerY-h/2,z,w,h,d,head});

export function playerHitboxes(pos,motion='stand'){
  const x=Number(pos?.x)||0,z=Number(pos?.z)||0,y=Number(pos?.y)||0;
  if(motion==='crawl')return [
    box('head',x,y+.82,z-.43,.42,.42,.48,true),
    box('torso',x,y+.35,z-.06,.66,.36,.95),
    box('arms',x,y+.51,z-.02,.78,.24,.56),
    box('legs',x,y+.22,z+.24,.55,.22,.58),
  ];
  if(['trip','stunned'].includes(motion))return [
    box('head',x,y+1.50,z,.50,.44,.50,true),
    box('torso',x,y+.97,z,.64,.66,.42),
    box('arms',x,y+.96,z,.9,.60,.40),
    box('legs',x,y+.33,z,.58,.55,.40),
  ];
  if(['crouch','slide'].includes(motion))return [
    box('head',x,y+1.565,z,.50,.44,.50,true),
    box('torso',x,y+.94,z,.64,.66,.42),
    box('arms',x,y+.95,z,.9,.60,.40),
    box('legs',x,y+.43,z,.58,.42,.40),
  ];
  return [
    box('head',x,y+1.745,z,.50,.48,.50,true),
    box('torso',x,y+1.12,z,.64,.76,.42),
    box('legs',x,y+.37,z,.56,.72,.40),
    box('left arm',x-.40,y+1.12,z,.22,.72,.28),
    box('right arm',x+.40,y+1.12,z,.22,.72,.28),
  ];
}

export function rayAabb(origin,direction,b,maxDistance=Infinity){
  const minX=b.x-b.w/2,maxX=b.x+b.w/2,minY=b.y??0,maxY=(b.y??0)+b.h,minZ=b.z-b.d/2,maxZ=b.z+b.d/2;
  let near=-Infinity,far=Infinity;
  for(const [o,d,min,max] of [[origin.x,direction.x,minX,maxX],[origin.y,direction.y,minY,maxY],[origin.z,direction.z,minZ,maxZ]]){
    if(Math.abs(d)<1e-8){if(o<min||o>max)return null;continue;}
    let a=(min-o)/d,c=(max-o)/d;if(a>c)[a,c]=[c,a];near=Math.max(near,a);far=Math.min(far,c);if(far<near)return null;
  }
  const hit=near>=0?near:far>=0?far:null;
  return hit!==null&&hit<=maxDistance?hit:null;
}

export function tracePlayer(origin,direction,pos,motion='stand',maxDistance=Infinity){
  let best=null,dist=maxDistance;
  for(const hitbox of playerHitboxes(pos,motion)){
    const t=rayAabb(origin,direction,hitbox,dist);
    if(t!==null&&t<dist){dist=t;best={...hitbox,distance:t};}
  }
  return best;
}

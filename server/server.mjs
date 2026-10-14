import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GAME_TYPES, PLAY_MODES, MAPS, WEAPONS, POWERUPS, VEHICLES, normalizeLoadout, allowedWeapon, weaponById, activeLoadoutIds, WORLD_LIMIT } from '../shared/game-data.js';
import { beginReload, clearReload, isReloading } from '../shared/reload-state.js';
import { getStaticBlockers, getSpawnCandidates } from '../shared/map-layout.js';
import { SKIN_PRESETS } from '../src/skin-presets.js';
import { playerHitboxes as sharedPlayerHitboxes, rayAabb } from '../shared/combat-geometry.js';
import { rayGridCells } from '../shared/raycast-grid.js';
import { rewardsForKillStreak } from '../shared/killstreaks.js';

const PORT=Number(process.env.PORT||8787);
const MAX_PLAYERS=Math.max(2,Math.min(16,Number(process.env.ROOM_MAX_PLAYERS||12)));
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const rooms=new Map();const sockets=new Map();
const PROJECT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=()=>Date.now();
const send=(ws,data)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
const broadcast=(room,data,except=null)=>{for(const p of room.players.values())if(p.ws!==except)send(p.ws,data);};
const safeName=s=>String(s||'Player').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,14)||'Player';
const safeColor=s=>/^#[0-9a-f]{6}$/i.test(String(s||''))?s:'#54a8e8';
const validId=(arr,id)=>arr.some(x=>x.id===id);
const codegen=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code='';for(let i=0;i<4;i++)code+=chars[crypto.randomInt(chars.length)];return code;};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const vec=(x,y,z)=>({x,y,z});

function defaultSettings(input={}){
  const gameType=validId(GAME_TYPES,input.gameType)?input.gameType:'tdm';
  const mode=validId(PLAY_MODES,input.mode)?input.mode:'all';
  const map=validId(MAPS,input.map)?input.map:'metro';
  const scoreLimit=[10,15,20,30,50].includes(+input.scoreLimit)?+input.scoreLimit:20;
  const timeLimit=[5,8,10,15,20].includes(+input.timeLimit)?+input.timeLimit:8;
  return {gameType,mode,map,scoreLimit,timeLimit,respawnSeconds:clamp(Number(input.respawnSeconds)||4,2,10),friendlyFire:false};
}
function getTeam(room){if(!GAME_TYPES.find(t=>t.id===room.settings.gameType)?.team)return null;const counts=[0,0];for(const p of room.players.values())if(p.team===0||p.team===1)counts[p.team]++;return counts[0]<=counts[1]?0:1;}
function rebalanceTeams(room){if(!GAME_TYPES.find(t=>t.id===room.settings.gameType)?.team){for(const p of room.players.values())p.team=null;return;}let i=0;for(const p of room.players.values())p.team=(i++%2);}
function publicPlayer(p){return {id:p.id,name:p.name,col:p.col,hat:p.hat,skin:p.skin,skinPreset:p.skinPreset||'vanguard',team:p.team,ready:p.ready,host:p.host,kills:p.kills,deaths:p.deaths,score:p.score,health:p.health,shield:p.shield,alive:p.alive,dead:!p.alive,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,motion:p.motion,motionUntil:p.motionUntil||0,aiming:!!p.aiming,weapon:p.weapon,loadout:p.loadout,carrying:p.carrying,vehicle:p.vehicle||null,killStreak:p.killStreak||0,susiUnlocked:!!p.susiUnlocked,meleeThrown:!!p.meleeThrown,meleeLost:!!p.meleeLost};}
function snapshot(room){return [...room.players.values()].map(publicPlayer);}
function rosterEvent(room){broadcast(room,{type:'lobby',code:room.code,hostId:room.hostId,settings:room.settings,players:snapshot(room),started:room.started});}
function makeRoom(host,settings){let code;do{code=codegen();}while(rooms.has(code));const room={code,hostId:host.id,host,settings:defaultSettings(settings),players:new Map(),started:false,createdAt:now(),startAt:0,endsAt:0,teamScores:[0,0],dom:[],flags:[],drones:new Map(),meleeDrops:new Map(),singularity:null,mapCollision:null,airstrikes:[],lastObjectives:0,lastTick:now(),closed:false};rooms.set(code,room);host.room=room;host.host=true;host.ready=true;host.team=getTeam(room);host.kills=host.deaths=host.score=0;host.health=100;host.shield=0;host.alive=false;host.spawned=false;host.loadout=normalizeLoadout(host.loadout);room.players.set(host.id,host);return room;}
function leaveRoom(client){const room=client.room;if(!room)return;room.players.delete(client.id);client.room=null;if(room.hostId===client.id){broadcast(room,{type:'roomClosed',reason:'The room host disconnected.'});for(const p of room.players.values())p.room=null;room.players.clear();rooms.delete(room.code);return;}if(room.started&&client.carrying)dropFlag(room,client);broadcast(room,{type:'playerLeft',id:client.id});if(room.players.size===0)rooms.delete(room.code);else rosterEvent(room);}

const SPAWNS=[[-106,0,-70,0],[106,0,-70,1],[-106,0,-42,0],[106,0,-42,1],[-106,0,-14,0],[106,0,-14,1],[-106,0,14,0],[106,0,14,1],[-106,0,42,0],[106,0,42,1],[-106,0,70,0],[106,0,70,1]];
const PICKUPS=[{id:'speed',x:-22,y:.55,z:-46,type:0},{id:'damage',x:22,y:.55,z:46,type:1},{id:'regen',x:-66,y:.55,z:0,type:2},{id:'shield',x:66,y:.55,z:0,type:3},{id:'rapid',x:0,y:.55,z:-66,type:4},{id:'jump',x:0,y:.55,z:66,type:5}];
const staticBlockerCache=new Map(),staticIndexCache=new Map();
function blockersFor(room){if(room?.mapCollision?.map===room.settings.map&&Array.isArray(room.mapCollision.boxes))return room.mapCollision.boxes;if(!staticBlockerCache.has(room.settings.map))staticBlockerCache.set(room.settings.map,getStaticBlockers(room.settings.map));return staticBlockerCache.get(room.settings.map);}
function buildBlockerIndex(boxes,cellSize=8){const grid=new Map(),large=[];for(const b of boxes){const minX=Math.floor((b.x-b.w/2)/cellSize),maxX=Math.floor((b.x+b.w/2)/cellSize),minZ=Math.floor((b.z-b.d/2)/cellSize),maxZ=Math.floor((b.z+b.d/2)/cellSize),cells=(maxX-minX+1)*(maxZ-minZ+1);if(cells>160){large.push(b);continue;}for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const k=`${x},${z}`;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(b);}}return {grid,large,cellSize};}
function blockerIndex(room){if(room?.mapCollision?.map===room.settings.map&&Array.isArray(room.mapCollision.boxes)){if(!room.mapCollision.index)room.mapCollision.index=buildBlockerIndex(room.mapCollision.boxes);return room.mapCollision.index;}const map=room.settings.map;if(!staticIndexCache.has(map))staticIndexCache.set(map,buildBlockerIndex(blockersFor(room)));return staticIndexCache.get(map);}
function blockersAlongRay(room,o,d,maxDistance){const index=blockerIndex(room),found=new Set(index.large);for(const [gx,gz] of rayGridCells(o,d,maxDistance,index.cellSize)){for(const b of index.grid.get(`${gx},${gz}`)||[])found.add(b);}return found;}
const rayBox=(o,d,b,max)=>rayAabb(o,d,b,max);
function clearLine(room,o,d,maxDistance){for(const b of blockersAlongRay(room,o,d,maxDistance)){const t=rayBox(o,d,b,maxDistance);if(t!==null&&t<maxDistance)return false;}return true;}
function initMatch(room){room.teamScores=[0,0];const map=MAPS.find(m=>m.id===room.settings.map);const domPoints=map?.objectivePositions?.dom||[{id:'A',x:-42,z:-42},{id:'B',x:0,z:0},{id:'C',x:42,z:42}];const flagPoints=map?.objectivePositions?.ctf||[{id:'blue',team:0,x:-98,z:0},{id:'red',team:1,x:98,z:0}];room.dom=domPoints.map(p=>({...p,owner:null,progress:0,tick:now()}));room.flags=flagPoints.map(f=>({...f,homeX:f.x,homeZ:f.z,carrier:null,returnAt:0}));room.pickupCooldowns={};for(const pickup of PICKUPS)room.pickupCooldowns[pickup.id]=0;room.drones.clear();room.meleeDrops.clear();room.singularity=null;room.airstrikes=[];
  room.startAt=now()+4500;room.endsAt=room.startAt+room.settings.timeLimit*60*1000;room.started=true;room.ended=false;room.lastTick=now();
  for(const p of room.players.values()){p.kills=0;p.deaths=0;p.score=0;p.health=100;p.shield=0;p.alive=false;p.spawned=false;p.carrying=null;p.lastShot=0;p.lastMelee=0;p.lastTrip=0;p.powerups={};p.ammo={};p.reloads={};p.vehicle=null;p.ready=false;p.killStreak=0;p.susiUnlocked=false;p.blackHoleUsed=false;p.meleeThrown=false;p.meleeLost=false;p.meleeDropId=null;}
}
function chooseSpawn(room,p){
  const team=p.team??0;let candidates=(room.settings.gameType==='ffa'?[...getSpawnCandidates(room.settings.map,0),...getSpawnCandidates(room.settings.map,1)]:getSpawnCandidates(room.settings.map,team)).filter(s=>room.settings.gameType==='ffa'||s.team===team);
  const blocked=(s)=>blockersFor(room).some(b=>{const nx=clamp(s.x,b.x-b.w/2,b.x+b.w/2),nz=clamp(s.z,b.z-b.d/2,b.z+b.d/2);return (s.x-nx)**2+(s.z-nz)**2<.82**2&&(b.y??0)<1.8&&(b.y??0)+b.h>.1;});
  candidates=candidates.filter(s=>!blocked(s));
  if(!candidates.length){
    const sides=room.settings.gameType==='ffa'?[-1,1]:[team===1?1:-1];
    for(const side of sides)for(const xMag of [113,112,111,108,104,100,96,92,88])for(let z=-112;z<=112;z+=4){const s={x:side*xMag,y:0,z,team};if(!blocked(s))candidates.push(s);}
  }
  // If a map's normal lanes are obstructed, find any genuinely clear position before deployment.
  if(!candidates.length){for(let x=-112;x<=112;x+=4)for(let z=-112;z<=112;z+=4){const s={x,y:0,z,team};if(!blocked(s)&&(room.settings.gameType==='ffa'||Math.sign(x)===(team===1?1:-1)))candidates.push(s);}}
  const enemies=[...room.players.values()].filter(q=>q.alive&&q.id!==p.id);
  const ranked=candidates.map(s=>({s,score:enemies.reduce((v,e)=>v+1/(2+Math.hypot(e.x-s.x,e.z-s.z)),0)})).sort((a,b)=>a.score-b.score);
  const pick=ranked[Math.floor(Math.random()*Math.min(3,ranked.length))]?.s;if(pick)return {x:pick.x,y:0,z:pick.z};
  // Safer to fail the deployment clearly than place someone inside a wall or building.
  send(p.ws,{type:'error',message:'No safe spawn point was found. Ask the host to rebuild the map.'});return null;
}
function validActiveWeapon(p,weaponId,mode){if(weaponId==='susis_sword')return !!p.susiUnlocked;if(p.meleeThrown&&weaponById(weaponId).kind==='melee')return false;return activeLoadoutIds(p.loadout,mode).includes(weaponId)&&allowedWeapon(weaponById(weaponId),mode);}
function deploy(room,p){if(!room.started||room.ended)return false;if(p.deadAt&&now()-p.deadAt<room.settings.respawnSeconds*1000){send(p.ws,{type:'deployWait',remaining:Math.ceil((room.settings.respawnSeconds*1000-(now()-p.deadAt))/1000)});return false;}if(p.meleeDropId){const oldDrop=room.meleeDrops.get(p.meleeDropId);if(oldDrop){room.meleeDrops.delete(oldDrop.id);broadcast(room,{type:'meleeDropRemoved',id:oldDrop.id});}}p.meleeThrown=false;p.meleeLost=false;p.meleeDropId=null;const spawn=chooseSpawn(room,p);if(!spawn)return false;p.x=spawn.x;p.y=spawn.y;p.z=spawn.z;p.vx=0;p.vz=0;p.yaw=Math.atan2(p.x,p.z);p.pitch=0;p.health=100;p.shield=0;p.powerups={};p.stunnedUntil=0;p.reloadUntil=0;p.reloadWeapon=null;p.alive=true;p.spawned=true;p.motion='stand';p.motionUntil=0;p.carrying=null;p.ammo={};p.reserve={};for(const id of activeLoadoutIds(p.loadout,room.settings.mode)){const w=weaponById(id);if(w.kind==='gun'){p.ammo[id]=w.mag;p.reserve[id]=w.reserve;}}p.deadAt=0;
  p.weapon=validActiveWeapon(p,p.weapon,room.settings.mode)?p.weapon:(activeLoadoutIds(p.loadout,room.settings.mode)[0]||p.loadout.melee);p.reloads={};p.vehicle=null;p.lastStateAt=now();broadcast(room,{type:'playerSpawn',id:p.id,spawn,health:p.health,weapon:p.weapon,loadout:p.loadout,team:p.team,vehicle:null});send(p.ws,{type:'deployed',spawn,health:p.health,shield:p.shield,weapon:p.weapon,loadout:p.loadout,team:p.team});return true;}
function scoreboard(room){return {teams:room.teamScores,players:snapshot(room).sort((a,b)=>b.score-a.score||b.kills-a.kills),gameType:room.settings.gameType,mode:room.settings.mode,endsAt:room.endsAt,startAt:room.startAt};}
function objectiveSnapshot(room){return {dom:room.dom.map(p=>({id:p.id,owner:p.owner,progress:Math.round(p.progress),x:p.x,z:p.z})),flags:room.flags.map(f=>({id:f.id,team:f.team,x:f.x,z:f.z,carrier:f.carrier,returnAt:f.returnAt})),teamScores:room.teamScores};}
function playerHitboxes(p){return sharedPlayerHitboxes(p,p.motion||'stand');}

function deterministicUnit(seed){const v=Math.sin(seed*12.9898+78.233)*43758.5453;return v-Math.floor(v);}
function scatterDirection(base,spread,seed){
  const ref=Math.abs(base.y)<.9?vec(0,1,0):vec(1,0,0);let rx=base.y*ref.z-base.z*ref.y,ry=base.z*ref.x-base.x*ref.z,rz=base.x*ref.y-base.y*ref.x;const rl=Math.hypot(rx,ry,rz)||1;rx/=rl;ry/=rl;rz/=rl;
  const ux=ry*base.z-rz*base.y,uy=rz*base.x-rx*base.z,uz=rx*base.y-ry*base.x;
  const a=(deterministicUnit(seed)-.5)*2*spread,b=(deterministicUnit(seed+991)-.5)*2*spread;
  const out=vec(base.x+rx*a+ux*b,base.y+ry*a+uy*b,base.z+rz*a+uz*b),len=Math.hypot(out.x,out.y,out.z)||1;return vec(out.x/len,out.y/len,out.z/len);
}
function enemyOf(room,a,b){return room.settings.gameType==='ffa'||a.team!==b.team;}
function droneReward(room,p){
  const id=`eye-${p.id}-${now()}`,drone={id,owner:p.id,x:p.x,y:p.y+3.4,z:p.z,expiresAt:now()+15000,nextFire:now()+650,phase:0};room.drones.set(id,drone);
  send(p.ws,{type:'killStreakReward',id:p.id,reward:'drone',streak:p.killStreak});broadcast(room,{type:'droneSpawn',drone:{id,owner:p.id,x:drone.x,y:drone.y,z:drone.z,expiresAt:drone.expiresAt}});
}
function triggerAirstrike(room,p){
  const x=clamp(p.x-Math.sin(p.yaw)*18,-WORLD_LIMIT+4,WORLD_LIMIT-4),z=clamp(p.z-Math.cos(p.yaw)*18,-WORLD_LIMIT+4,WORLD_LIMIT-4);
  room.airstrikes.push({owner:p.id,x,z,impactAt:now()+1750,expiresAt:now()+2500});broadcast(room,{type:'ssStrike',by:p.id,x,z,duration:2300});
  send(p.ws,{type:'killStreakReward',id:p.id,reward:'ss-strike',streak:p.killStreak});
}
function processAirstrikes(room,t){
  for(let i=room.airstrikes.length-1;i>=0;i--){const strike=room.airstrikes[i],owner=room.players.get(strike.owner);if(!strike.impacted&&t>=strike.impactAt){strike.impacted=true;broadcast(room,{type:'ssStrikeImpact',by:strike.owner,x:strike.x,z:strike.z});if(owner)for(const target of room.players.values())if(target.alive&&enemyOf(room,owner,target)){const dist=Math.hypot(target.x-strike.x,target.z-strike.z);if(dist<=14){const damage=75*Math.max(.25,1-dist/18);applyDamage(room,target,owner,damage,false);}}}if(t>=strike.expiresAt)room.airstrikes.splice(i,1);}
}
function processDrones(room,t){
  for(const [id,d] of room.drones){const owner=room.players.get(d.owner);if(!owner||!owner.alive||t>=d.expiresAt){room.drones.delete(id);broadcast(room,{type:'droneEnd',id});continue;}
    d.phase+=.12;d.x=owner.x+Math.cos(d.phase)*1.5;d.y=owner.y+3.3+Math.sin(d.phase*1.5)*.22;d.z=owner.z+Math.sin(d.phase)*1.5;
    if(t>=d.nextFire){d.nextFire=t+720;const origin=vec(d.x,d.y,d.z);let target=null,best=44;
      for(const q of room.players.values()){if(!q.alive||!enemyOf(room,owner,q))continue;const dist=Math.hypot(q.x-d.x,q.z-d.z);if(dist>best)continue;const dir=vec(q.x-d.x,q.y+1-d.y,q.z-d.z),len=Math.hypot(dir.x,dir.y,dir.z)||1;dir.x/=len;dir.y/=len;dir.z/=len;if(!clearLine(room,origin,dir,dist)){continue;}target=q;best=dist;}
      if(target){broadcast(room,{type:'paintShot',drone:id,from:[origin.x,origin.y,origin.z],to:[target.x,target.y+1,target.z]});applyDamage(room,target,owner,7,false);broadcast(room,{type:'paintHit',drone:id,to:target.id,x:target.x,y:target.y+1,z:target.z});}
    }
  }
  if(t-(room.lastDroneBroadcast||0)>260&&room.drones.size){room.lastDroneBroadcast=t;broadcast(room,{type:'droneState',drones:[...room.drones.values()].map(({id,owner,x,y,z,expiresAt})=>({id,owner,x,y,z,expiresAt}))});}
}
function processMeleeDrops(room,t,dt){
  for(const [id,d] of room.meleeDrops){if(t>=d.expiresAt){room.meleeDrops.delete(id);const owner=room.players.get(d.owner);if(owner){owner.meleeLost=true;owner.meleeThrown=true;owner.meleeDropId=null;send(owner.ws,{type:'meleeLost',id:d.owner,dropId:id,weapon:d.weapon});}broadcast(room,{type:'meleeDropRemoved',id});continue;}
    d.vy-=9.8*dt;const nx=clamp(d.x+d.vx*dt,-WORLD_LIMIT+1,WORLD_LIMIT-1),nz=clamp(d.z+d.vz*dt,-WORLD_LIMIT+1,WORLD_LIMIT-1),ny=d.y+d.vy*dt;
    const blockers=room.mapCollision?.boxes||getStaticBlockers(room.settings.map);const blocked=(x,y,z)=>blockers.some(b=>x+.12>b.x-b.w/2&&x-.12<b.x+b.w/2&&z+.12>b.z-b.d/2&&z-.12<b.z+b.d/2&&y+.12>b.y&&y-.12<b.y+b.h);
    if(blocked(nx,Math.max(.12,ny),nz)){d.vx*=-.18;d.vz*=-.18;d.vy=Math.max(0,d.vy*.35);}else{d.x=nx;d.z=nz;d.y=ny;}
    if(d.y<.12){d.y=.12;d.vy=0;d.vx*=.58;d.vz*=.58;}
  }
  if(t-(room.lastMeleeDropBroadcast||0)>180&&room.meleeDrops.size){room.lastMeleeDropBroadcast=t;broadcast(room,{type:'meleeDropState',drops:[...room.meleeDrops.values()].map(({id,owner,weapon,x,y,z})=>({id,owner,weapon,x,y,z}))});}
}
function processSingularity(room,t){
  const s=room.singularity;if(!s)return;if(!s.burst&&t>=s.burstAt){s.burst=true;const owner=room.players.get(s.owner);broadcast(room,{type:'blackHoleBurst',id:s.owner,x:s.x,z:s.z});for(const target of room.players.values()){if(!target.alive||!owner||!enemyOf(room,owner,target))continue;const dist=Math.hypot(target.x-s.x,target.z-s.z);if(dist<19){const damage=105*Math.max(.25,1-dist/24);applyDamage(room,target,owner,damage,false);}}}
  if(t>=s.expiresAt){broadcast(room,{type:'blackHoleEnd',id:s.owner});room.singularity=null;}
}
function triggerBlackHole(room,p){
  if(!p.alive||!p.susiUnlocked||p.blackHoleUsed||room.singularity||!room.started||room.ended)return;p.blackHoleUsed=true;
  const x=clamp(p.x-Math.sin(p.yaw)*12,-WORLD_LIMIT+5,WORLD_LIMIT-5),z=clamp(p.z-Math.cos(p.yaw)*12,-WORLD_LIMIT+5,WORLD_LIMIT-5),t=now();room.singularity={owner:p.id,x,z,startedAt:t,burstAt:t+2350,expiresAt:t+6100,burst:false};broadcast(room,{type:'blackHole',id:p.id,x,z,duration:6100});
}
function killScore(room,killer,victim){
  // Every death ends the victim's streak, even deaths attributed to the world or a suicide.
  victim.killStreak=0;
  if(!killer||killer.id===victim.id)return;
  killer.kills++;killer.score++;killer.killStreak=(killer.killStreak||0)+1;
  for(const reward of rewardsForKillStreak(killer.killStreak)){
    if(reward==='drone')droneReward(room,killer);
    else if(reward==='ss-strike')triggerAirstrike(room,killer);
    else if(reward==='susi-sword'){killer.susiUnlocked=true;killer.weapon='susis_sword';broadcast(room,{type:'weaponChanged',id:killer.id,weapon:'susis_sword'});send(killer.ws,{type:'killStreakReward',id:killer.id,reward:'susi-sword',streak:killer.killStreak});}
  }
  if(room.settings.gameType==='ffa'||room.settings.gameType==='ctf')return;
  const team=killer.team;if(team===0||team===1){if(room.settings.gameType==='tdm'||room.settings.gameType==='dom')room.teamScores[team]++;}
}
function dropFlag(room,p){if(!p.carrying)return;const f=room.flags.find(x=>x.id===p.carrying);if(f){f.x=p.x;f.z=p.z;f.carrier=null;f.returnAt=now()+15000;}p.carrying=null;}
function applyDamage(room,target,attacker,amount,head=false){if(!target.alive||target.health<=0)return;let dmg=Math.max(0,Math.min(160,amount));if(target.shield>0){const absorbed=Math.min(target.shield,dmg);target.shield-=absorbed;dmg-=absorbed;}target.health=Math.max(0,target.health-dmg);broadcast(room,{type:'damage',to:target.id,from:attacker?.id||null,amount:Math.round(amount),health:target.health,shield:target.shield,head});
  if(target.health<=0){
    target.alive=false;target.deadAt=now();target.deaths++;
    if(target.meleeDropId){const dropped=room.meleeDrops.get(target.meleeDropId);if(dropped){room.meleeDrops.delete(dropped.id);broadcast(room,{type:'meleeDropRemoved',id:dropped.id});}}
    target.meleeDropId=null;target.meleeThrown=false;target.meleeLost=false;
    dropFlag(room,target);target.killStreak=0;if(attacker)killScore(room,attacker,target);broadcast(room,{type:'playerDied',id:target.id,by:attacker?.id||null,stats:scoreboard(room),objectives:objectiveSnapshot(room)});checkWin(room);
  }
}
function checkWin(room){if(room.ended)return;let winner=null,reason='score';if(room.settings.gameType==='ffa'){
    const best=[...room.players.values()].sort((a,b)=>b.score-a.score)[0];if(best&&best.score>=room.settings.scoreLimit)winner={id:best.id,name:best.name,team:null,score:best.score};
  }else if(Math.max(...room.teamScores)>=room.settings.scoreLimit){const team=room.teamScores[0]===room.teamScores[1]?null:room.teamScores[0]>room.teamScores[1]?0:1;if(team!==null)winner={team,score:room.teamScores[team]};}
  if(!winner&&now()>=room.endsAt){reason='time';if(room.settings.gameType==='ffa'){const p=[...room.players.values()].sort((a,b)=>b.score-a.score)[0];if(p)winner={id:p.id,name:p.name,score:p.score,team:null};}else {const team=room.teamScores[0]===room.teamScores[1]?null:room.teamScores[0]>room.teamScores[1]?0:1;if(team!==null)winner={team,score:room.teamScores[team]};}}
  if(winner||reason==='time'&&now()>=room.endsAt){room.ended=true;room.started=false;broadcast(room,{type:'matchEnd',winner,reason,stats:scoreboard(room)});}
}
function shot(room,p,msg){
  if(!room.started||room.ended||!p.alive||now()<room.startAt||p.stunnedUntil>now())return;
  const id=String(msg.weapon||'');if(id!==p.weapon||!validActiveWeapon(p,id,room.settings.mode))return;
  const w=weaponById(id);if(w.kind!=='gun')return;const speed=p.powerups?.rapid>now()?.55:1;
  if(isReloading(p.reloads,id,now()))return;if(now()-p.lastShot<w.fireMs*speed*.88)return;if((p.ammo[id]??w.mag)<=0){send(p.ws,{type:'empty',weapon:id});return;}
  let base=Array.isArray(msg.dir)&&msg.dir.length===3?vec(+msg.dir[0],+msg.dir[1],+msg.dir[2]):null;if(!base||![base.x,base.y,base.z].every(Number.isFinite))return;
  const len=Math.hypot(base.x,base.y,base.z);if(len<.8||len>1.2)return;base=vec(base.x/len,base.y/len,base.z/len);
  const expected=vec(-Math.sin(p.yaw)*Math.cos(p.pitch),Math.sin(p.pitch),-Math.cos(p.yaw)*Math.cos(p.pitch));const dot=base.x*expected.x+base.y*expected.y+base.z*expected.z;
  // State and firing packets travel separately. A moderate cone tolerates normal latency/flicks while rejecting backwards/forged aim vectors.
  if(dot<.32)return;
  p.lastShot=now();p.shotSequence=(p.shotSequence||0)+1;p.ammo[id]=(p.ammo[id]??w.mag)-1;
  const eye=p.motion==='crawl'?.72:(p.motion==='crouch'||p.motion==='slide')?1.12:1.62,origin=vec(p.x,p.y+eye,p.z),pellets=Math.max(1,Math.min(16,Number(w.pellets)||1));
  const damageByTarget=new Map(),rays=[];let anyHit=false;
  for(let pellet=0;pellet<pellets;pellet++){
    const d=scatterDirection(base,w.spread||0,(p.shotSequence*37)+(p.id.length*71)+(pellet*101));let wallDistance=w.range;
    for(const b of blockersAlongRay(room,origin,d,w.range)){const t=rayBox(origin,d,b,wallDistance);if(t!==null&&t<wallDistance)wallDistance=t;}
    let nearest=wallDistance,hit=null;
    for(const target of room.players.values()){
      if(target.id===p.id||!target.alive)continue;
      for(const box of playerHitboxes(target)){
        const t=rayBox(origin,d,box,nearest);if(t!==null&&t<nearest){nearest=t;hit={target,head:!!box.head,part:box.part};}
      }
    }
    if(hit){anyHit=true;if(!(hit.target.team===p.team&&room.settings.gameType!=='ffa'&&!room.settings.friendlyFire)){
      const amount=(w.damage/pellets)*(hit.head?1.35:1)*(p.powerups?.damage>now()?1.6:1);const key=hit.target.id,prev=damageByTarget.get(key)||{target:hit.target,amount:0,head:false};prev.amount+=amount;prev.head=prev.head||hit.head;damageByTarget.set(key,prev);
    }}
    if(rays.length<5)rays.push({direction:[d.x,d.y,d.z],range:nearest});
  }
  broadcast(room,{type:'shotFX',id:p.id,weapon:id,origin:[origin.x,origin.y,origin.z],direction:[base.x,base.y,base.z],range:w.range,color:w.color,rays});
  for(const hit of damageByTarget.values()){
    applyDamage(room,hit.target,p,hit.amount,hit.head);
    send(p.ws,{type:'hitmarker',kind:hit.head?'head':'normal',target:hit.target.id,damage:Math.round(hit.amount)});
  }
  if(anyHit&&!damageByTarget.size)send(p.ws,{type:'hitmarker',kind:'blocked'});
  send(p.ws,{type:'ammo',weapon:id,ammo:p.ammo[id],reserve:p.reserve?.[id]});
}
function melee(room,p,msg){
  if(!room.started||room.ended||!p.alive||now()<room.startAt||p.stunnedUntil>now())return;
  const id=String(msg.weapon||p.weapon);if(p.meleeThrown||id!==p.weapon||!validActiveWeapon(p,id,room.settings.mode))return;const w=weaponById(id);if(w.kind!=='melee')return;
  if(now()-p.lastMelee<w.fireMs*.88)return;p.lastMelee=now();
  const dir=Array.isArray(msg.dir)&&msg.dir.length===3?vec(+msg.dir[0],+msg.dir[1],+msg.dir[2]):vec(-Math.sin(p.yaw),0,-Math.cos(p.yaw));if(![dir.x,dir.y,dir.z].every(Number.isFinite))return;const l=Math.hypot(dir.x,dir.y,dir.z)||1;dir.x/=l;dir.y/=l;dir.z/=l;
  const facing=vec(-Math.sin(p.yaw),0,-Math.cos(p.yaw));if(dir.x*facing.x+dir.z*facing.z<.68)return;
  const origin=vec(p.x,p.y+1.15,p.z);let targetHit=null,distBest=w.range;
  for(const q of room.players.values()){
    if(q.id===p.id||!q.alive)continue;const dx=q.x-p.x,dz=q.z-p.z,dist=Math.hypot(dx,dz);if(dist>w.range||Math.abs((q.y+1)-(p.y+1.15))>1.35||dist<.01)continue;
    const dot=(dx/dist)*dir.x+(dz/dist)*dir.z;if(dot<.25||!clearLine(room,origin,vec(dx/dist,((q.y+1)-(p.y+1.15))/Math.max(.01,dist),dz/dist),dist))continue;if(dist<distBest){distBest=dist;targetHit=q;}}
  broadcast(room,{type:'meleeFX',id:p.id,weapon:id,hit:targetHit?.id||null});
  if(targetHit){if(targetHit.team===p.team&&room.settings.gameType!=='ffa'&&!room.settings.friendlyFire)return;applyDamage(room,targetHit,p,w.damage,false);send(p.ws,{type:'hitmarker',kind:'melee'});}
}
function trip(room,p){if(!room.started||room.ended||!p.alive||now()<room.startAt||p.stunnedUntil>now()||now()-p.lastTrip<4200)return;p.lastTrip=now();const dir=vec(-Math.sin(p.yaw),0,-Math.cos(p.yaw));let hit=null,distBest=2.15;for(const q of room.players.values()){if(q.id===p.id||!q.alive)continue;const dx=q.x-p.x,dz=q.z-p.z,dist=Math.hypot(dx,dz);if(dist>2.15||Math.abs(q.y-p.y)>.65||dist<.01)continue;if(q.team===p.team&&room.settings.gameType!=='ffa'&&!room.settings.friendlyFire)continue;const dot=(dx/dist)*dir.x+(dz/dist)*dir.z;if(dot<.55||!clearLine(room,vec(p.x,p.y+1.05,p.z),vec(dx/dist,0,dz/dist),dist))continue;if(dist<distBest){distBest=dist;hit=q;}}
  broadcast(room,{type:'tripFX',id:p.id,hit:hit?.id||null});if(hit){hit.stunnedUntil=now()+1150;hit.motion='stunned';applyDamage(room,hit,p,10,false);broadcast(room,{type:'stun',id:hit.id,duration:1150,by:p.id});}}
function processObjectives(room,delta){
  if(!room.started||now()<room.startAt||room.ended)return;
  if(room.settings.gameType==='dom'){
    for(const point of room.dom){let count=[0,0];for(const p of room.players.values())if(p.alive&&p.team!==null&&Math.hypot(p.x-point.x,p.z-point.z)<8.5)count[p.team]++;
      if(count[0]!==count[1]){const side=count[0]>count[1]?0:1;point.progress=clamp(point.progress+(side===0?1:-1)*delta*22,-100,100);if(point.progress===100||point.progress===-100)point.owner=point.progress===100?0:1;else if(point.owner===0&&point.progress<10)point.owner=null;else if(point.owner===1&&point.progress>-10)point.owner=null;}
      if(point.owner!==null&&now()-point.tick>=3000){room.teamScores[point.owner]++;point.tick=now();checkWin(room);}
    }
  }
  if(room.settings.gameType==='ctf'){
    for(const flag of room.flags){
      if(flag.carrier){const carrier=room.players.get(flag.carrier);if(!carrier||!carrier.alive){if(carrier)dropFlag(room,carrier);else{flag.carrier=null;flag.returnAt=now()+15000;}}else{flag.x=carrier.x;flag.z=carrier.z;const home=room.flags.find(f=>f.team===carrier.team);if(home&&Math.hypot(carrier.x-home.homeX,carrier.z-home.homeZ)<4.3&&home.carrier===null&&Math.hypot(home.x-home.homeX,home.z-homeZ)<1.0){room.teamScores[carrier.team]+=5;carrier.score+=5;const taken=flag;carrier.carrying=null;taken.carrier=null;taken.x=taken.homeX;taken.z=taken.homeZ;taken.returnAt=0;checkWin(room);}}}
      if(flag.carrier===null){if(flag.returnAt&&now()>=flag.returnAt){flag.x=flag.homeX;flag.z=flag.homeZ;flag.returnAt=0;}for(const p of room.players.values()){if(!p.alive||p.team===flag.team||p.carrying)continue;if(Math.hypot(p.x-flag.x,p.z-flag.z)<2.5){flag.carrier=p.id;p.carrying=flag.id;flag.returnAt=0;break;}}}
    }
  }
  if(now()-room.lastObjectives>420){room.lastObjectives=now();broadcast(room,{type:'objectives',objectives:objectiveSnapshot(room),stats:scoreboard(room)});}
}
function collectPickup(room,p,id){if(!room.started||!p.alive)return;const q=PICKUPS.find(x=>x.id===id);if(!q||Math.hypot(p.x-q.x,p.z-q.z)>3.0||room.pickupCooldowns[id]>now())return;const power=POWERUPS.find(x=>x.id===id);if(!power)return;room.pickupCooldowns[id]=now()+20000;if(id==='shield')p.shield=Math.min(100,p.shield+50);else p.powerups[id]=now()+power.duration;broadcast(room,{type:'powerup',id:p.id,power:id,expires:p.powerups[id]||0,shield:p.shield});}
function handle(client,msg){
  if(!msg||typeof msg!=='object'||typeof msg.type!=='string')return;
  if(msg.type==='create'){
    leaveRoom(client);client.name=safeName(msg.name);client.col=safeColor(msg.col);client.hat=clamp(+msg.hat||0,0,4);client.skin=typeof msg.skin==='string'&&msg.skin.startsWith('data:image/png')&&msg.skin.length<500000?msg.skin:'';client.skinPreset=SKIN_PRESETS.some(v=>v.id===msg.skinPreset)?msg.skinPreset:'vanguard';client.selectedVehicle=VEHICLES.some(v=>v.id===msg.vehicle)?msg.vehicle:'atlas-cycle';client.vehicle=null;client.reloads={};client.killStreak=0;client.susiUnlocked=false;client.meleeThrown=false;client.meleeLost=false;client.loadout=normalizeLoadout(msg.loadout);
    const room=makeRoom(client,msg.settings);client.team=GAME_TYPES.find(t=>t.id===room.settings.gameType)?.team?0:null;send(client.ws,{type:'created',code:room.code,role:'host',hostId:room.hostId,self:publicPlayer(client),players:snapshot(room),settings:room.settings});rosterEvent(room);return;
  }
  if(msg.type==='join'){
    leaveRoom(client);const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4),room=rooms.get(code);if(!room){send(client.ws,{type:'error',message:'Room not found. Check the four-character code.'});return;}if(room.started){send(client.ws,{type:'error',message:'That match has already started. Join a waiting lobby.'});return;}if(room.players.size>=MAX_PLAYERS){send(client.ws,{type:'error',message:'Room is full.'});return;}
    client.name=safeName(msg.name);client.col=safeColor(msg.col);client.hat=clamp(+msg.hat||0,0,4);client.skin=typeof msg.skin==='string'&&msg.skin.startsWith('data:image/png')&&msg.skin.length<500000?msg.skin:'';client.skinPreset=SKIN_PRESETS.some(v=>v.id===msg.skinPreset)?msg.skinPreset:'vanguard';client.selectedVehicle=VEHICLES.some(v=>v.id===msg.vehicle)?msg.vehicle:'atlas-cycle';client.vehicle=null;client.reloads={};client.killStreak=0;client.susiUnlocked=false;client.meleeThrown=false;client.meleeLost=false;client.loadout=normalizeLoadout(msg.loadout);client.team=getTeam(room);client.ready=false;client.host=false;client.kills=client.deaths=client.score=0;client.health=100;client.shield=0;client.alive=false;client.spawned=false;client.x=0;client.y=0;client.z=0;client.vehicle=null;client.reloads={};client.weapon=activeLoadoutIds(client.loadout,room.settings.mode)[0]||client.loadout.melee;room.players.set(client.id,client);client.room=room;
    send(client.ws,{type:'joined',code,role:'player',hostId:room.hostId,self:publicPlayer(client),players:snapshot(room),settings:room.settings});broadcast(room,{type:'playerJoined',player:publicPlayer(client)},client.ws);rosterEvent(room);return;
  }
  const room=client.room;if(!room){if(msg.type!=='ping')send(client.ws,{type:'error',message:'Create or join a room first.'});return;}
  switch(msg.type){
    case 'vehicleChoice': {if(!room.started&&VEHICLES.some(v=>v.id===msg.vehicle)){client.selectedVehicle=msg.vehicle;send(client.ws,{type:'vehicleChoice',vehicle:client.selectedVehicle});}break;}
    case 'ready': if(!room.started){client.ready=!!msg.ready;rosterEvent(room);}break;
    case 'switchTeam': {if(!room.started||room.ended||!client.alive||!GAME_TYPES.find(t=>t.id===room.settings.gameType)?.team){send(client.ws,{type:'error',message:'Team switching is available while alive in a team-based match.'});break;}if(client.carrying)dropFlag(room,client);client.team=client.team===0?1:0;broadcast(room,{type:'teamChanged',id:client.id,team:client.team,players:snapshot(room)});break;}
    case 'settings': if(!room.started&&client.id===room.hostId){room.settings=defaultSettings(msg.settings);rebalanceTeams(room);broadcast(room,{type:'settingsUpdated',settings:room.settings});rosterEvent(room);}break;
    case 'loadout': {
      if(room.started&&client.alive)return;client.loadout=normalizeLoadout(msg.loadout);if(!validActiveWeapon(client,client.weapon,room.settings.mode))client.weapon=activeLoadoutIds(client.loadout,room.settings.mode)[0]||client.loadout.melee;broadcast(room,{type:'loadoutUpdated',id:client.id,loadout:client.loadout});break;
    }
    case 'start': {
      if(client.id!==room.hostId||room.started)return;
      const unready=[...room.players.values()].filter(p=>p.id!==room.hostId&&!p.ready);if(unready.length){send(client.ws,{type:'error',message:`Waiting for ${unready.length} player(s) to ready up.`});return;}
      initMatch(room);broadcast(room,{type:'matchStart',settings:room.settings,startAt:room.startAt,endsAt:room.endsAt,players:snapshot(room),objectives:objectiveSnapshot(room)});break;
    }
    case 'leave': leaveRoom(client);break;
    case 'mapColliders': {
      if(!room||client.id!==room.hostId||!validId(MAPS,String(msg.map||''))||!Array.isArray(msg.colliders))break;
      const boxes=msg.colliders.slice(0,3500).map(b=>({x:Number(b.x),y:Number(b.y),z:Number(b.z),w:Number(b.w),h:Number(b.h),d:Number(b.d)})).filter(b=>[b.x,b.y,b.z,b.w,b.h,b.d].every(Number.isFinite)&&Math.abs(b.x)<=130&&Math.abs(b.y)<=45&&Math.abs(b.z)<=130&&b.w>0&&b.w<=260&&b.h>0&&b.h<=60&&b.d>0&&b.d<=260);
      if(boxes.length>=60)room.mapCollision={map:msg.map,boxes,index:buildBlockerIndex(boxes)};
      break;
    }
    case 'equip': {
      if(room.started&&client.alive)return;const id=String(msg.weapon||'');if(validActiveWeapon(client,id,room.settings.mode)){client.weapon=id;broadcast(room,{type:'weaponChanged',id:client.id,weapon:id});}break;
    }
    case 'deploy': if(room.started&&!room.ended){if(msg.loadout)client.loadout=normalizeLoadout(msg.loadout);deploy(room,client);}break;
    case 'selectWeapon': {const id=String(msg.weapon||'');if(client.alive&&validActiveWeapon(client,id,room.settings.mode)){client.weapon=id;broadcast(room,{type:'weaponChanged',id:client.id,weapon:id});}break;}
    case 'state': {
      if(!room.started||room.ended)return;const t=now(),elapsed=Math.max(.02,Math.min(.5,(t-(client.lastStateAt||t-80))/1000));
      const nx=clamp(Number(msg.x)||0,-WORLD_LIMIT,WORLD_LIMIT),ny=clamp(Number(msg.y)||0,0,25),nz=clamp(Number(msg.z)||0,-WORLD_LIMIT,WORLD_LIMIT);
      const requestedVehicle=client.alive&&msg.vehicle===client.selectedVehicle&&VEHICLES.some(v=>v.id===msg.vehicle)?client.selectedVehicle:null;const vehicleSpec=VEHICLES.find(v=>v.id===requestedVehicle);if(client.alive){const delta=Math.hypot(nx-client.x,nz-client.z),allowed=((vehicleSpec?.speed)||12.9)*elapsed+1.2;if(client.spawned&&delta>allowed){return;}}
      client.x=nx;client.y=ny;client.z=nz;client.vehicle=requestedVehicle;client.yaw=Number.isFinite(+msg.yaw)?+msg.yaw:client.yaw||0;client.pitch=clamp(Number(msg.pitch)||0,-1.5,1.5);let nextMotion=['stand','sprint','crouch','slide','crawl','backflip','trip','stunned'].includes(msg.motion)?msg.motion:'stand';if(client.stunnedUntil>t)nextMotion='stunned';if(nextMotion!==client.motion){const durations={backflip:950,trip:650,slide:760,stunned:1150};client.motionUntil=nextMotion==='stunned'?client.stunnedUntil:(durations[nextMotion]?t+durations[nextMotion]:0);}client.motion=nextMotion;client.aiming=!!msg.aiming;
      const weapon=String(msg.weapon||client.weapon);if(validActiveWeapon(client,weapon,room.settings.mode))client.weapon=weapon;client.lastStateAt=t;broadcast(room,{type:'playerState',player:publicPlayer(client)},client.ws);break;
    }
    case 'fire': shot(room,client,msg);break;
    case 'melee': melee(room,client,msg);break;
    case 'trip': trip(room,client);break;
    case 'throwMelee': {
      if(!room.started||room.ended||!client.alive||client.meleeThrown||now()<room.startAt)return;const wid=client.weapon,w=weaponById(wid);if(w.kind!=='melee'||!validActiveWeapon(client,wid,room.settings.mode))return;
      const id=`drop-${client.id}-${now()}`,cp=Math.cos(client.pitch),dir=vec(-Math.sin(client.yaw)*cp,Math.sin(client.pitch),-Math.cos(client.yaw)*cp);const drop={id,owner:client.id,weapon:wid,x:client.x+dir.x*.8,y:client.y+1.05,z:client.z+dir.z*.8,vx:dir.x*10.5,vy:dir.y*10.5+2.4,vz:dir.z*10.5,expiresAt:now()+18000};room.meleeDrops.set(id,drop);client.meleeThrown=true;client.meleeDropId=id;broadcast(room,{type:'meleeDropped',drop:{id,owner:client.id,weapon:wid,x:drop.x,y:drop.y,z:drop.z,expiresAt:drop.expiresAt}});send(client.ws,{type:'meleeThrown',dropId:id,weapon:wid,expiresAt:drop.expiresAt});break;
    }
    case 'pickupMelee': {
      if(!room.started||!client.alive||!client.meleeThrown||!client.meleeDropId)return;const d=room.meleeDrops.get(client.meleeDropId);if(!d||d.owner!==client.id||Math.hypot(client.x-d.x,client.z-d.z)>3.0)return;
      room.meleeDrops.delete(d.id);client.meleeThrown=false;client.meleeLost=false;client.meleeDropId=null;client.weapon=d.weapon;broadcast(room,{type:'meleePicked',id:client.id,dropId:d.id,weapon:d.weapon});broadcast(room,{type:'meleeDropRemoved',id:d.id});broadcast(room,{type:'weaponChanged',id:client.id,weapon:d.weapon});break;
    }
    case 'blackhole': triggerBlackHole(room,client);break;
    case 'reload': {
      if(!client.alive)return;const requested=String(msg.weapon||client.weapon);if(requested!==client.weapon)return;const w=weaponById(requested);if(w.kind!=='gun'||!validActiveWeapon(client,w.id,room.settings.mode)||isReloading(client.reloads,w.id,now()))return;const reserve=client.reserve?.[w.id]??w.reserve;if((client.ammo[w.id]??w.mag)>=w.mag||reserve<=0)return;
      client.reloads=client.reloads||{};beginReload(client.reloads,w.id,now()+w.reloadMs);send(client.ws,{type:'reloadStarted',weapon:w.id,endsAt:client.reloads[w.id]});break;
    }
    case 'pickup': collectPickup(room,client,String(msg.id));break;
    case 'ping': send(client.ws,{type:'pong',at:msg.at});break;
    case 'requestState': send(client.ws,{type:'lobby',code:room.code,hostId:room.hostId,settings:room.settings,players:snapshot(room),started:room.started});break;
  }
}

const DIST_ROOT=path.resolve(PROJECT_ROOT,'dist');
const MIME_TYPES={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif',
  '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm',
};
function sendText(res,status,text,type='text/plain; charset=utf-8'){
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(text);
}
const httpServer=http.createServer((req,res)=>{
  const method=req.method||'GET';
  if(method!=='GET'&&method!=='HEAD'){sendText(res,405,'Method not allowed');return;}
  const rawPath=String(req.url||'/').split('?')[0];
  let rawDecoded;try{rawDecoded=decodeURIComponent(rawPath);}catch{sendText(res,400,'Bad URL');return;}
  if(rawDecoded.split(/[\\/]/).some(part=>part==='..')){sendText(res,403,'Forbidden');return;}
  let url;try{url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);}catch{sendText(res,400,'Bad request');return;}
  if(url.pathname==='/health'){
    sendText(res,200,JSON.stringify({service:'VineBoom',status:'ok',rooms:rooms.size,players:sockets.size,maxPlayers:MAX_PLAYERS,websocket:'/ws',frontend:fs.existsSync(path.join(DIST_ROOT,'index.html'))?'ready':'not-built'}),'application/json; charset=utf-8');return;
  }
  // A single production process serves the built browser game and its WebSocket rooms.
  if(!fs.existsSync(path.join(DIST_ROOT,'index.html'))){
    sendText(res,503,'VineBoom is not built yet. Run "npm start" (which builds the game) or run "npm run build" before starting the server.');return;
  }
  let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{sendText(res,400,'Bad URL');return;}
  const relative=decoded==='/'?'index.html':decoded.replace(/^\/+/, '');
  let filename=path.resolve(DIST_ROOT,relative);
  const rel=path.relative(DIST_ROOT,filename);
  if(rel.startsWith('..')||path.isAbsolute(rel)){sendText(res,403,'Forbidden');return;}
  let stat;
  try{stat=fs.statSync(filename);if(!stat.isFile())throw new Error('not a file');}
  catch{
    if(!path.extname(relative)||relative.endsWith('/')){filename=path.join(DIST_ROOT,'index.html');try{stat=fs.statSync(filename);}catch{sendText(res,404,'Not found');return;}}
    else {sendText(res,404,'Not found');return;}
  }
  const type=MIME_TYPES[path.extname(filename).toLowerCase()]||'application/octet-stream';
  const cache=path.extname(filename).toLowerCase()==='.html'?'no-cache':'public, max-age=3600';
  const headers={'content-type':type,'cache-control':cache,'x-content-type-options':'nosniff','accept-ranges':'bytes','content-length':stat.size};
  const range=req.headers.range;
  if(range&&/^bytes=\d*-\d*$/.test(range)){
    const [a,b]=range.slice(6).split('-');let start=a?Number(a):Math.max(0,stat.size-Number(b||0));let end=b&&a?Number(b):stat.size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=stat.size){res.writeHead(416,{'content-range':`bytes */${stat.size}`});res.end();return;}
    end=Math.min(end,stat.size-1);headers['content-range']=`bytes ${start}-${end}/${stat.size}`;headers['content-length']=end-start+1;res.writeHead(206,headers);
    if(method==='HEAD'){res.end();return;}fs.createReadStream(filename,{start,end}).on('error',()=>res.destroy()).pipe(res);return;
  }
  res.writeHead(200,headers);if(method==='HEAD'){res.end();return;}fs.createReadStream(filename).on('error',()=>res.destroy()).pipe(res);
});
const wss=new WebSocketServer({server:httpServer,path:'/ws',maxPayload:2*1024*1024});
wss.on('connection',(ws,req)=>{
  const origin=req.headers.origin;if(allowedOrigins.length&&origin&&!allowedOrigins.includes(origin)){ws.close(1008,'Origin not allowed');return;}
  const client={id:crypto.randomUUID(),ws,room:null,name:'Player',col:'#54a8e8',hat:0,skin:'',skinPreset:'vanguard',killStreak:0,susiUnlocked:false,blackHoleUsed:false,meleeThrown:false,meleeLost:false,meleeDropId:null,selectedVehicle:'atlas-cycle',vehicle:null,reloads:{},loadout:normalizeLoadout(),team:null,ready:false,host:false,kills:0,deaths:0,score:0,health:100,shield:0,alive:false,spawned:false,x:0,y:0,z:0,yaw:0,pitch:0,motion:'stand',weapon:'rifle',ammo:{},reserve:{},powerups:{},carrying:null,lastStateAt:now(),lastShot:0,lastMelee:0,lastTrip:0};sockets.set(client.id,client);send(ws,{type:'hello',id:client.id,version:'2.1.3'});
  ws.on('message',raw=>{if(raw.length>2*1024*1024)return;let msg;try{msg=JSON.parse(raw.toString());}catch{return;}handle(client,msg);});
  ws.on('close',()=>{leaveRoom(client);sockets.delete(client.id);});ws.on('error',()=>{});
});
const timer=setInterval(()=>{
  const t=now();for(const room of rooms.values()){
    if(room.started&&!room.ended){const dt=Math.max(0,Math.min(.5,(t-room.lastTick)/1000));room.lastTick=t;
      for(const p of room.players.values())for(const [weaponId,deadline] of Object.entries(p.reloads||{})){if(t<deadline)continue;const w=weaponById(weaponId);if(w.kind!=='gun'){clearReload(p.reloads,weaponId);continue;}const current=p.ammo[w.id]??0;const needed=Math.max(0,w.mag-current);const reserve=p.reserve?.[w.id]??w.reserve;const loaded=Math.min(needed,reserve);p.ammo[w.id]=current+loaded;p.reserve=p.reserve||{};p.reserve[w.id]=reserve-loaded;clearReload(p.reloads,w.id);broadcast(room,{type:'reloadComplete',id:p.id,weapon:w.id,ammo:p.ammo[w.id],reserve:p.reserve[w.id]});}
      for(const p of room.players.values())if(p.alive){for(const [id,expiry] of Object.entries(p.powerups||{}))if(expiry<=t)delete p.powerups[id];if(p.powerups?.regen>t)p.health=Math.min(100,p.health+2*dt);}
      processObjectives(room,dt);processDrones(room,t);processMeleeDrops(room,t,dt);processSingularity(room,t);processAirstrikes(room,t);if(t>=room.startAt)checkWin(room);
    }
  }
},125);
timer.unref();httpServer.listen(PORT,'0.0.0.0',()=>console.log(`VineBoom game + multiplayer server listening on http://0.0.0.0:${PORT} (WebSocket /ws)`));

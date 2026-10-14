import * as THREE from 'three';
import { buildMap } from './maps.js';
import { POWERUPS, WEAPONS, VEHICLES, weaponById, vehicleById, WORLD_LIMIT } from '../shared/game-data.js';
import { createPresetSkinCanvas } from './skin-presets.js';
import { playerHitboxes as sharedPlayerHitboxes, rayAabb } from '../shared/combat-geometry.js';
import { rayGridCells } from '../shared/raycast-grid.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const tmpV=new THREE.Vector3();
function rgbaHex(hex){return new THREE.Color(hex);}
function intersectAABB(origin,dir,b,maxDistance){return rayAabb(origin,dir,b,maxDistance);}

export class GameWorld {
  constructor(canvas,callbacks={}){
    this.canvas=canvas;this.callbacks=callbacks;this.keys=new Set();this.bindings={
      forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',sprint:'ShiftLeft',crouch:'KeyC',slide:'ControlLeft',backflip:'KeyV',crawl:'KeyZ',trip:'KeyG',reload:'KeyR',jump:'Space',interact:'KeyF',throwMelee:'KeyY',blackhole:'KeyB',vehicle:'KeyH',slot1:'Digit1',slot2:'Digit2',slot3:'Digit3',previous:'KeyQ',next:'KeyE',scores:'Tab',
    };
    this.active=false;this.inputFrozen=true;this.mouseFire=false;this.yaw=0;this.pitch=0;this.time=0;this.lastStateSend=0;this.tracers=[];this.fx=[];this.remote=new Map();this.bots=new Map();this.local={x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,motion:'stand',motionUntil:0,stamina:100,weapon:'rifle',team:0,dead:false};
    this.camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.08,360);this.camera.rotation.order='YXZ';
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x93a7b6);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,.95));this.renderer.setSize(innerWidth,innerHeight,false);this.renderer.shadowMap.enabled=false;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;
    this.hemi=new THREE.HemisphereLight(0xd8e4ef,0x3f453e,2.05);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xfff2dc,2.1);this.sun.position.set(-55,100,35);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.camera.left=-125;this.sun.shadow.camera.right=125;this.sun.shadow.camera.top=125;this.sun.shadow.camera.bottom=-125;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=260;this.sun.shadow.bias=-.00018;this.scene.add(this.sun);this.scene.add(this.sun.target);
    this.mapRoot=null;this.mapData=null;this.mapReady=Promise.resolve(null);this.colliders=[];this.collisionGrid=new Map();this.pickups=[];this.objectiveMeshes=[];this.flagVisuals=new Map();this.mapRaycaster=new THREE.Raycaster();this.meleeDrops=new Map();this.drones=new Map();this.airstrikeEffects=[];this.blackHoleVisual=null;this.savedLighting=null;
    this.vm=new THREE.Group();this.camera.add(this.vm);this.scene.add(this.camera);this.vm.position.set(.31,-.27,-.52);this.vm.rotation.order='XYZ';this.weaponVisualId='';this.vmWeapon=new THREE.Group();this.vm.add(this.vmWeapon);this.vmLeft=null;this.vmRight=null;this.vmMuzzle=null;this.vmFlash=null;this.vmRecoil=0;this.vmSwing=0;this.reloadVisualUntil=0;this.reloadDuration=1000;this.cameraRecoil=0;this.aiming=false;this.bob=0;this.wasMoving=false;
    this.localVehicleRoot=null;this.local.vehicleType=null;this.makeViewArms();this.buildMap('metro');this.bindInput();this.resizeHandler=()=>this.resize();addEventListener('resize',this.resizeHandler);
    this.lastFrame=performance.now();this.frameEma=1/60;this.perfCheckAt=performance.now()+5000;this.idleRenderAccumulator=0;this.thermalFallback=false; // One RAF loop is owned by main.js.
  }
  setCallbacks(callbacks){this.callbacks={...this.callbacks,...callbacks};}
  setBindings(bindings){this.bindings={...this.bindings,...bindings};}
  bindInput(){
    addEventListener('keydown',e=>{
      if(this.captureBinding){e.preventDefault();this.captureBinding(e.code);this.captureBinding=null;return;}
      this.keys.add(e.code);
      if(['Space','Tab','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();
      if(e.repeat)return;
      const action=Object.keys(this.bindings).find(a=>this.bindings[a]===e.code);
      if(action==='reload')this.callbacks.onAction?.('reload');
      else if(action==='jump')this.callbacks.onAction?.('jump');
      else if(action==='trip')this.callbacks.onAction?.('trip');
      else if(action==='interact')this.callbacks.onAction?.('interact');
      else if(action==='throwMelee')this.callbacks.onAction?.('throwMelee');
      else if(action==='blackhole')this.callbacks.onAction?.('blackhole');
      else if(action==='vehicle')this.callbacks.onAction?.('vehicle');
      else if(action==='slot1')this.callbacks.onAction?.('slot',0);
      else if(action==='slot2')this.callbacks.onAction?.('slot',1);
      else if(action==='slot3')this.callbacks.onAction?.('slot',2);
      else if(action==='previous')this.callbacks.onAction?.('switch',-1);
      else if(action==='next')this.callbacks.onAction?.('switch',1);
      else if(action==='scores')this.callbacks.onAction?.('scores',true);
      else if(action==='crouch')this.callbacks.onAction?.('crouch');
      else if(action==='crawl')this.callbacks.onAction?.('crawl');
      else if(action==='backflip')this.callbacks.onAction?.('backflip');
      else if(action==='slide')this.callbacks.onAction?.('slide');
      else if(e.code==='Escape'&&this.active)this.callbacks.onAction?.('pause');
    });
    addEventListener('keyup',e=>{this.keys.delete(e.code);const action=Object.keys(this.bindings).find(a=>this.bindings[a]===e.code);if(action==='scores')this.callbacks.onAction?.('scores',false);});
    addEventListener('mousedown',e=>{if(e.button===2&&this.active&&!this.inputFrozen&&document.pointerLockElement===this.canvas){this.aiming=true;return;}if(e.button===0&&this.active&&!this.inputFrozen&&document.pointerLockElement===this.canvas){this.mouseFire=true;this.callbacks.onAction?.('firePress');}});
    addEventListener('mouseup',e=>{if(e.button===2)this.aiming=false;if(e.button===0){this.mouseFire=false;this.callbacks.onAction?.('fireRelease');}});
    addEventListener('blur',()=>{this.aiming=false;this.mouseFire=false;this.keys.clear();});
    addEventListener('contextmenu',e=>e.preventDefault());
    addEventListener('mousemove',e=>{if(document.pointerLockElement===this.canvas&&this.active&&!this.inputFrozen){this.yaw-=e.movementX*.0021*(this.sensitivity||1);this.pitch=clamp(this.pitch-e.movementY*.0021*(this.sensitivity||1),-1.50,1.50);this.local.yaw=this.yaw;this.local.pitch=this.pitch;}});
    document.addEventListener('pointerlockchange',()=>{if(this.active&&document.pointerLockElement!==this.canvas&&!this.inputFrozen)this.callbacks.onAction?.('pause');});
    this.canvas.addEventListener('click',()=>{if(this.active&&!this.inputFrozen&&document.pointerLockElement!==this.canvas)this.canvas.requestPointerLock?.();});
    addEventListener('wheel',e=>{if(this.active&&!this.inputFrozen)this.callbacks.onAction?.('switch',e.deltaY>0?1:-1);},{passive:true});
  }
  resize(){this.renderer.setSize(innerWidth,innerHeight,false);this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();}
  setQuality(value){this.qualityPreference=['low','medium','high'].includes(value)?value:'medium';const q=this.qualityPreference==='low'?.56:this.qualityPreference==='medium'?.72:.9;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,q));const shadows=this.qualityPreference==='high'&&!this.thermalFallback;this.renderer.shadowMap.enabled=shadows;this.sun.castShadow=shadows;const shadowSize=this.qualityPreference==='high'?768:512;this.sun.shadow.mapSize.set(shadowSize,shadowSize);this.renderer.setSize(innerWidth,innerHeight,false);}
  setActive(active){this.active=active;this.inputFrozen=!active;this.mouseFire=false;}
  freezeInput(frozen){this.inputFrozen=frozen;this.mouseFire=false;}
  requestPointerLock(){this.canvas.requestPointerLock?.();}
  captureNextKey(cb){this.captureBinding=cb;}
  setSensitivity(value){this.sensitivity=value;}
  startReloadAnimation(durationMs=1000){this.reloadDuration=Math.max(250,durationMs);this.reloadVisualUntil=performance.now()+this.reloadDuration;}
  buildMap(mapId){
    if(this.mapRoot&&this.mapData?.config?.id===mapId)return this.mapData;
    if(this.mapRoot){this.scene.remove(this.mapRoot);this.disposeObject(this.mapRoot,true);}
    const built=buildMap(mapId);this.mapData=built;this.mapRoot=built.group;this.scene.add(this.mapRoot);
    this.colliders=built.colliders;this.collisionGrid=built.collision.grid;this.collisionCell=built.collision.cellSize;
    this.pickups=[];this.objectiveMeshes=[];this.flagVisuals=new Map();
    this.scene.background=new THREE.Color(built.config.sky);this.scene.fog=new THREE.Fog(built.config.fog,60,208);
    this.hemi.color.set(built.config.sky);this.sun.color.set(built.config.biome==='desert'?0xffd4a1:0xfff2dc);
    this.local.x=0;this.local.y=0;this.local.z=0;
    this.makePickups();this.makeObjectives(built.objectives);this.mapReady=Promise.resolve(built);
    return built;
  }
  async waitForMap(){
    await this.mapReady;
    if(!this.mapData)throw new Error('No map is selected.');
    return this.mapData;
  }
  disposeObject(root,disposeMaterials=false){
    root.traverse(o=>{if(o.geometry)o.geometry.dispose();if(disposeMaterials&&o.material){const list=Array.isArray(o.material)?o.material:[o.material];for(const m of list){if(m.userData?.vbShared)continue;m.map?.dispose?.();m.dispose?.();}}});
  }
  makePickups(){
    for(const p of this.mapData.pickups){const data=POWERUPS[p.type],g=new THREE.Group();const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.48,0),new THREE.MeshStandardMaterial({color:data.color,emissive:data.color,emissiveIntensity:1.6,metalness:.18,roughness:.25}));gem.position.y=.6;g.add(gem);const ring=new THREE.Mesh(new THREE.TorusGeometry(.65,.045,8,24),new THREE.MeshStandardMaterial({color:data.color,emissive:data.color,emissiveIntensity:.65}));ring.rotation.x=Math.PI/2;ring.position.y=.6;g.add(ring);g.position.set(p.x,0,p.z);g.userData={...p,active:true,mesh:gem,ring};this.mapRoot.add(g);this.pickups.push(g);}
  }
  makeObjectives(objectives){
    const addRing=(x,z,color,label)=>{const g=new THREE.Group();const ring=new THREE.Mesh(new THREE.TorusGeometry(3.1,.12,8,40),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.65,transparent:true,opacity:.86}));ring.rotation.x=Math.PI/2;ring.position.y=.1;g.add(ring);const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.08,.22,3.2,8),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.9,transparent:true,opacity:.52}));beacon.position.y=1.65;g.add(beacon);g.position.set(x,0,z);g.userData={label,ring,beacon};this.mapRoot.add(g);this.objectiveMeshes.push(g);};
    objectives.ctf.forEach(f=>{
      const color=f.team===0?'#62b5ff':'#f27d72';addRing(f.x,f.z,color,`FLAG ${f.id.toUpperCase()}`);
      const flag=new THREE.Group();const poleMat=new THREE.MeshStandardMaterial({color:'#a9b4b9',metalness:.65,roughness:.35});
      const clothMat=new THREE.MeshStandardMaterial({color,roughness:.74,side:THREE.DoubleSide,emissive:color,emissiveIntensity:.12});
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.06,2.25,8),poleMat);pole.position.y=1.13;flag.add(pole);
      const cloth=new THREE.Mesh(new THREE.PlaneGeometry(.95,.58,1,1),clothMat);cloth.position.set(.48,1.78,0);cloth.rotation.y=.08;flag.add(cloth);
      const finial=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),new THREE.MeshStandardMaterial({color:'#d7dee0',metalness:.6,roughness:.25}));finial.position.y=2.3;flag.add(finial);
      flag.position.set(f.x,0,f.z);flag.userData={cloth,phase:f.team?1.8:.4,id:f.id};this.mapRoot.add(flag);this.flagVisuals.set(f.id,flag);
    });
    objectives.dom.forEach((p,i)=>addRing(p.x,p.z,['#63b5ff','#f4ca77','#ef7a73'][i],`ZONE ${p.id}`));
  }
  setObjectives(state){
    if(!state)return;
    for(const obj of this.objectiveMeshes){const id=obj.userData.label?.match(/ZONE ([A-C])/);if(id&&state.dom){const p=state.dom.find(x=>x.id===id[1]);if(p){const c=p.owner===0?0x65b6ff:p.owner===1?0xff766f:0xe4e9ec;obj.userData.ring.material.color.setHex(c);obj.userData.ring.material.emissive.setHex(c);obj.userData.beacon.material.color.setHex(c);obj.userData.beacon.material.emissive.setHex(c);obj.userData.ring.material.opacity=.35+Math.abs(p.progress||0)/140;}}}
    for(const f of state.flags||[]){const flag=this.flagVisuals.get(f.id);if(!flag)continue;flag.position.x=f.x??flag.position.x;flag.position.z=f.z??flag.position.z;flag.visible=true;}
  }
  spawn(spawn,authoritative=false){
    const candidates=[...(this.mapData?.spawns||[])];
    const safe=(s)=>s&&Number.isFinite(Number(s.x))&&Number.isFinite(Number(s.z))&&this.canOccupy(Number(s.x),Number(s.z),Math.max(0,Number(s.y)||0),1.8);
    let chosen=safe(spawn)?spawn:null;
    if(!chosen)chosen=candidates.find(safe)||null;
    // Last-resort safe perimeter search. The old (0,0,0) fallback could place players inside
    // map landmarks such as the hangar and research building, trapping them at deployment.
    if(!chosen){
      const lanes=[-111,-108,-104,-98,-92,92,98,104,108,111];
      outer: for(const x of lanes)for(let z=-96;z<=96;z+=8){if(safe({x,y:0,z})){chosen={x,y:0,z};break outer;}}
    }
    if(!chosen){chosen={x:-108,y:0,z:-96};}
    const sx=Number.isFinite(Number(chosen.x))?Number(chosen.x):-108,sy=Number.isFinite(Number(chosen.y))?Number(chosen.y):0,sz=Number.isFinite(Number(chosen.z))?Number(chosen.z):0;
    this.local.x=clamp(sx,-WORLD_LIMIT+3,WORLD_LIMIT-3);this.local.y=Math.max(0,sy);this.local.z=clamp(sz,-WORLD_LIMIT+3,WORLD_LIMIT-3);this.local.vx=this.local.vy=this.local.vz=0;this.local.grounded=true;this.local.motion='stand';this.local.motionUntil=0;this.local.dead=false;
    this.yaw=Math.atan2(this.local.x,this.local.z);this.pitch=0;this.local.yaw=this.yaw;this.local.pitch=0;this.vmRecoil=0;this.vmSwing=0;this.cameraRecoil=0;this.aiming=false;
  }
  makeViewArms(){
    const glove=new THREE.MeshStandardMaterial({color:'#343b40',roughness:.84});const sleeve=new THREE.MeshStandardMaterial({color:'#68766e',roughness:.92});
    this.vmLeft=new THREE.Mesh(new THREE.BoxGeometry(.14,.32,.14),sleeve);this.vmLeft.position.set(-.26,-.24,-.32);this.vm.add(this.vmLeft);
    this.vmRight=new THREE.Mesh(new THREE.BoxGeometry(.14,.31,.14),sleeve);this.vmRight.position.set(.2,-.25,-.3);this.vm.add(this.vmRight);
    const handL=new THREE.Mesh(new THREE.BoxGeometry(.13,.12,.15),glove);handL.position.set(0,-.14,-.05);this.vmLeft.add(handL);
    const handR=new THREE.Mesh(new THREE.BoxGeometry(.13,.12,.15),glove);handR.position.set(0,-.13,-.07);this.vmRight.add(handR);
  }
  buildViewWeapon(id){
    this.vmWeapon.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});this.vmWeapon.clear();this.vmMuzzle=null;this.vmPump=null;this.weaponVisualId=id;const w=weaponById(id);const metal=new THREE.MeshStandardMaterial({color:w.color,metalness:.58,roughness:.35}),dark=new THREE.MeshStandardMaterial({color:'#252b30',metalness:.45,roughness:.5}),poly=new THREE.MeshStandardMaterial({color:'#59615f',roughness:.8});
    const box=(parent,geo,mat,pos,rot)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);if(rot)m.rotation.set(...rot);m.castShadow=false;parent.add(m);return m;};
    if(w.kind==='melee'){
      const hilt=box(this.vmWeapon,new THREE.CylinderGeometry(.025,.035,.28,8),dark,[0,-.05,.1],[0,0,Math.PI/7]);
      box(this.vmWeapon,new THREE.BoxGeometry(.09,.1,.08),metal,[0,.1,.1]);
      if(id==='knife')box(this.vmWeapon,new THREE.BoxGeometry(.055,.36,.035),metal,[0,.32,.06],[0,0,-.11]);
      else if(id==='sword'){
        box(this.vmWeapon,new THREE.BoxGeometry(.07,.59,.035),metal,[0,.43,.06],[0,0,-.05]);
        box(this.vmWeapon,new THREE.BoxGeometry(.16,.045,.065),dark,[0,.19,.06]);
      }else if(id==='susis_sword'){
        const voidMetal=new THREE.MeshStandardMaterial({color:'#050509',metalness:.86,roughness:.16,emissive:'#1d1247',emissiveIntensity:.85});
        const voidEdge=new THREE.MeshStandardMaterial({color:'#6d5aa8',metalness:.68,roughness:.2,emissive:'#5032aa',emissiveIntensity:1.15});
        box(this.vmWeapon,new THREE.BoxGeometry(.105,.88,.04),voidMetal,[0,.59,.055],[0,0,-.035]);
        box(this.vmWeapon,new THREE.BoxGeometry(.018,.78,.012),voidEdge,[.057,.59,.03],[0,0,-.035]);
        box(this.vmWeapon,new THREE.BoxGeometry(.23,.055,.075),voidEdge,[0,.16,.06]);
        box(this.vmWeapon,new THREE.BoxGeometry(.065,.19,.06),voidMetal,[0,.005,.06]);
      }else if(id==='axe'){box(this.vmWeapon,new THREE.BoxGeometry(.055,.46,.05),dark,[0,.29,.06]);box(this.vmWeapon,new THREE.BoxGeometry(.27,.2,.07),metal,[.11,.48,.06]);}
      else if(id==='hammer'){box(this.vmWeapon,new THREE.BoxGeometry(.06,.5,.055),dark,[0,.31,.06]);box(this.vmWeapon,new THREE.BoxGeometry(.27,.16,.13),metal,[0,.58,.06]);}
      else box(this.vmWeapon,new THREE.CylinderGeometry(.065,.06,.54,8),poly,[0,.34,.06],[0,0,-.08]);
      this.vmWeapon.position.set(-.02,-.08,-.35);this.vmWeapon.userData.baseY=-.08;this.vmWeapon.rotation.set(.2,0,-.15);
    } else {
      const long=w.category==='sniper'||w.id==='lmg'||w.id==='minigun'||w.id==='crossbow'||w.id==='vizblaster';const bodyLen=['shotgun','vizblaster'].includes(w.id)?.64:long?.72:.43;const bodyW=['minigun','vizblaster'].includes(w.id)?.19:.13;
      // Layered receiver, stock, rail, barrel, sights, magazine and grip create a readable firearm silhouette.
      box(this.vmWeapon,new THREE.BoxGeometry(bodyW,.15,bodyLen),metal,[0,0,-.12]);
      box(this.vmWeapon,new THREE.BoxGeometry(bodyW*.72,.105,bodyLen*.66),dark,[0,-.012,-.13]);
      box(this.vmWeapon,new THREE.BoxGeometry(bodyW*.82,.055,bodyLen*.38),poly,[0,.088,-.13]);
      box(this.vmWeapon,new THREE.BoxGeometry(bodyW*.7,.11,.17),dark,[0,-.16,.015],[.28,0,0]);
      box(this.vmWeapon,new THREE.BoxGeometry(bodyW*.8,.09,.18),poly,[0,-.04,.16]);
      box(this.vmWeapon,new THREE.BoxGeometry(.06,.06,.43),dark,[0,.105,-.29]);
      box(this.vmWeapon,new THREE.BoxGeometry(.03,.08,.055),metal,[0,.17,-.16]);
      const barrelLength=w.id==='vizblaster'?.47:w.id==='shotgun'?.4:long?.58:.3;
      box(this.vmWeapon,new THREE.CylinderGeometry(w.id==='vizblaster'?.052:.027,w.id==='vizblaster'?.05:.032,barrelLength,10),dark,[0,.012,-.46],[Math.PI/2,0,0]);
      box(this.vmWeapon,new THREE.CylinderGeometry(w.id==='vizblaster'?.068:.035,w.id==='vizblaster'?.064:.03,.055,10),metal,[0,.012,-.46-barrelLength/2],[Math.PI/2,0,0]);
      if(w.category==='sniper'){box(this.vmWeapon,new THREE.CylinderGeometry(.052,.052,.31,12),dark,[0,.14,-.15],[Math.PI/2,0,0]);box(this.vmWeapon,new THREE.BoxGeometry(.13,.075,.18),metal,[0,.21,-.15]);}
      if(w.id==='shotgun'||w.id==='vizblaster'){
        box(this.vmWeapon,new THREE.BoxGeometry(.11,.10,.30),poly,[0,-.025,-.40]);
        box(this.vmWeapon,new THREE.CylinderGeometry(.025,.025,.3,8),metal,[.055,-.03,-.4],[Math.PI/2,0,0]);
        if(w.id==='vizblaster'){
          box(this.vmWeapon,new THREE.BoxGeometry(.22,.14,.18),metal,[0,.05,-.2]);
          box(this.vmWeapon,new THREE.BoxGeometry(.12,.07,.14),new THREE.MeshStandardMaterial({color:'#58d9ed',emissive:'#2ac9e5',emissiveIntensity:.7}),[0,.1,-.26]);
          const pump=new THREE.Group();pump.position.set(0,-.025,-.4);this.vmWeapon.add(pump);this.vmPump=pump;this.vmPumpBaseZ=-.4;
          box(pump,new THREE.BoxGeometry(.13,.09,.23),poly,[0,0,0]);
          box(pump,new THREE.BoxGeometry(.135,.025,.16),dark,[0,.05,-.015]);
          box(this.vmWeapon,new THREE.BoxGeometry(.05,.12,.07),dark,[-.115,.01,-.12]);
          box(this.vmWeapon,new THREE.BoxGeometry(.035,.075,.035),new THREE.MeshStandardMaterial({color:'#f7fcff',emissive:'#d9f9ff',emissiveIntensity:.85}),[.095,.02,-.25]);
        }
      }
      if(w.id==='laser'){const glow=new THREE.MeshStandardMaterial({color:'#d98cff',emissive:'#be58fa',emissiveIntensity:2});box(this.vmWeapon,new THREE.BoxGeometry(.045,.045,.42),glow,[.08,.055,-.25]);}
      if(w.id==='minigun')for(let i=0;i<3;i++)box(this.vmWeapon,new THREE.CylinderGeometry(.022,.022,.44,8),dark,[-.045+i*.045,.01,-.51],[Math.PI/2,0,0]);
      if(w.id==='crossbow'){box(this.vmWeapon,new THREE.BoxGeometry(.4,.045,.06),metal,[0,.1,-.23]);box(this.vmWeapon,new THREE.BoxGeometry(.045,.13,.4),dark,[0,.14,-.18]);}
      box(this.vmWeapon,new THREE.BoxGeometry(.12,.075,.12),dark,[0,-.075,-.1]);
      this.vmWeapon.position.set(0,-.025,-.22);this.vmWeapon.userData.baseY=-.025;
      this.vmMuzzle=new THREE.Mesh(new THREE.SphereGeometry(w.id==='vizblaster'?.095:.075,8,6),new THREE.MeshBasicMaterial({color:w.id==='vizblaster'?'#d9fbff':'#ffe8a0',transparent:true,opacity:0}));this.vmMuzzle.position.set(0,.01,-.72);this.vmWeapon.add(this.vmMuzzle);
    }
  }
  showWeapon(id){if(id==='unarmed'){this.vmWeapon.visible=false;this.weaponVisualId='unarmed';return;}this.vmWeapon.visible=true;if(id!==this.weaponVisualId)this.buildViewWeapon(id);}
  addMeleeDrop(data,localPhysics=false){
    if(!data?.id)return null;let record=this.meleeDrops.get(data.id);if(record){this.updateMeleeDrop(data);return record;}
    const wid=String(data.weapon||'knife'),def=weaponById(wid),dark=new THREE.MeshStandardMaterial({color:'#20262b',metalness:.28,roughness:.72});
    if(wid==='susis_sword'){
      const voidMetal=new THREE.MeshStandardMaterial({color:'#050509',metalness:.86,roughness:.16,emissive:'#1d1247',emissiveIntensity:.85});
      const voidEdge=new THREE.MeshStandardMaterial({color:'#6d5aa8',metalness:.68,roughness:.2,emissive:'#5032aa',emissiveIntensity:1.15});
      const blade=new THREE.Mesh(new THREE.BoxGeometry(.085,.055,.9),voidMetal);blade.position.set(.22,0,0);root.add(blade);const edge=new THREE.Mesh(new THREE.BoxGeometry(.02,.06,.82),voidEdge);edge.position.set(.22,.033,0);root.add(edge);const guard=new THREE.Mesh(new THREE.BoxGeometry(.22,.075,.09),voidEdge);guard.position.set(-.12,0,0);root.add(guard);
    }else{
      const steel=new THREE.MeshStandardMaterial({color:def.color||'#b9c4cc',metalness:.62,roughness:.27});
      if(wid==='bat'){const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.075,.045,.8,10),new THREE.MeshStandardMaterial({color:'#8a5736',roughness:.78}));shaft.rotation.z=Math.PI/2;root.add(shaft);}
      else if(wid==='hammer'){const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.35,7),dark);shaft.rotation.z=Math.PI/2;shaft.position.x=-.14;root.add(shaft);const head=new THREE.Mesh(new THREE.BoxGeometry(.22,.16,.14),steel);head.position.set(.12,0,0);root.add(head);}
      else if(wid==='axe'){const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.36,7),dark);shaft.rotation.z=Math.PI/2;shaft.position.x=-.15;root.add(shaft);const head=new THREE.Mesh(new THREE.BoxGeometry(.24,.22,.065),steel);head.position.set(.1,0,0);root.add(head);}
      else {const blade=new THREE.Mesh(new THREE.BoxGeometry(.09,.055,.72),steel);blade.position.x=.22;root.add(blade);const guard=new THREE.Mesh(new THREE.BoxGeometry(.22,.075,.09),steel);guard.position.set(-.12,0,0);root.add(guard);}
    }
    const grip=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.27,7),dark);grip.rotation.z=Math.PI/2;grip.position.x=-.29;root.add(grip);
    root.position.set(data.x||0,data.y||.25,data.z||0);root.rotation.set(.18,0,.25);this.scene.add(root);record={...data,root,localPhysics,velocity:new THREE.Vector3(data.vx||0,data.vy||0,data.vz||0),expiresAt:data.expiresAt||Date.now()+18000};this.meleeDrops.set(data.id,record);return record;
  }
  updateMeleeDrop(data){let r=this.meleeDrops.get(data?.id);if(!r)r=this.addMeleeDrop(data,false);if(!r)return;r.x=data.x??r.x;r.y=data.y??r.y;r.z=data.z??r.z;r.weapon=data.weapon||r.weapon;if(!r.localPhysics)r.root.position.set(r.x,r.y,r.z);}
  removeMeleeDrop(id){const r=this.meleeDrops.get(id);if(!r)return;this.scene.remove(r.root);this.disposeObject(r.root,true);this.meleeDrops.delete(id);}
  updateMeleeDrops(dt){for(const [id,r] of this.meleeDrops){if(!r.localPhysics)continue;r.velocity.y-=9.8*dt;const nx=clamp(r.x+r.velocity.x*dt,-WORLD_LIMIT+1,WORLD_LIMIT-1),nz=clamp(r.z+r.velocity.z*dt,-WORLD_LIMIT+1,WORLD_LIMIT-1),ny=r.y+r.velocity.y*dt;const blocked=this.getNearby(nx,nz).some(b=>nx+.12>b.x-b.w/2&&nx-.12<b.x+b.w/2&&nz+.12>b.z-b.d/2&&nz-.12<b.z+b.d/2&&Math.max(.12,ny)+.12>b.y&&Math.max(.12,ny)-.12<b.y+b.h);if(blocked){r.velocity.x*=-.18;r.velocity.z*=-.18;r.velocity.y=Math.max(0,r.velocity.y*.35);}else{r.x=nx;r.z=nz;r.y=ny;}if(r.y<.15){r.y=.15;r.velocity.y=0;r.velocity.x*=.57;r.velocity.z*=.57;}r.root.position.set(r.x,r.y,r.z);r.root.rotation.y+=dt*2.2;}}
  showDrone(id,owner,x,y,z,expiresAt=Date.now()+15000){if(!id)return;let r=this.drones.get(id);if(!r){const root=new THREE.Group(),body=new THREE.Mesh(new THREE.SphereGeometry(.23,12,9),new THREE.MeshStandardMaterial({color:'#f3f7fa',metalness:.4,roughness:.3,emissive:'#afc4cc',emissiveIntensity:.55}));root.add(body);const ring=new THREE.Mesh(new THREE.TorusGeometry(.43,.025,5,20),new THREE.MeshStandardMaterial({color:'#f5f7f5',emissive:'#fff',emissiveIntensity:.6}));ring.rotation.x=Math.PI/2;root.add(ring);for(let i=0;i<4;i++){const arm=new THREE.Mesh(new THREE.BoxGeometry(.42,.035,.04),new THREE.MeshStandardMaterial({color:'#a9b8c0',metalness:.55}));arm.rotation.y=i*Math.PI/2;root.add(arm);const rotor=new THREE.Mesh(new THREE.TorusGeometry(.12,.018,5,12),new THREE.MeshBasicMaterial({color:'#ffffff'}));rotor.position.set(Math.cos(i*Math.PI/2)*.32,.05,Math.sin(i*Math.PI/2)*.32);root.add(rotor);}this.scene.add(root);r={id,owner,root,expiresAt,phase:Math.random()*6,nextFireAt:0};this.drones.set(id,r);}r.x=x;r.y=y;r.z=z;r.expiresAt=expiresAt;r.root.position.set(x,y,z);return r;}
  updateDroneStates(rows){const seen=new Set();for(const d of rows||[]){seen.add(d.id);this.showDrone(d.id,d.owner,d.x,d.y,d.z,d.expiresAt);}for(const [id,r] of this.drones){if(!seen.has(id)&&r.expiresAt<Date.now()){this.removeDrone(id);}}}
  removeDrone(id){const d=this.drones.get(id);if(!d)return;this.scene.remove(d.root);this.disposeObject(d.root,true);this.drones.delete(id);}
  makeVehicleModel(kind){
    const root=new THREE.Group();
    const metal=new THREE.MeshStandardMaterial({color:kind==='rdx-hoverboard'?'#a9f5ff':'#424d54',metalness:.66,roughness:.3});
    const rubber=new THREE.MeshStandardMaterial({color:'#121619',roughness:.88});
    const paint=new THREE.MeshStandardMaterial({color:kind==='yamaha-bike'?'#e23b3b':kind==='royal-enfield'?'#3b4a3f':kind==='atlas-cycle'?'#6d9f73':kind==='decathlon-skateboard'?'#e4ac59':'#68e6f3',metalness:.36,roughness:.28,emissive:kind==='rdx-hoverboard'?'#24cce4':'#000000',emissiveIntensity:kind==='rdx-hoverboard'?.9:0});
    const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=this.qualityPreference==='high';m.receiveShadow=true;root.add(m);return m;};
    const wheel=(x,y,z,r)=>add(new THREE.TorusGeometry(r,.045,7,16),rubber,x,y,z,0,Math.PI/2,0);
    const bar=(a,b,r,mat)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av),m=add(new THREE.CylinderGeometry(r*.72,r,delta.length(),7),mat,...av.clone().add(bv).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;};
    if(kind==='decathlon-skateboard'){
      add(new THREE.BoxGeometry(.42,.09,.96),paint,0,.26,0,0,0,.02);add(new THREE.BoxGeometry(.36,.025,.86),metal,0,.315,0);
      for(const z of [-.29,.29]){bar([0,.19,z],[0,.22,z],.035,metal);for(const x of [-.17,.17])add(new THREE.CylinderGeometry(.075,.075,.065,9),rubber,x,.14,z,0,0,Math.PI/2);}
    }else if(kind==='rdx-hoverboard'){
      add(new THREE.BoxGeometry(.58,.13,.78),paint,0,.32,0);add(new THREE.BoxGeometry(.43,.018,.58),metal,0,.395,0);const ring=add(new THREE.TorusGeometry(.32,.025,6,24),paint,0,.24,0);ring.rotation.x=Math.PI/2;
      for(const x of [-.22,.22]){const glow=add(new THREE.CylinderGeometry(.08,.13,.06,10),paint,x,.2,0);glow.material=paint.clone();glow.material.emissive.set('#35e8ff');glow.material.emissiveIntensity=1.4;}
    }else{
      const r=kind==='atlas-cycle'?.24:kind==='royal-enfield'?.31:.29,wheelX=.0;
      wheel(wheelX,r+.045,-.52,r);wheel(wheelX,r+.045,.52,r);
      bar([0,r+.05,-.52],[0,.69,0],.032,metal);bar([0,r+.05,.52],[0,.69,0],.032,metal);bar([0,.69,0],[0,.51,.43],.026,paint);bar([0,.51,.43],[0,r+.05,.52],.025,metal);
      if(kind==='atlas-cycle'){bar([0,.69,0],[0,.52,-.43],.022,paint);bar([0,.52,-.43],[0,r+.05,-.52],.022,metal);add(new THREE.BoxGeometry(.18,.035,.11),rubber,0,.72,.03);add(new THREE.BoxGeometry(.24,.035,.1),rubber,0,.53,.37);}
      else {add(new THREE.BoxGeometry(.31,.19,.33),paint,0,.64,.02);add(new THREE.BoxGeometry(.27,.075,.26),rubber,0,.79,.26);add(new THREE.BoxGeometry(.22,.06,.1),metal,0,.91,-.37);add(new THREE.BoxGeometry(.07,.1,.09),paint,0,.82,-.49);const lamp=add(new THREE.SphereGeometry(.075,8,6),new THREE.MeshBasicMaterial({color:'#fff0b0'}),0,.8,-.53);}
      bar([0,.88,-.38],[-.22,.88,-.38],.018,metal);bar([0,.88,-.38],[.22,.88,-.38],.018,metal);
    }
    root.userData.kind=kind;root.traverse(o=>{if(o.isMesh){o.castShadow=this.qualityPreference==='high';o.receiveShadow=true;}});return root;
  }
  toggleLocalVehicle(kind){
    if(this.local.vehicleType){this.clearLocalVehicle();return false;}
    const spec=VEHICLES.find(v=>v.id===kind);if(!spec)return false;
    this.local.vehicleType=spec.id;this.local.vehicleFlightUntil=0;this.local.vehicleRechargeAt=0;this.local.vehicleBaseY=this.local.y;
    this.localVehicleRoot=this.makeVehicleModel(spec.id);this.scene.add(this.localVehicleRoot);this.localVehicleRoot.position.set(this.local.x,this.local.y,this.local.z);return true;
  }
  clearLocalVehicle(){if(this.localVehicleRoot){this.scene.remove(this.localVehicleRoot);this.disposeObject(this.localVehicleRoot,true);this.localVehicleRoot=null;}this.local.vehicleType=null;this.local.vehicleFlightUntil=0;this.local.vehicleRechargeAt=0;const speed=Math.hypot(this.local.vx||0,this.local.vz||0);if(speed>5.6){this.local.vx*=5.6/speed;this.local.vz*=5.6/speed;}}
  activateVehicleFlight(){const p=this.local,now=Date.now();if(p.vehicleType!=='rdx-hoverboard'||now<(p.vehicleRechargeAt||0)||p.vehicleFlightUntil>now)return false;p.vehicleBaseY=p.y+2.9;p.y=p.vehicleBaseY;p.vy=0;p.grounded=false;p.vehicleFlightUntil=now+10000;p.vehicleRechargeAt=p.vehicleFlightUntil+100000;return true;}
  setRemoteVehicle(record,kind){
    if(!record?.mesh)return;const g=record.mesh;if(record.vehicleType===kind)return;
    const old=g.userData.vehicleRoot;if(old){g.remove(old);this.disposeObject(old,true);g.userData.vehicleRoot=null;}
    record.vehicleType=kind||null;record.info.vehicle=kind||null;
    if(kind&&VEHICLES.some(v=>v.id===kind)){const root=this.makeVehicleModel(kind);root.position.set(0,0,0);g.add(root);g.userData.vehicleRoot=root;}
  }
  clearCombatEffects(){for(const id of [...this.meleeDrops.keys()])this.removeMeleeDrop(id);for(const id of [...this.drones.keys()])this.removeDrone(id);for(const e of this.airstrikeEffects){this.scene.remove(e.root);this.disposeObject(e.root,true);}this.airstrikeEffects.length=0;this.endBlackHole();}
  showPaintShot(fromValues,toValues){
    const from=new THREE.Vector3(...fromValues),to=new THREE.Vector3(...toValues),delta=to.clone().sub(from),distance=delta.length();if(distance<.05)return;
    this.showTracer([from.x,from.y,from.z],[delta.x,delta.y,delta.z],distance,'#ffffff');
    const object=new THREE.Mesh(new THREE.SphereGeometry(.065,7,5),new THREE.MeshBasicMaterial({color:'#ffffff'}));object.position.copy(from);this.scene.add(object);
    this.fx.push({object,life:.15,max:.15,path:{from,to}});
  }
  showPaintSplatter(x,y,z){const root=new THREE.Group();for(let i=0;i<7;i++){const r=.06+Math.random()*.13,m=new THREE.Mesh(new THREE.SphereGeometry(r,6,5),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.94}));m.position.set((Math.random()-.5)*.55,(Math.random()-.5)*.38,(Math.random()-.5)*.55);root.add(m);}root.position.set(x,y,z);this.scene.add(root);this.fx.push({object:root,life:.75,max:.75,v:new THREE.Vector3(0,.12,0),gravity:0,group:true});}
  showAirstrike(x,z,duration=2300){const root=new THREE.Group(),ring=new THREE.Mesh(new THREE.TorusGeometry(9,.16,6,40),new THREE.MeshBasicMaterial({color:'#ff654a',transparent:true,opacity:.95}));ring.rotation.x=Math.PI/2;root.add(ring);for(const [dx,dz] of [[-4,-4],[4,-4],[-4,4],[4,4]]){const beam=new THREE.Mesh(new THREE.CylinderGeometry(.25,.65,18,8),new THREE.MeshBasicMaterial({color:'#ff8a5b',transparent:true,opacity:.52}));beam.position.set(dx,9,dz);root.add(beam);}root.position.set(x,.08,z);this.scene.add(root);this.airstrikeEffects.push({root,life:duration/1000,max:duration/1000,elapsed:0});}
  showBlackHole({x=0,z=0,duration=6100}={}){if(this.blackHoleVisual){this.endBlackHole();}this.savedLighting={background:this.scene.background.clone(),fog:this.scene.fog?.color?.clone(),hemi:this.hemi.intensity,sun:this.sun.intensity,sky:this.mapData?.config?.sky,fogFar:this.scene.fog?.far,fogNear:this.scene.fog?.near};this.scene.background=new THREE.Color(0x03030b);if(this.scene.fog){this.scene.fog.color.set(0x090918);this.scene.fog.near=18;this.scene.fog.far=185;}this.hemi.intensity=.22;this.sun.intensity=.12;
    const root=new THREE.Group(),black=new THREE.Mesh(new THREE.SphereGeometry(2.1,24,18),new THREE.MeshBasicMaterial({color:'#010106'}));root.add(black);const accretion=new THREE.Mesh(new THREE.TorusGeometry(3.0,.34,12,64),new THREE.MeshStandardMaterial({color:'#5d3aff',emissive:'#8e43ff',emissiveIntensity:2.2,metalness:.4,roughness:.22}));accretion.rotation.x=.38;root.add(accretion);const ring2=new THREE.Mesh(new THREE.TorusGeometry(3.7,.06,6,72),new THREE.MeshBasicMaterial({color:'#9b76ff',transparent:true,opacity:.88}));ring2.rotation.x=-.8;root.add(ring2);root.position.set(x,2.8,z);this.scene.add(root);this.blackHoleVisual={root,accretion,ring2,started:performance.now(),duration,burst:false};}
  showBlackHoleBurst(x,z){if(!this.blackHoleVisual)this.showBlackHole({x,z});const s=new THREE.Mesh(new THREE.SphereGeometry(1,18,14),new THREE.MeshBasicMaterial({color:'#6d4aff',transparent:true,opacity:.6,wireframe:true}));s.position.set(x,3,z);this.scene.add(s);this.fx.push({object:s,life:1.3,max:1.3,v:new THREE.Vector3(0,.5,0),gravity:0,expand:14});if(this.blackHoleVisual)this.blackHoleVisual.burst=true;}
  showAirstrikeImpact(x,z){const s=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:'#ff8b56',transparent:true,opacity:.8,wireframe:true}));s.position.set(x,2,z);this.scene.add(s);this.fx.push({object:s,life:.9,max:.9,v:new THREE.Vector3(0,.5,0),gravity:0,expand:18});}
  endBlackHole(){const v=this.blackHoleVisual;if(v){this.scene.remove(v.root);this.disposeObject(v.root,true);this.blackHoleVisual=null;}if(this.savedLighting){this.scene.background.copy(this.savedLighting.background);if(this.scene.fog&&this.savedLighting.fog)this.scene.fog.color.copy(this.savedLighting.fog);if(this.scene.fog){this.scene.fog.near=this.savedLighting.fogNear??60;this.scene.fog.far=this.savedLighting.fogFar??208;}this.hemi.intensity=this.savedLighting.hemi;this.sun.intensity=this.savedLighting.sun;this.savedLighting=null;}}
  createRemote(info,isBot=false){
    const existing=this.remote.get(info.id);if(existing){existing.info={...existing.info,...info};return existing;}
    const player=this.makePlayerModel(info);player.position.set(info.x??0,info.y??-100,info.z??0);this.scene.add(player);
    const record={id:info.id,info:{...info},mesh:player,target:new THREE.Vector3(info.x??0,info.y??-100,info.z??0),yaw:info.yaw||0,pitch:info.pitch||0,motion:'stand',phase:0,health:100,weapon:info.weapon||'rifle',team:info.team||0,isBot,vehicleType:null};this.remote.set(info.id,record);if(isBot)this.bots.set(info.id,record);if(info.vehicle)this.setRemoteVehicle(record,info.vehicle);return record;
  }
  makePlayerModel(info){
    const g=new THREE.Group();
    const skinCanvas=this.skinTexture(info.skin,info.col||'#4e8ed9',info.skinPreset||'vanguard');
    const tex=new THREE.CanvasTexture(skinCanvas);tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;tex.colorSpace=THREE.SRGBColorSpace;
    skinCanvas.addEventListener('skinready',()=>{tex.needsUpdate=true;});
    const rig=new THREE.Group();rig.position.y=1;g.add(rig);
    const sc=1/16;
    const mkPart=(w,h,d,mat,uv)=>{const geo=new THREE.BoxGeometry(w*sc,h*sc,d*sc);if(uv){const faces=[[uv[0]+d+w,uv[1]+d,d,h],[uv[0],uv[1]+d,d,h],[uv[0]+d,uv[1],w,d],[uv[0]+d+w,uv[1],w,d],[uv[0]+d,uv[1]+d,w,h],[uv[0]+2*d+w,uv[1]+d,w,h]];faces.forEach((r,face)=>{for(let j=0;j<4;j++){const xy=[[r[0],r[1]],[r[0]+r[2],r[1]],[r[0],r[1]+r[3]],[r[0]+r[2],r[1]+r[3]]][j];geo.attributes.uv.setXY(face*4+j,xy[0]/64,1-xy[1]/64);}});geo.attributes.uv.needsUpdate=true;}return new THREE.Mesh(geo,mat);};
    // Opaque base skin texture avoids transparent PNG pixels creating missing head/body faces.
    const material=new THREE.MeshStandardMaterial({map:tex,roughness:.92,metalness:0,transparent:false});
    const head=mkPart(8,8,8,material,[0,0]);head.position.set(0,.685,0);rig.add(head);
    const body=mkPart(8,12,4,material,[16,16]);body.position.set(0,.12,0);rig.add(body);
    // Arm and leg boxes are children of shoulder/hip pivots so they bend at joints rather than spinning around their own centers.
    const pivotPart=(w,h,d,uv,x,y,z)=>{const pivot=new THREE.Group();pivot.position.set(x,y,z);const mesh=mkPart(w,h,d,material,uv);mesh.position.y=-(h/16)/2;pivot.add(mesh);rig.add(pivot);return pivot;};
    const ra=pivotPart(4,12,4,[40,16],-.38,.495,0);
    const la=pivotPart(4,12,4,[32,48],.38,.495,0);
    const rl=pivotPart(4,12,4,[0,16],-.125,-.255,0);
    const ll=pivotPart(4,12,4,[16,48],.125,-.255,0);
    const hatMat=(color,metalness=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.5});
    if(+info.hat===1){const c=new THREE.Mesh(new THREE.BoxGeometry(.54,.11,.54),hatMat('#ffcc31',.6));c.position.y=.285;head.add(c);}
    if(+info.hat===2){const m=hatMat('#15191d');const brim=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.05,8),m);brim.position.y=.27;head.add(brim);const top=new THREE.Mesh(new THREE.CylinderGeometry(.21,.24,.35,8),m);top.position.y=.46;head.add(top);}
    if(+info.hat===3){const cone=new THREE.Mesh(new THREE.ConeGeometry(.19,.42,8),hatMat('#ff8bc8'));cone.position.y=.39;head.add(cone);}
    if(+info.hat===4){const halo=new THREE.Mesh(new THREE.TorusGeometry(.21,.025,6,16),hatMat('#ffe680',.2));halo.rotation.x=Math.PI/2;halo.position.y=.36;head.add(halo);}
    const weapon=new THREE.Group();weapon.position.set(-.30,-.02,.18);weapon.rotation.x=-.08;rig.add(weapon);
    const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=48;const ctx=labelCanvas.getContext('2d');ctx.font='bold 26px system-ui';ctx.textAlign='center';ctx.lineWidth=5;ctx.strokeStyle='#0a1014';ctx.fillStyle='#fff';ctx.strokeText(info.name||'Player',128,32);ctx.fillText(info.name||'Player',128,32);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(labelCanvas),depthTest:false}));label.scale.set(1.9,.36,1);label.position.y=2.34;g.add(label);
    g.userData={rig,head,body,ra,la,rl,ll,weapon,label,weaponId:'',team:info.team||0,basePose:{head:[0,.685,0],body:[0,.12,0],ra:[-.38,.495,0],la:[.38,.495,0],rl:[-.125,-.255,0],ll:[.125,-.255,0]}};
    this.equipRemoteWeapon(g,info.meleeThrown?'unarmed':(info.weapon||'rifle'));return g;
  }
  skinTexture(skin,color,preset='vanguard'){
    const c=createPresetSkinCanvas(preset,color),ctx=c.getContext('2d');
    if(skin){const im=new Image();im.onload=()=>{try{
      // Keep generated pixels under transparent/overlay areas, and support both modern 64×64 and classic 64×32 skins.
      if(im.naturalWidth===64&&im.naturalHeight===32){ctx.drawImage(im,0,0,64,32);ctx.drawImage(c,40,16,16,16,32,48,16,16);ctx.drawImage(c,0,16,16,16,16,48,16,16);}
      else if(im.naturalWidth>=64&&im.naturalHeight>=64)ctx.drawImage(im,0,0,64,64);
      else {ctx.imageSmoothingEnabled=false;ctx.drawImage(im,0,0,64,64);}
      c.dispatchEvent(new Event('skinready'));
    }catch{}};im.onerror=()=>{};im.src=skin;}
    return c;
  }
  equipRemoteWeapon(g,id){
    if(!g?.userData||g.userData.weaponId===id)return;const root=g.userData.weapon;root.traverse(o=>{if(o!==root&&o.geometry)o.geometry.dispose();if(o!==root&&o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});root.clear();if(id==='unarmed'){g.userData.weaponId='unarmed';return;}const w=weaponById(id),metal=new THREE.MeshStandardMaterial({color:w.color,metalness:.4,roughness:.5}),dark=new THREE.MeshStandardMaterial({color:'#25292b',roughness:.8});
    const b=(geo,mat,x,y,z,ry=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.y=ry;root.add(m);return m;};
    if(w.kind==='melee'){
      if(id==='susis_sword'){
        const voidMetal=new THREE.MeshStandardMaterial({color:'#050509',metalness:.86,roughness:.16,emissive:'#1d1247',emissiveIntensity:.85});
        const voidEdge=new THREE.MeshStandardMaterial({color:'#6d5aa8',metalness:.68,roughness:.2,emissive:'#5032aa',emissiveIntensity:1.15});
        b(new THREE.BoxGeometry(.085,.78,.045),voidMetal,0,.43,.19,-.035);
        b(new THREE.BoxGeometry(.016,.70,.012),voidEdge,.05,.43,.16,-.035);
        b(new THREE.BoxGeometry(.22,.045,.075),voidEdge,0,.05,.19);
        b(new THREE.BoxGeometry(.07,.18,.06),dark,0,-.08,.19);
      }else if(id==='bat'){
        b(new THREE.CylinderGeometry(.075,.048,.56,10),new THREE.MeshStandardMaterial({color:'#8a5736',roughness:.78}),0,.30,.16,0);
        b(new THREE.CylinderGeometry(.045,.045,.08,8),dark,0,.01,.16,0);
      }else if(id==='hammer'){
        b(new THREE.BoxGeometry(.06,.47,.06),dark,0,.27,.16,-.08);
        b(new THREE.BoxGeometry(.26,.14,.13),metal,0,.53,.16);
      }else if(id==='axe'){
        b(new THREE.BoxGeometry(.055,.46,.055),dark,0,.27,.16,-.08);
        b(new THREE.BoxGeometry(.22,.2,.07),metal,.09,.43,.16,-.12);
      }else{
        b(new THREE.BoxGeometry(.065,id==='sword'?.59:.42,.055),metal,0,id==='sword'?.34:.25,.16,-.08);b(new THREE.BoxGeometry(.09,.14,.08),dark,0,.02,.16);
      }
    }else{
      const len=(w.id==='vizblaster'||w.id==='shotgun')?.48:w.category==='sniper'?.58:.37;
      b(new THREE.BoxGeometry(.13,.12,.32),metal,0,.02,.1);
      b(new THREE.BoxGeometry(.09,.105,.2),dark,0,-.01,.18);
      b(new THREE.BoxGeometry(.055,.18,.075),dark,0,-.12,.05);
      b(new THREE.BoxGeometry(.045,.045,.18),dark,0,.085,.06);
      b(new THREE.CylinderGeometry(w.id==='vizblaster'?.04:.023,w.id==='vizblaster'?.04:.025,len,8),dark,0,.02,.29+len*.35);
      b(new THREE.CylinderGeometry(w.id==='vizblaster'?.05:.03,w.id==='vizblaster'?.05:.025,.05,8),metal,0,.02,.29+len*.7);
      if(w.category==='sniper'){b(new THREE.CylinderGeometry(.04,.04,.22,8),dark,0,.15,.1);b(new THREE.BoxGeometry(.1,.06,.1),metal,0,.2,.1);}
      if(w.category==='shotgun'){b(new THREE.BoxGeometry(.045,.05,.28),metal,.065,-.02,.23);}
      if(w.id==='vizblaster'){b(new THREE.BoxGeometry(.14,.09,.1),metal,0,.1,.14);b(new THREE.BoxGeometry(.08,.04,.07),new THREE.MeshStandardMaterial({color:'#58d9ed',emissive:'#2ac9e5',emissiveIntensity:.8}),0,.1,.19);}
    }
    g.userData.weaponId=id;
  }
  swingRemote(id){const p=this.remote.get(id);if(p)p.swingUntil=performance.now()+360;}
  updateRemotes(records){
    const seen=new Set();
    for(const info of records||[]){if(!info||!info.id)continue;seen.add(info.id);const p=this.remote.get(info.id)||this.createRemote(info);p.info={...p.info,...info};p.target.set(info.x??p.target.x,info.y??p.target.y,info.z??p.target.z);p.yaw=info.yaw??p.yaw;p.pitch=info.pitch??p.pitch;if(info.motion&&info.motion!==p.motion)p.motionStartedAt=performance.now();p.motion=info.motion||'stand';p.motionUntil=info.motionUntil??p.motionUntil??0;p.health=info.health??p.health;p.weapon=info.meleeThrown?'unarmed':(info.weapon||p.weapon);p.team=info.team??p.team;p.mesh.visible=!info.dead&&info.y>-5;this.setRemoteVehicle(p,info.vehicle||null);this.equipRemoteWeapon(p.mesh,p.weapon);}
    for(const [id,p] of this.remote){if(p.isBot)continue;if(!seen.has(id)&&records) {this.scene.remove(p.mesh);this.remote.delete(id);}}
  }
  updateRemote(info){
    if(!info||!info.id)return null;const p=this.remote.get(info.id)||this.createRemote(info);p.info={...p.info,...info};p.target.set(info.x??p.target.x,info.y??p.target.y,info.z??p.target.z);p.yaw=info.yaw??p.yaw;p.pitch=info.pitch??p.pitch;if(info.motion&&info.motion!==p.motion)p.motionStartedAt=performance.now();p.motion=info.motion||p.motion;p.motionUntil=info.motionUntil??p.motionUntil??0;p.health=info.health??p.health;p.weapon=info.meleeThrown?'unarmed':(info.weapon||p.weapon);p.team=info.team??p.team;p.mesh.visible=!info.dead&&info.y>-5;this.setRemoteVehicle(p,info.vehicle||null);this.equipRemoteWeapon(p.mesh,p.weapon);return p;
  }
  removeRemote(id){const p=this.remote.get(id);if(p){this.scene.remove(p.mesh);this.disposeObject(p.mesh,true);this.remote.delete(id);this.bots.delete(id);}}
  showTracer(originValues,directionValues,range,color='#e1f6e7'){
    const origin=new THREE.Vector3(...originValues),direction=new THREE.Vector3(...directionValues).normalize();const end=origin.clone().addScaledVector(direction,range);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin,end]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.88}));this.scene.add(line);this.tracers.push({object:line,life:.095,max:.095});
  }
  setBotState(id,patch){const p=this.bots.get(id);if(!p)return;Object.assign(p.info,patch);if(patch.x!==undefined)p.target.x=patch.x;if(patch.y!==undefined)p.target.y=patch.y;if(patch.z!==undefined)p.target.z=patch.z;if(patch.yaw!==undefined)p.yaw=patch.yaw;if(patch.motion)p.motion=patch.motion;if(patch.weapon){p.weapon=patch.weapon;this.equipRemoteWeapon(p.mesh,patch.weapon);}if(patch.vehicle!==undefined)this.setRemoteVehicle(p,patch.vehicle||null);if(patch.dead!==undefined)p.mesh.visible=!patch.dead;}
  getAim(){
    // Input events can run between render frames. Build aim from the newest mouse-look
    // values instead of reading a camera quaternion that may still be one frame behind.
    const p=this.local,n=performance.now();
    const eye=p.motion==='crawl'?.72:(p.motion==='crouch'||p.motion==='slide')?1.12:1.62;
    const flipProgress=p.motion==='backflip'?clamp(1-(p.motionUntil-n)/950,0,1):0;
    const aimPitch=this.pitch-this.cameraRecoil+flipProgress*Math.PI*2;
    const cp=Math.cos(aimPitch);
    const direction=new THREE.Vector3(-Math.sin(this.yaw)*cp,Math.sin(aimPitch),-Math.cos(this.yaw)*cp).normalize();
    return {origin:new THREE.Vector3(p.x,p.y+eye,p.z),direction};
  }
  playerHitboxes(pos,motion='stand'){return sharedPlayerHitboxes(pos,motion);}
  raycastMap(origin,direction,maxDistance){
    let closest=maxDistance;const checked=new Set(),cell=this.collisionCell||8;
    for(const [gx,gz] of rayGridCells(origin,direction,maxDistance,cell)){
      for(const collider of this.collisionGrid.get(`${gx},${gz}`)||[]){
        if(checked.has(collider))continue;checked.add(collider);
        const t=intersectAABB(origin,direction,collider,closest);if(t!==null&&t<closest)closest=t;
      }
    }
    return closest;
  }
  castShot(weaponId,ignoreId=null,directionOverride=null,originOverride=null){
    const w=weaponById(weaponId),aim=this.getAim(),origin=originOverride||aim.origin,direction=(directionOverride||aim.direction).clone().normalize();let maxDistance=w.range,blockT=this.raycastMap(origin,direction,maxDistance);
    if(this.mapData?.raycastMeshes?.length){this.mapRaycaster.set(origin,direction);this.mapRaycaster.near=0;this.mapRaycaster.far=blockT;const hits=this.mapRaycaster.intersectObjects(this.mapData.raycastMeshes,false);if(hits.length)blockT=Math.min(blockT,hits[0].distance);}
    let found=null,closest=blockT;
    for(const [id,p] of this.remote){if(id===ignoreId||!p.mesh.visible)continue;const pos=p.mesh.position;for(const box of this.playerHitboxes(pos,p.motion||p.info.motion||'stand')){const t=intersectAABB(origin,direction,box,closest);if(t!==null&&t<closest){closest=t;found={id,head:box.head,distance:t,part:box.part};}}}
    return found;
  }
  fireVisual(weaponId){
    const w=weaponById(weaponId);this.vmRecoil=Math.min(.28,this.vmRecoil+w.recoil*3);this.cameraRecoil=Math.min(.13,this.cameraRecoil+w.recoil*.42);this.vmSwing=1;if(weaponId==='vizblaster'&&this.vmPump){this.vmPump.position.z=this.vmPumpBaseZ-.105;this.vmPump.userData.pumped=true;}
    if(w.kind==='gun'&&this.vmMuzzle){this.vmMuzzle.material.opacity=.95;this.vmMuzzle.scale.setScalar(.8+Math.random()*.8);}
    const {origin,direction}=this.getAim();let block=this.raycastMap(origin,direction,w.range),end=origin.clone().addScaledVector(direction,block);
    if(this.mapData?.raycastMeshes?.length){this.mapRaycaster.set(origin,direction);this.mapRaycaster.near=0;this.mapRaycaster.far=block;const hits=this.mapRaycaster.intersectObjects(this.mapData.raycastMeshes,false);if(hits.length&&hits[0].distance<block){block=hits[0].distance;end=origin.clone().addScaledVector(direction,block);}}
    for(const [id,p] of this.remote){if(!p.mesh.visible)continue;for(const hitbox of this.playerHitboxes(p.target,p.motion||p.info.motion||'stand')){const t=intersectAABB(origin,direction,hitbox,block);if(t!==null&&t<block){block=t;end=origin.clone().addScaledVector(direction,t);}}}
    const start=origin.clone().addScaledVector(direction,.6);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),new THREE.LineBasicMaterial({color:w.color,transparent:true,opacity:.88}));this.scene.add(line);this.tracers.push({object:line,life:.095,max:.095});
    if(w.kind==='gun'&&(w.auto||w.category==='shotgun'||w.category==='pistol')){const shell=new THREE.Mesh(new THREE.BoxGeometry(.018,.018,.06),new THREE.MeshStandardMaterial({color:'#cfaa62',metalness:.55,roughness:.35}));const worldOrigin=this.camera.localToWorld(new THREE.Vector3(.22,-.18,-.28));shell.position.copy(worldOrigin);this.scene.add(shell);this.fx.push({object:shell,life:.65,v:new THREE.Vector3(.9+Math.random(),1+Math.random()*1.5,.6),gravity:5});}
  }
  swingVisual(){this.vmSwing=1;}
  makeImpact(point,color='#d6d4c3'){
    const geom=new THREE.SphereGeometry(.05,5,4),mat=new THREE.MeshBasicMaterial({color});const m=new THREE.Mesh(geom,mat);m.position.copy(point);this.scene.add(m);this.fx.push({object:m,life:.3,v:new THREE.Vector3((Math.random()-.5)*1.4,1,(Math.random()-.5)*1.4),gravity:7});
  }
  getNearby(x,z){const keyX=Math.floor(x/this.collisionCell),keyZ=Math.floor(z/this.collisionCell),out=[];for(let a=keyX-1;a<=keyX+1;a++)for(let b=keyZ-1;b<=keyZ+1;b++){const list=this.collisionGrid.get(`${a},${b}`);if(list)out.push(...list);}return out;}
  floorAt(x,z,y){let floor=0;for(const b of this.getNearby(x,z)){if(Math.abs(x-b.x)<=b.w/2-.02&&Math.abs(z-b.z)<=b.d/2-.02){const top=b.y+b.h;if(top<=y+.35&&top>=0)floor=Math.max(floor,top);}}return floor;}
  floorBetween(x,z,oldY,newY){let floor=0;for(const b of this.getNearby(x,z)){if(b.w<.75||b.d<.75||Math.abs(x-b.x)>Math.max(0,b.w/2-.16)||Math.abs(z-b.z)>Math.max(0,b.d/2-.16))continue;const top=b.y+b.h;if(top<=oldY+.12&&top>=newY-.12&&top>=floor)floor=top;}return floor;}
  canOccupy(x,z,y,height){
    for(const b of this.getNearby(x,z)){
      const nearestX=clamp(x,b.x-b.w/2,b.x+b.w/2),nearestZ=clamp(z,b.z-b.d/2,b.z+b.d/2);
      const dx=x-nearestX,dz=z-nearestZ;if(dx*dx+dz*dz>.36)continue;
      const top=b.y+b.h;if(y>=top-.08)continue;if(y+height<=b.y+.03)continue;
      return false;
    }
    return true;
  }
  tryMoveAxis(axis,amount,height){
    const p=this.local;if(Math.abs(amount)<1e-6)return;
    const nx=axis==='x'?clamp(p.x+amount,-WORLD_LIMIT,WORLD_LIMIT):p.x;
    const nz=axis==='z'?clamp(p.z+amount,-WORLD_LIMIT,WORLD_LIMIT):p.z;
    if(this.canOccupy(nx,nz,p.y,height)){if(axis==='x')p.x=nx;else p.z=nz;return;}
    // Controlled step-up: only raise a grounded player onto a low obstacle if the full capsule fits above it.
    if(p.grounded&&p.vy<=0){let stepTop=null;for(const b of this.getNearby(nx,nz)){const nearX=clamp(nx,b.x-b.w/2,b.x+b.w/2),nearZ=clamp(nz,b.z-b.d/2,b.z+b.d/2);if((nx-nearX)**2+(nz-nearZ)**2>.36)continue;const top=b.y+b.h;if(top>p.y+.03&&top<=p.y+.34)stepTop=Math.max(stepTop??0,top);}
      if(stepTop!==null&&this.canOccupy(nx,nz,stepTop,height)){p.y=stepTop;p.vy=0;p.grounded=true;if(axis==='x')p.x=nx;else p.z=nz;return;}}
    if(axis==='x')p.vx=0;else p.vz=0;
  }
  recoverStuckPlayer(){const p=this.local,now=performance.now(),height=p.motion==='crawl'?.58:(p.motion==='crouch'||p.motion==='slide')?1.08:1.8;if(this.canOccupy(p.x,p.z,p.y,height))return;if(now<(p.lastRecovery||0))return;p.lastRecovery=now+350;
    const recover=(x,z)=>{x=clamp(x,-WORLD_LIMIT+3,WORLD_LIMIT-3);z=clamp(z,-WORLD_LIMIT+3,WORLD_LIMIT-3);const floor=this.floorAt(x,z,0);if(!this.canOccupy(x,z,floor,1.8))return false;p.x=x;p.z=z;p.y=floor;p.vx=p.vy=p.vz=0;p.grounded=true;p.motion='stand';this.callbacks.onWorldRecovery?.();return true;};
    // Prefer verified map spawn lanes; this avoids teleporting into a central landmark when trapped inside a large collider.
    for(const spawn of this.mapData?.spawns||[])if(recover(spawn.x,spawn.z))return;
    for(let radius=1;radius<=10;radius+=1){for(let i=0;i<24;i++){const a=i*Math.PI*2/24;if(recover(p.x+Math.cos(a)*radius,p.z+Math.sin(a)*radius))return;}}
    for(const x of [112,-112,108,-108,104,-104,100,-100,96,-96])for(let z=-112;z<=112;z+=4)if(recover(x,z))return;
    // Search all four perimeter lanes before the last known-safe deployment point.
    for(let v=-112;v<=112;v+=4){for(const [x,z] of [[112,v],[-112,v],[v,112],[v,-112]])if(recover(x,z))return;}
    // Rare malformed-map fallback: search the interior grid instead of depositing the player in a landmark.
    for(let x=-112;x<=112;x+=4)for(let z=-112;z<=112;z+=4)if(recover(x,z))return;
    // If generated collision is pathological, stop velocity and expose the recovery instead of
    // repeatedly applying gravity while trapped inside an impossible collider.
    p.x=0;p.y=0;p.z=0;p.vx=p.vy=p.vz=0;p.grounded=true;p.motion='stand';
    this.callbacks.onWorldRecovery?.();
  }
  updateMovement(dt,context){
    const p=this.local;
    const n=performance.now();
    const weapon=context.currentWeapon||weaponById('rifle');const id=weapon.id;const zoomFov=({sniper:10.5,marksman:16,crossbow:20,laser:34,rifle:39,burst:41,lmg:43,shotgun:48,vizblaster:46,pistol:45,revolver:40,smg:46,minigun:49})[id]??52;const scoped=this.aiming&&context.playing&&context.alive&&!this.inputFrozen;const targetFov=scoped?zoomFov:76;this.camera.fov+=(targetFov-this.camera.fov)*Math.min(1,dt*16);this.camera.updateProjectionMatrix();
    if(!context.playing||!context.alive||this.inputFrozen){p.motion=context.alive?'stand':'dead';this.mouseFire=false;return;}
    const down=key=>this.keys.has(this.bindings[key]);
    const stunned=p.motion==='stunned'&&n< p.motionUntil;const forward=stunned?0:(down('forward')?1:0)-(down('back')?1:0),side=stunned?0:(down('right')?1:0)-(down('left')?1:0);
    const mag=Math.hypot(forward,side)||1;const f=forward/mag,s=side/mag;const vehicleSpec=VEHICLES.find(v=>v.id===p.vehicleType);if(vehicleSpec&&Math.abs(side)>.01){this.yaw-=side*dt*(vehicleSpec.handling/72);p.yaw=this.yaw;p.pitch=this.pitch;}const moveSide=vehicleSpec?0:s;
    const sprint=down('sprint')&&forward>0&&p.stamina>0&&p.motion!=='crawl';
    if(vehicleSpec)p.stamina=Math.min(100,p.stamina+18*dt);else if(sprint)p.stamina=Math.max(0,p.stamina-21*dt);else p.stamina=Math.min(100,p.stamina+14*dt);
    const crawling=down('crawl'),crouching=down('crouch');
    let desired='stand';if(crawling)desired='crawl';else if(crouching)desired='crouch';else if(sprint&&Math.abs(f)+Math.abs(s)>0)desired='sprint';
    if(p.motion==='slide'&&n<p.motionUntil)desired='slide';if(p.motion==='backflip'&&n<p.motionUntil)desired='backflip';if(p.motion==='trip'&&n<p.motionUntil)desired='trip';if(p.motion==='stunned'&&n<p.motionUntil)desired='stunned';
    if(['stand','sprint'].includes(desired)&&!this.canOccupy(p.x,p.z,p.y,1.8))desired=this.canOccupy(p.x,p.z,p.y,1.08)?'crouch':'crawl';
    if(desired==='crouch'&&!this.canOccupy(p.x,p.z,p.y,1.08))desired='crawl';
    if(down('slide')&&sprint&&p.grounded&&n>(p.slideCooldown||0)){p.motion='slide';p.motionUntil=n+760;p.slideCooldown=n+1850;desired='slide';p.vx=-Math.sin(this.yaw)*f*10.6+Math.cos(this.yaw)*s*4;p.vz=-Math.cos(this.yaw)*f*10.6-Math.sin(this.yaw)*s*4;}
    if(desired!=='slide'&&desired!=='backflip'&&desired!=='trip'&&desired!=='stunned')p.motion=desired;
    let speed=crawling?1.55:crouching?2.65:sprint?8.8:5.6;
    if(vehicleSpec)speed=vehicleSpec.speed*(forward<0?.42:1);
    if(p.motion==='slide')speed=8.7;if(context.speedBoost)speed*=1.45;
    const dx=(-Math.sin(this.yaw)*f+Math.cos(this.yaw)*moveSide)*speed;
    const dz=(-Math.cos(this.yaw)*f-Math.sin(this.yaw)*moveSide)*speed;
    const moving=Math.abs(f)+Math.abs(s)>.05;
    if(p.motion!=='slide'){
      const lerp=Math.min(1,dt*(p.grounded?14:3));p.vx+=(dx-p.vx)*lerp;p.vz+=(dz-p.vz)*lerp;
    } else {p.vx*=Math.max(0,1-dt*1.3);p.vz*=Math.max(0,1-dt*1.3);}
    this.recoverStuckPlayer();
    const height=p.motion==='crawl'?.58:p.motion==='crouch'||p.motion==='slide'?1.08:1.8;
    this.tryMoveAxis('x',p.vx*dt,height);this.tryMoveAxis('z',p.vz*dt,height);
    const oldY=p.y,hovering=p.vehicleType==='rdx-hoverboard'&&Date.now()<(p.vehicleFlightUntil||0);if(hovering){p.vy=0;p.y=Math.max(p.y,p.vehicleBaseY||p.y);p.grounded=false;}else{if(p.vehicleType==='rdx-hoverboard'&&p.vehicleFlightUntil&&Date.now()>p.vehicleFlightUntil){p.vehicleFlightUntil=0;p.vy=Math.min(p.vy,-1);}p.vy-=22*dt;const nextY=p.y+p.vy*dt;const landingFloor=p.vy<=0?this.floorBetween(p.x,p.z,oldY,nextY):0;if(p.vy<=0&&nextY<=landingFloor&&oldY>=landingFloor-.18){p.y=landingFloor;p.vy=0;p.grounded=true;}else{p.y=nextY;p.grounded=false;}}
    if(!p.grounded&&p.y<-8){p.x=clamp(p.x,-WORLD_LIMIT+2,WORLD_LIMIT-2);p.z=clamp(p.z,-WORLD_LIMIT+2,WORLD_LIMIT-2);p.y=this.floorAt(p.x,p.z,0);p.vy=0;p.grounded=true;this.callbacks.onWorldRecovery?.();}
    if(p.motion==='slide'&&performance.now()>p.motionUntil)p.motion=down('crouch')?'crouch':'stand';
    if(p.motion==='backflip'&&n>p.motionUntil)p.motion='stand';if(p.motion==='trip'&&n>p.motionUntil)p.motion='stand';if(p.motion==='stunned'&&n>p.motionUntil)p.motion='stand';
    if(p.motion==='backflip'||p.motion==='trip'){}
    if(context.jumpPressed&&p.grounded&&!['crawl','slide','stunned','trip','backflip'].includes(p.motion)){p.vy=8;p.grounded=false;}
    if(p.motion==='backflip'){p.vx+=Math.sin(this.yaw)*1.5*dt;p.vz+=Math.cos(this.yaw)*1.5*dt;}
    const stunnedNow=p.motion==='stunned'&&n<p.motionUntil;const stunStart=p.motionStartedAt??n;const stunProgress=stunnedNow?clamp((n-stunStart)/Math.max(1,p.motionUntil-stunStart),0,1):1;const fall=stunnedNow?(stunProgress<.18?Math.sin(stunProgress/.18*Math.PI/2):stunProgress>.82?Math.sin((1-stunProgress)/.18*Math.PI/2):1):0;const normalEye=p.motion==='crawl'?.72:(p.motion==='crouch'||p.motion==='slide')?1.12:1.62;const eye=stunnedNow?normalEye-.58*fall:normalEye;
    this.camera.position.set(p.x,p.y+eye,p.z);const flipRaw=p.motion==='backflip'?clamp(1-(p.motionUntil-n)/950,0,1):0;const flipProgress=flipRaw*flipRaw*(3-2*flipRaw);const roll=p.motion==='slide'?.07:(stunnedNow?Math.sin(stunProgress*Math.PI)*.28:0);this.camera.rotation.set(this.pitch-this.cameraRecoil+flipProgress*Math.PI*2+(stunnedNow?fall*.18:0),this.yaw,roll,'YXZ');this.cameraRecoil=Math.max(0,this.cameraRecoil-dt*.11);const poseDrop=p.motion==='crawl'?-.2:(p.motion==='crouch'||p.motion==='slide')?-.09:stunnedNow?-.16:0;this.vmLeft.position.y=-.24+poseDrop;this.vmRight.position.y=-.25+poseDrop;
    this.vm.position.x=.31+Math.sin(this.time*8)*(moving?.006:0);this.vm.position.y=-.27+(moving?Math.abs(Math.sin(this.time*10))*.014:0);this.vm.position.z=-.52+this.vmRecoil;
    this.vmRecoil=Math.max(0,this.vmRecoil-dt*.7);this.vm.rotation.z=Math.sin(this.time*6)*(moving?.012:0);const reloadProgress=this.reloadVisualUntil>n?1-(this.reloadVisualUntil-n)/this.reloadDuration:0;this.vm.rotation.x=this.vmSwing>0?-.16-Math.sin(this.vmSwing*Math.PI)*.18:0;this.vm.rotation.x+=reloadProgress>0?Math.sin(reloadProgress*Math.PI)*.34:0;this.vmWeapon.position.y=(this.vmWeapon.userData.baseY??-.025)+(reloadProgress>0?Math.sin(reloadProgress*Math.PI)*-.16:0);this.vmSwing=Math.max(0,this.vmSwing-dt*3.4);if(this.vmPump){const target=this.vmPumpBaseZ+(this.vmPump.userData.pumped?-.105:0);this.vmPump.position.z+=(target-this.vmPump.position.z)*Math.min(1,dt*24);if(Math.abs(this.vmPump.position.z-target)<.008)this.vmPump.userData.pumped=false;}
    if(this.vmMuzzle)this.vmMuzzle.material.opacity=Math.max(0,this.vmMuzzle.material.opacity-dt*14);
    this.bob+=dt*(moving?(sprint?13:8):1.8);this.vmLeft.rotation.x=moving?Math.sin(this.bob)*.04:0;this.vmRight.rotation.x=moving?Math.sin(this.bob+1.2)*.035:0;
    if(!moving&&p.motion==='stand')this.vm.rotation.z*=.85;
    if(this.mouseFire&&context.currentWeapon?.kind==='gun'&&context.currentWeapon.auto&&context.canFire) this.callbacks.onAutoFire?.();
    // Pickups are collected locally and the room server resolves their cooldown/effect.
    for(const pickup of this.pickups){if(!pickup.userData.active)continue;pickup.rotation?.set?.(0,this.time*.5,0);pickup.position.y=Math.sin(this.time*2+pickup.userData.type)*.12;if(Math.hypot(p.x-pickup.userData.x,p.z-pickup.userData.z)<1.55){this.callbacks.onPickup?.(pickup.userData);pickup.userData.active=false;pickup.visible=false;}}
  }
  animateRemote(dt){
    for(const p of this.remote.values()){
      if(!p.mesh.visible)continue;const pos=p.mesh.position;const before=pos.clone();pos.lerp(p.target,Math.min(1,dt*13));p.mesh.rotation.y=p.yaw+Math.PI;p.phase+=dt*(p.motion==='sprint'?13:8);
      const d=p.mesh.userData;if(!d?.rig)continue;const rig=d.rig,base=d.basePose;
      for(const [part,xyz] of Object.entries(base)){d[part].position.set(...xyz);d[part].rotation.set(0,0,0);}
      rig.position.set(0,1,0);rig.rotation.set(0,0,0);d.label.position.y=2.34;
      const isMoving=before.distanceTo(p.target)>.015||['sprint','walk','slide','crawl'].includes(p.motion);const walk=isMoving?Math.sin(p.phase)*.56:0;const riding=!!p.vehicleType;if(riding){d.rl.visible=false;d.ll.visible=false;d.body.rotation.x=.12;d.ra.rotation.x=-.22;d.la.rotation.x=-.22;d.ra.rotation.z=-.15;d.la.rotation.z=.15;d.label.position.y=2.45;}else{d.rl.visible=true;d.ll.visible=true;d.ra.rotation.z=0;d.la.rotation.z=0;}
      if(p.motion==='crouch'||p.motion==='slide'){
        d.head.position.set(0,.505,0);d.body.position.set(0,-.06,p.motion==='slide'?.12:0);d.ra.position.y=d.la.position.y=.325;d.rl.position.y=d.ll.position.y=-.195;
        d.body.rotation.x=p.motion==='slide'?.38:.08;d.ra.rotation.x=-.75+walk*.25;d.la.rotation.x=-.78-walk*.25;d.rl.rotation.x=.35;d.ll.rotation.x=.35;d.label.position.y=1.82;
        if(p.motion==='slide')rig.rotation.z=Math.sin(p.phase)*-.16;
      }else if(p.motion==='crawl'){
        d.head.position.set(0,-.18,-.43);d.body.position.set(0,-.65,-.06);d.body.rotation.x=-Math.PI/2;
        d.ra.position.set(-.38,-.115,-.02);d.la.position.set(.38,-.115,-.02);d.ra.rotation.x=-1.35;d.la.rotation.x=-1.35;
        d.rl.position.set(-.125,-.405,.24);d.ll.position.set(.125,-.405,.24);d.rl.rotation.x=-1.32+walk*.1;d.ll.rotation.x=-1.32-walk*.1;d.label.position.y=1.14;
      }else if(p.motion==='backflip'){
        const until=p.motionUntil||0;const progress0=until>Date.now()?clamp(1-(until-Date.now())/950,0,1):clamp((performance.now()-(p.motionStartedAt||performance.now()))/950,0,1);const progress=progress0*progress0*(3-2*progress0);
        rig.rotation.x=Math.PI*2*progress;rig.position.y=1+Math.sin(progress*Math.PI)*.62;d.body.rotation.x=.1+Math.sin(progress*Math.PI)*.28;d.ra.rotation.x=-1.35;d.la.rotation.x=-1.28;d.rl.rotation.x=.85;d.ll.rotation.x=.85;
      }else if(p.motion==='trip'||p.motion==='stunned'){
        rig.rotation.x=.52;rig.position.y=.86;d.body.rotation.x=.28;d.head.rotation.x=-.18;d.ra.rotation.x=-1.18;d.la.rotation.x=.35;d.rl.rotation.x=-.28;d.ll.rotation.x=-.4;d.label.position.y=1.95;
      }else{
        d.ra.rotation.x=walk;d.la.rotation.x=-walk;d.rl.rotation.x=-walk;d.ll.rotation.x=walk;
        d.head.rotation.x=clamp(-p.pitch*.65,-.8,.8);if(p.info?.aiming)d.ra.rotation.x-=.25;
      }
      if(p.swingUntil>performance.now()){
        const swingT=1-(p.swingUntil-performance.now())/360,arc=Math.sin(clamp(swingT,0,1)*Math.PI);
        d.ra.rotation.x=-1.25*arc;d.ra.rotation.z=-.25*arc;d.la.rotation.x=.18*arc;
        if(d?.weapon){d.weapon.rotation.x=-.85*arc;d.weapon.rotation.z=.18*arc;}
      }else if(d?.weapon){d.weapon.rotation.x=p.info?.aiming?.06:0;d.weapon.rotation.z=0;}
    }
  }
  update(dt,context){
    this.time+=dt;this.frameEma=this.frameEma*.94+Math.min(.1,Math.max(0,dt))*.06;if(performance.now()>this.perfCheckAt){this.perfCheckAt=performance.now()+5000;if(!this.thermalFallback&&this.frameEma>.024){this.thermalFallback=true;this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,.58));this.renderer.shadowMap.enabled=false;this.sun.castShadow=false;this.renderer.setSize(innerWidth,innerHeight,false);this.callbacks.onPerformanceFallback?.();}}this.updateMovement(dt,context);if(this.localVehicleRoot&&this.local.vehicleType){this.localVehicleRoot.position.set(this.local.x,this.local.y,this.local.z);this.localVehicleRoot.rotation.y=this.yaw+Math.PI;this.localVehicleRoot.visible=!!context.alive;if(this.local.vehicleType==='rdx-hoverboard'&&Date.now()<(this.local.vehicleFlightUntil||0)){this.localVehicleRoot.position.y+=.08+Math.sin(this.time*4)*.07;}}this.animateRemote(dt);this.updateMeleeDrops(dt);for(const [droneId,drone] of this.drones){if(Date.now()>=drone.expiresAt){this.removeDrone(droneId);continue;}drone.phase+=dt*2.2;drone.root.rotation.y+=dt*1.7;if(drone.owner==='local'){drone.x=this.local.x+Math.cos(drone.phase)*1.5;drone.y=this.local.y+3.3+Math.sin(drone.phase*1.5)*.22;drone.z=this.local.z+Math.sin(drone.phase)*1.5;drone.root.position.set(drone.x,drone.y,drone.z);}}for(const effect of this.airstrikeEffects){effect.life-=dt;effect.elapsed+=dt;effect.root.children[0].material.opacity=Math.max(0,effect.life/effect.max);const scale=1+effect.elapsed*1.5;effect.root.children[0].scale.setScalar(scale);for(let i=1;i<effect.root.children.length;i++)effect.root.children[i].material.opacity=Math.max(0,.52-effect.elapsed*.23);}for(let i=this.airstrikeEffects.length-1;i>=0;i--){const e=this.airstrikeEffects[i];if(e.life<=0){this.scene.remove(e.root);this.disposeObject(e.root,true);this.airstrikeEffects.splice(i,1);}}if(this.blackHoleVisual){const p=(performance.now()-this.blackHoleVisual.started)/1000;this.blackHoleVisual.root.rotation.y+=dt*.85;this.blackHoleVisual.accretion.rotation.z+=dt*1.6;this.blackHoleVisual.ring2.rotation.z-=dt*.9;const sc=1+Math.sin(p*4)*.05;this.blackHoleVisual.root.scale.setScalar(sc);}for(const flag of this.flagVisuals.values()){if(flag.userData.cloth)flag.userData.cloth.rotation.z=Math.sin(this.time*3+flag.userData.phase)*.075;}
    if(!this.active){this.camera.position.set(35+Math.cos(this.time*.08)*84,34+Math.sin(this.time*.04)*3,38+Math.sin(this.time*.08)*84);this.camera.lookAt(0,2,0);this.vm.visible=false;}else{this.vm.visible=!!context.alive;if(this.weaponVisualId==='unarmed')this.vmWeapon.visible=false;}
    for(let i=this.tracers.length-1;i>=0;i--){const f=this.tracers[i];f.life-=dt;f.object.material.opacity=Math.max(0,f.life/f.max);if(f.life<=0){this.scene.remove(f.object);f.object.geometry.dispose();f.object.material.dispose();this.tracers.splice(i,1);}}
    for(let i=this.fx.length-1;i>=0;i--){const f=this.fx[i];f.life-=dt;if(f.path){const progress=1-clamp(f.life/Math.max(.001,f.max||.15),0,1);f.object.position.lerpVectors(f.path.from,f.path.to,progress);}if(f.v&&!f.path){f.v.y-=(f.gravity||0)*dt;f.object.position.addScaledVector(f.v,dt);}if(f.expand&&f.object.scale.x<f.expand)f.object.scale.addScalar(dt*f.expand*1.7);if(f.max&&f.object.children?.length)f.object.traverse(o=>{if(o.material&&'opacity'in o.material)o.material.opacity=Math.max(0,f.life/f.max);});if(f.life<=0){this.scene.remove(f.object);f.object.traverse?.(o=>{o.geometry?.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});f.object.geometry?.dispose();f.object.material?.dispose();this.fx.splice(i,1);}}
    if(!this.active&&!this.tracers.length&&!this.fx.length&&!this.airstrikeEffects.length&&!this.blackHoleVisual){this.idleRenderAccumulator+=dt;if(this.idleRenderAccumulator<1/30)return;this.idleRenderAccumulator%=1/30;}else this.idleRenderAccumulator=0;
    this.renderer.render(this.scene,this.camera);
  }
}

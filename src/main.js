import * as THREE from 'three';
import { GameWorld } from './game.js';
import { MultiplayerClient } from './network.js';
import { MAPS, GAME_TYPES, PLAY_MODES, WEAPONS, POWERUPS, VEHICLES, vehicleById, weaponById, normalizeLoadout, allowedWeapon, activeLoadoutIds } from '../shared/game-data.js';
import { reloadDeadline, beginReload, clearReload, isReloading } from '../shared/reload-state.js';
import { SKIN_PRESETS, createPresetSkinCanvas } from './skin-presets.js';
import { rewardsForKillStreak, nextKillStreakReward } from '../shared/killstreaks.js';

const $=id=>document.getElementById(id);
const byData=(selector,root=document)=>[...root.querySelectorAll(selector)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmtKey=code=>({ShiftLeft:'L-SHIFT',ShiftRight:'R-SHIFT',ControlLeft:'L-CTRL',ControlRight:'R-CTRL',Space:'SPACE',Tab:'TAB',AltLeft:'L-ALT',AltRight:'R-ALT',Backspace:'BACKSPACE'}[code]||String(code||'').replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'').toUpperCase());
const safeText=s=>String(s??'').replace(/[<>]/g,'');

let legacy={};try{legacy=JSON.parse(localStorage.getItem('vb')||'{}');}catch{}
let prefs={name:legacy.name||`Operator${Math.floor(Math.random()*90+10)}`,col:legacy.col||'#54a8e8',hat:legacy.hat||0,skin:legacy.skin||'',skinPreset:legacy.skinPreset||'vanguard',vehicle:legacy.vehicle||'atlas-cycle',showControls:legacy.showControls!==false,sens:Number(legacy.sens??1),vol:Number(legacy.vol??.5),quality:legacy.quality||'medium',music:legacy.music!==false,musicTrack:Number.isInteger(legacy.musicTrack)?legacy.musicTrack:0,bindings:legacy.bindings||{},loadout:legacy.loadout||{guns:['rifle','pistol'],melee:'knife'},st:{k:0,d:0,g:0,xp:0,bs:0,...(legacy.st||{})}};
let loadout=normalizeLoadout(prefs.loadout),activeGunSlot=0,loadoutTab='guns',inspectedWeapon=loadout.guns[0];
let settings={gameType:'tdm',mode:'all',map:'metro',scoreLimit:20,timeLimit:8,respawnSeconds:4,friendlyFire:false};
let network=null,online=false,isHost=false,roomCode='',hostId=null,roster=[],ready=false,localId='local',inMatch=false,dead=false,matchEnding=false,matchKind='solo',pendingMatch=null,countedThisMatch=false;
let currentWeaponId='rifle',ammoMap={},reloadsByWeapon={},lastShotAt={},powerupExpiries={},shield=0,health=100,streak=0,serverStreakSync=false,susiSwordUnlocked=false,meleeThrown=false,meleeLost=false,localMeleeDrop=null,bossThemePrevious=null,previousQuality='high';
let matchStartedAt=0,matchEndsAt=0,serverStartAt=0,deathAt=0,respawnAt=0,respawnRequested=false,deathInterval=null,localMatchEndTimer=null,lastSyncAt=0,lastHudAt=0,lastScoreboardAt=0,lastPickupRespawnAt=0;
let localScore={kills:0,deaths:0,score:0,team:0},teamScores=[0,0],offlinePlayers=[],offlineDom=[],offlineFlags=[],objectiveState=null,localCarrying=null;
let botStates=new Map(),botCounter=0,offlineGameOver=false,lastBotTick=0,lastDomScoreAt=0,lastTimeMessage=0,liveRoster=[];
let AudioCtx=null, lastAudioAt=0, musicTimer=null, musicStarting=false, musicStep=0, musicTrackIndex=Number.isInteger(prefs.musicTrack)?((prefs.musicTrack%4)+4)%4:0;

const $menu=$('menu'),$loadoutScreen=$('loadoutScreen'),$hud=$('hud'),$lobbyPanel=$('lobbyPanel'),$pausePanel=$('pausePanel'),$deathPanel=$('deathPanel'),$matchEndPanel=$('matchEndPanel');
const bootStartedAt=performance.now();
let bootValue=8,bootTimer=null;
const bootMessages=['Preparing your arena…','Loading combat systems…','Tuning the renderer…','Checking player controls…'];
const BOOT_QUOTES=[
  'The entire game was built in 3 hours.',
  'Viz is a visionary but his vision is scary.',
  'A loves B.',
  'We found Hana for Megumi.',
  'My friend loves a Goat, literally.',
  'Get canned.',
  'Aim first. Panic second.',
  'Your respawn timer is shorter than your group chat arguments.',
  'Somewhere, a training dummy is filing a complaint.',
  'Remember: cover is a strategy, not a personality.',
  'Patch notes said “minor fixes”. The bugs disagreed.',
  'The respawn button believes in second chances.',
  'Your crosshair is trying its best.',
  'Professional aim sold separately.',
  'The map is large. Your excuses are larger.',
  'The server trusts nobody. Especially your aim.',
  'Reloading: the official timeout for poor decisions.',
  'If you are lost, follow the sound of questionable tactics.',
  'Cover is temporary. The kill feed is forever.',
  'Every missed shot supports the local wall industry.'
];
const bootQuote=BOOT_QUOTES[Math.floor(Math.random()*BOOT_QUOTES.length)];
const bootFact=$('bootFactText');if(bootFact)bootFact.textContent=bootQuote;
function updateBoot(value,message){
  bootValue=Math.max(bootValue,Math.min(100,value));
  const bar=$('bootProgressBar'),percent=$('bootPercent'),status=$('bootStatus');
  if(bar)bar.style.width=`${bootValue}%`;if(percent)percent.textContent=`${String(Math.round(bootValue)).padStart(2,'0')}%`;if(status&&message)status.textContent=message;
}
bootTimer=setInterval(()=>{
  if(bootValue>=91)return;
  updateBoot(bootValue+(bootValue<35?7:bootValue<65?3.5:1.4),bootMessages[Math.min(3,Math.floor(bootValue/25))]);
},100);
function finishBoot(){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const wait=Math.max(0,1550-(performance.now()-bootStartedAt));
    setTimeout(()=>{clearInterval(bootTimer);updateBoot(100,'Ready to deploy.');const loader=$('bootLoader');loader?.classList.add('is-done');setTimeout(()=>loader?.remove(),650);},wait);
  }));
}

const game=new GameWorld($('game-canvas'));
game.setSensitivity(prefs.sens);
game.setQuality(prefs.quality);
Object.assign(game.bindings,prefs.bindings||{});

const bindingLabels={forward:'Move forward',back:'Move backward',left:'Strafe left',right:'Strafe right',sprint:'Sprint',crouch:'Crouch',slide:'Slide',backflip:'Backflip',crawl:'Crawl / prone',trip:'Trip',throwMelee:'Throw / pick up melee (Y)',blackhole:'Susi’s Sword: black hole (B)',vehicle:'Deploy / exit selected vehicle (H)',reload:'Reload',jump:'Jump',interact:'Interact',slot1:'Weapon slot 1',slot2:'Weapon slot 2',slot3:'Weapon slot 3',previous:'Previous weapon',next:'Next weapon',scores:'Scoreboard'};
const defaultLoadoutNote='Equip exactly two guns and one melee weapon. Mode restrictions are applied automatically.';
const getSettings=()=>({gameType:$('gameType').value,mode:$('playMode').value,map:$('mapSelect').value,scoreLimit:+$('scoreLimit').value,timeLimit:+$('timeLimit').value,respawnSeconds:+$('respawnDelay').value,friendlyFire:false});
const setField=(id,value)=>{const el=$(id);if(el&&value!==undefined&&value!==null)el.value=String(value);};
function savePrefs(){prefs.name=$('nameInput').value||'Operator';prefs.col=$('colorInput').value||'#54a8e8';prefs.hat=+$('hatInput').value||0;if($('skinPreset'))prefs.skinPreset=$('skinPreset').value||'vanguard';prefs.loadout=normalizeLoadout(loadout);if($('vehicleSelect'))prefs.vehicle=$('vehicleSelect').value||prefs.vehicle||'atlas-cycle';prefs.st=prefs.st||{k:0,d:0,g:0,xp:0,bs:0};try{localStorage.setItem('vb',JSON.stringify(prefs));}catch{} }
function updateStats(){const s=prefs.st||{};$('statKills').textContent=s.k||0;$('statDeaths').textContent=s.d||0;$('statKD').textContent=((s.k||0)/Math.max(1,s.d||0)).toFixed(2);$('statMatches').textContent=s.g||0;$('statStreak').textContent=s.bs||0;$('level').textContent=String(1+Math.floor((s.xp||0)/100)).padStart(2,'0');}
function showToast(message,kind=''){const t=document.createElement('div');t.className=`toast ${kind}`;t.textContent=message;$('toastStack').append(t);setTimeout(()=>t.remove(),3300);}
function centerMessage(message,duration=1700){$('centerMessage').textContent=message;clearTimeout(centerMessage.timer);centerMessage.timer=setTimeout(()=>{$('centerMessage').textContent='';},duration);}
function sound(f=180,d=.1,type='sawtooth',vol=.1,f2=70){try{if(prefs.vol<=0)return;AudioCtx=AudioCtx||new AudioContext();if(AudioCtx.state==='suspended')AudioCtx.resume();const t=AudioCtx.currentTime,o=AudioCtx.createOscillator(),g=AudioCtx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(Math.max(20,f2),t+d);g.gain.setValueAtTime(Math.min(.9,vol*prefs.vol),t);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(AudioCtx.destination);o.start(t);o.stop(t+d);}catch{}}
function weaponSound(w){const gun=w.kind==='gun';if(!gun){sound(240,.11,'triangle',.22,90);return;}const base=w.category==='sniper'?115:w.category==='shotgun'?100:w.category==='pistol'?185:w.category==='smg'?220:150; sound(base+Math.random()*45,w.category==='sniper'?.22:.09,'sawtooth',w.category==='sniper'?.34:.22,45);if(w.id==='laser')sound(800,.07,'sine',.13,250);}
function boom(){sound(110,.62,'sine',.7,26);sound(68,.46,'sawtooth',.24,24);}
const MUSIC_TRACKS=[
  {name:'NEON PATROL',root:110,scale:[0,3,5,7,10],melody:[0,2,4,2,1,3,2,4,0,2,3,1,4,3,2,1],tempo:255,wave:'triangle'},
  {name:'FRONTLINE PULSE',root:98,scale:[0,2,5,7,9],melody:[0,3,2,4,1,2,4,3,0,2,1,4,3,2,1,2],tempo:285,wave:'sine'},
  {name:'DUST CIRCUIT',root:123.47,scale:[0,2,3,7,10],melody:[0,1,3,4,2,1,4,3,0,2,4,1,3,2,1,4],tempo:235,wave:'triangle'},
  {name:'FINAL BOSS / SINGULARITY',root:55,scale:[0,1,5,6,10],melody:[0,4,2,3,1,4,3,2,0,3,4,1,2,4,1,3],tempo:205,wave:'sawtooth'},
];
function musicTone(freq,duration=.2,wave='triangle',level=.025,endFreq=0){
  if(!AudioCtx||prefs.vol<=0)return;
  const t=AudioCtx.currentTime,osc=AudioCtx.createOscillator(),gain=AudioCtx.createGain(),filter=AudioCtx.createBiquadFilter();
  osc.type=wave;osc.frequency.setValueAtTime(Math.max(24,freq),t);if(endFreq)osc.frequency.exponentialRampToValueAtTime(Math.max(24,endFreq),t+duration*.7);
  filter.type='lowpass';filter.frequency.setValueAtTime(wave==='sine'?1700:2600,t);filter.Q.value=.5;
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,level*prefs.vol),t+.018);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(filter).connect(gain).connect(AudioCtx.destination);osc.start(t);osc.stop(t+duration+.025);
}
function playMusicStep(){
  if(!AudioCtx||AudioCtx.state==='closed'||!prefs.music)return;
  const track=MUSIC_TRACKS[musicTrackIndex],step=musicStep%16,semi=track.scale[track.melody[step]],octave=step%8===0?4:step%4===0?3:2;
  if([0,2,4,6,8,10,12,14].includes(step))musicTone(track.root*Math.pow(2,semi/12)*Math.pow(2,octave-1),.19,track.wave,.019);
  if(step%4===0)musicTone(track.root/2,.27,'triangle',.035,track.root/3.2);
  if(step===0||step===8)musicTone(66,.14,'sine',.045,34);
  if(step===4||step===12)musicTone(185,.09,'triangle',.012,110);
  if(step===0||step===8){const chord=[0,track.scale[2],track.scale[4]];for(let i=0;i<chord.length;i++)musicTone(track.root*Math.pow(2,chord[i]/12),.72,'sine',.008);}
  musicStep++;
}
function refreshMusicUI(){
  const toggles=[$('musicToggle'),$('musicTogglePause')],names=[$('musicTrackName'),$('musicTrackPauseName')];
  for(const toggle of toggles)if(toggle){toggle.textContent=prefs.music?'MUSIC ON':'MUSIC OFF';toggle.setAttribute('aria-pressed',String(!!prefs.music));}
  for(const name of names)if(name)name.textContent=MUSIC_TRACKS[musicTrackIndex].name;
}
function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
async function startMusic(){
  if(!prefs.music||musicTimer||musicStarting)return;
  musicStarting=true;
  try{AudioCtx=AudioCtx||new AudioContext();if(AudioCtx.state==='suspended')await AudioCtx.resume();if(!prefs.music)return;musicStep=0;playMusicStep();musicTimer=setInterval(playMusicStep,MUSIC_TRACKS[musicTrackIndex].tempo);refreshMusicUI();}
  catch{}finally{musicStarting=false;}
}
function setMusicEnabled(enabled){prefs.music=!!enabled;if(prefs.music)startMusic();else stopMusic();savePrefs();refreshMusicUI();}
function nextMusicTrack(){musicTrackIndex=(musicTrackIndex+1)%MUSIC_TRACKS.length;prefs.musicTrack=musicTrackIndex;musicStep=0;stopMusic();savePrefs();refreshMusicUI();if(prefs.music)startMusic();}
function enterBossTheme(){if(bossThemePrevious!==null)return;bossThemePrevious=musicTrackIndex;musicTrackIndex=3;musicStep=0;stopMusic();refreshMusicUI();if(prefs.music)startMusic();}
function exitBossTheme(){if(bossThemePrevious===null)return;musicTrackIndex=bossThemePrevious;bossThemePrevious=null;musicStep=0;stopMusic();refreshMusicUI();if(prefs.music)startMusic();}
$('musicToggle').addEventListener('click',()=>setMusicEnabled(!prefs.music));
$('musicTogglePause').addEventListener('click',()=>setMusicEnabled(!prefs.music));
$('musicNext').addEventListener('click',nextMusicTrack);
$('musicNextPause').addEventListener('click',nextMusicTrack);
refreshMusicUI();
// Start only after a normal player interaction so browsers' audio autoplay rules are respected.
document.addEventListener('click',()=>{if(prefs.music)startMusic();},{once:true});

function weaponMode(){return settings.mode;}
function modeAllowed(id){if(id==='susis_sword')return !!susiSwordUnlocked;return allowedWeapon(weaponById(id),settings.mode);}
function allowedSlotIndexes(){if(settings.mode==='melee')return [2];if(settings.mode==='pistol'||settings.mode==='sniper')return [0,1].filter(i=>modeAllowed(loadout.guns[i]));return [0,1,2];}
function weaponForSlot(slot){return slot===2?(susiSwordUnlocked?'susis_sword':loadout.melee):loadout.guns[slot];}
function activeWeaponList(){const ids=allowedSlotIndexes().map(weaponForSlot);if(susiSwordUnlocked)ids.push('susis_sword');return [...new Set(ids)].filter(id=>id&&(!meleeThrown||weaponById(id).kind!=='melee'));}
function defaultWeaponForMode(){const list=activeWeaponList();return list[0]||loadout.melee;}
function adaptLoadoutToMode(mode){
  if(mode==='pistol'){const ids=WEAPONS.filter(w=>w.kind==='gun'&&w.category==='pistol').map(w=>w.id);loadout.guns=ids.slice(0,2);}
  else if(mode==='sniper'){const ids=WEAPONS.filter(w=>w.kind==='gun'&&w.category==='sniper').map(w=>w.id);loadout.guns=ids.slice(0,2);}
  loadout=normalizeLoadout(loadout);if(!modeAllowed(currentWeaponId))currentWeaponId=defaultWeaponForMode();prefs.loadout=loadout;savePrefs();
}
function updateModeDescription(){const g=GAME_TYPES.find(m=>m.id===$('gameType').value)||GAME_TYPES[0],m=PLAY_MODES.find(x=>x.id===$('playMode').value)||PLAY_MODES[0];$('modeDescription').textContent=`${g.description} ${m.description}`;$('previewMapName').textContent=(MAPS.find(x=>x.id===$('mapSelect').value)||MAPS[0]).name.toUpperCase();$('previewMapSub').textContent=(MAPS.find(x=>x.id===$('mapSelect').value)||MAPS[0]).subtitle.toUpperCase();}
function setSettingsUI(s){setField('gameType',s.gameType);setField('playMode',s.mode);setField('mapSelect',s.map);setField('scoreLimit',s.scoreLimit);setField('timeLimit',s.timeLimit);setField('respawnDelay',s.respawnSeconds);settings={...settings,...s};updateModeDescription();}
function updateMapPreview(rebuild=true){updateModeDescription();if(rebuild&&!inMatch)game.buildMap($('mapSelect').value);}
for(const m of MAPS)$('mapSelect').add(new Option(`${m.name.toUpperCase()} · ${m.subtitle.toUpperCase()}`,m.id));
setSettingsUI(settings);setField('nameInput',prefs.name);setField('colorInput',prefs.col);setField('hatInput',prefs.hat);if($('skinPreset'))$('skinPreset').value=prefs.skinPreset;setField('sensitivity',prefs.sens);setField('volume',prefs.vol);setField('quality',prefs.quality);setField('vehicleSelect',prefs.vehicle);updateStats();

function bindingUI(){const root=$('keybinds');root.innerHTML='';for(const [action,label] of Object.entries(bindingLabels)){const row=document.createElement('div');row.className='bind-item';const name=document.createElement('span');name.textContent=label;const btn=document.createElement('button');btn.textContent=fmtKey(game.bindings[action]);btn.addEventListener('click',()=>{btn.textContent='PRESS KEY…';btn.classList.add('listening');game.captureNextKey(code=>{const old=game.bindings[action];const other=Object.keys(game.bindings).find(k=>k!==action&&game.bindings[k]===code);if(other)game.bindings[other]=old;game.bindings[action]=code;prefs.bindings={...game.bindings};savePrefs();bindingUI();showToast(`${label}: ${fmtKey(code)}`);});});row.append(name,btn);root.append(row);}}
bindingUI();

// Skin support: local PNG files are reliable; username lookup is optional and may be blocked by browser/CORS policy.
function drawSkinPreview(src=prefs.skin){const canvas=$('skinPreview'),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.drawImage(createPresetSkinCanvas(prefs.skinPreset,prefs.col),0,0,64,64);if(!src)return;const im=new Image();im.onload=()=>{try{ctx.clearRect(0,0,64,64);ctx.drawImage(createPresetSkinCanvas(prefs.skinPreset,prefs.col),0,0,64,64);if(im.naturalWidth===64&&im.naturalHeight===32)ctx.drawImage(im,0,0,64,32);else ctx.drawImage(im,0,0,64,64);}catch{}};im.onerror=()=>{$('skinStatus').textContent='Could not read skin. Try uploading the PNG instead.';};im.src=src;}
$('skinPreset').value=prefs.skinPreset;drawSkinPreview(prefs.skin);$('skinPreset').addEventListener('change',()=>{prefs.skinPreset=$('skinPreset').value;prefs.skin='';$('skinStatus').textContent=`Using ${SKIN_PRESETS.find(p=>p.id===prefs.skinPreset)?.name||'default'} preset.`;drawSkinPreview();savePrefs();});
$('skinFile').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.includes('png')){showToast('Choose a PNG skin file.','warn');return;}const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{if(img.naturalWidth<64||img.naturalHeight<32){showToast('Use a Minecraft skin at least 64×32 pixels.','warn');return;}const c=createPresetSkinCanvas(prefs.skinPreset,prefs.col),cx=c.getContext('2d');cx.imageSmoothingEnabled=false;if(img.naturalWidth===64&&img.naturalHeight===32)cx.drawImage(img,0,0,64,32);else cx.drawImage(img,0,0,64,64);prefs.skin=c.toDataURL('image/png');drawSkinPreview(prefs.skin);savePrefs();$('skinStatus').textContent='Uploaded skin saved locally.';};img.onerror=()=>showToast('That PNG could not be decoded.','warn');img.src=String(reader.result);};reader.readAsDataURL(file);});
$('loadSkin').addEventListener('click',()=>{const user=$('skinUsername').value.trim();if(!user)return showToast('Enter a Java username first.','warn');const src=`https://minotar.net/skin/${encodeURIComponent(user)}`;drawSkinPreview(src);const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');try{ctx.drawImage(img,0,0,64,64);prefs.skin=c.toDataURL('image/png');savePrefs();drawSkinPreview(prefs.skin);$('skinStatus').textContent=`Loaded skin for ${user}.`;}catch{$('skinStatus').textContent='Provider blocks canvas access. Upload the PNG instead.';showToast('Skin lookup was blocked. Upload a skin PNG instead.','warn');}};img.onerror=()=>{showToast('Skin provider unavailable. Upload a PNG instead.','warn');$('skinStatus').textContent='Could not fetch username skin.';};img.src=src;});

// Settings sync to the room host; game type and weapon mode remain independent settings.
function onSettingsChanged(e){settings=getSettings();if(e?.target?.id==='playMode'){adaptLoadoutToMode(settings.mode);}updateModeDescription();if(!inMatch)game.buildMap(settings.map);renderLoadout();if(online&&network?.connected&&isHost){network.send('settings',{settings});syncMapCollisionToServer();}}
['gameType','playMode','mapSelect','scoreLimit','timeLimit','respawnDelay'].forEach(id=>$(id).addEventListener('change',onSettingsChanged));
$('nameInput').addEventListener('change',savePrefs);$('colorInput').addEventListener('input',()=>{savePrefs();drawSkinPreview(prefs.skin);});$('hatInput').addEventListener('change',savePrefs);
$('vehicleSelect')?.addEventListener('change',e=>{prefs.vehicle=e.target.value;savePrefs();if(online&&network?.connected&&!inMatch)network.send('vehicleChoice',{vehicle:prefs.vehicle});showToast(`${vehicleById(prefs.vehicle).name} selected.`);});
$('sensitivity').addEventListener('input',e=>{prefs.sens=+e.target.value;game.setSensitivity(prefs.sens);savePrefs();});$('volume').addEventListener('input',e=>{prefs.vol=+e.target.value;savePrefs();});$('quality').addEventListener('change',e=>{prefs.quality=e.target.value;game.setQuality(prefs.quality);savePrefs();});

// Armory: selectable preview + weapon stats, with a strict 2-gun / 1-melee structure.
function weaponPool(){if(loadoutTab==='melee')return WEAPONS.filter(w=>w.kind==='melee'&&!w.special);let guns=WEAPONS.filter(w=>w.kind==='gun');if(settings.mode==='pistol')guns=guns.filter(w=>w.category==='pistol');else if(settings.mode==='sniper')guns=guns.filter(w=>w.category==='sniper');return guns;}
function currentInspected(){return weaponById(inspectedWeapon);}
function drawWeaponPreview(w){const c=$('weaponPreview'),ctx=c.getContext('2d');const W=c.width,H=c.height;ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(W/2,H/2+8);ctx.rotate(-.11);const color=w.color||'#aab8bf';ctx.shadowColor=color;ctx.shadowBlur=13;ctx.fillStyle=color;ctx.strokeStyle='#10181c';ctx.lineWidth=3;
  const rect=(x,y,ww,hh,col=color)=>{ctx.fillStyle=col;ctx.fillRect(x,y,ww,hh);ctx.strokeRect(x,y,ww,hh);};
  if(w.kind==='melee'){
    ctx.rotate(-.38);rect(-5,-52,10,98,'#303a3d');rect(-9,-31,18,9,'#1e272c');rect(-3,-103,6,55,color);rect(-1,-106,2,49,'#f1f4e6');if(w.id==='axe'){rect(2,-104,39,25,color);rect(1,-96,12,21,'#30383c');}if(w.id==='hammer'){rect(-23,-100,46,24,color);rect(-4,-79,8,65,'#333b3d');}if(w.id==='bat')rect(-6,-105,12,53,color);
  }else{
    const len=w.category==='sniper'||['shotgun','lmg','minigun','crossbow'].includes(w.id)?150:108;rect(-len/2,-8,len,25,color);rect(-len/2+8,-1,len-16,11,'#2a343a');rect(-len/2+17,15,22,38,'#303b3f');rect(-len/2+18,44,23,9,'#171f24');rect(len/2-18,-1,18,8,'#1b252b');rect(-len/2-18,-3,19,12,'#5c6c72');if(w.category==='sniper'){rect(-12,-28,49,12,'#252d32');rect(-4,-34,31,5,color);}if(w.id==='crossbow'){rect(-55,-27,110,6,color);rect(-3,-23,6,28,'#2b3438');}if(w.id==='laser'){rect(-6,-12,80,4,'#d98cff');ctx.shadowColor='#bf59f5';ctx.shadowBlur=20;rect(8,-13,54,3,'#e9c2ff');}if(w.id==='minigun'){for(let k=0;k<3;k++)rect(-len/2-8+k*8,-3,5,41,'#2f3b42');}
  }ctx.restore();ctx.shadowBlur=0;ctx.fillStyle='rgba(141,184,198,.55)';ctx.font='10px IBM Plex Mono';ctx.textAlign='left';ctx.fillText(`${w.kind==='melee'?'MELEE PLATFORM':w.category.toUpperCase()}  /  VB-${w.id.toUpperCase()}`,12,18);ctx.textAlign='right';ctx.fillText(`${w.damage} DMG`,W-12,H-15);}
function setActiveLoadoutSlot(index){if(index===2){loadoutTab='melee';}else{loadoutTab='guns';activeGunSlot=index;}byData('.loadout-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===loadoutTab));byData('.equipped-slot').forEach(b=>b.classList.toggle('selected',+b.dataset.loadoutSlot===index));renderLoadout();}
function assignWeapon(id){const w=weaponById(id);if(loadoutTab==='melee'){if(w.kind!=='melee')return;loadout.melee=id;}else{if(w.kind!=='gun')return;const other=1-activeGunSlot;if(loadout.guns[other]===id){loadout.guns[other]=loadout.guns[activeGunSlot];}loadout.guns[activeGunSlot]=id;}loadout=normalizeLoadout(loadout);inspectedWeapon=id;savePrefs();renderLoadout();}
function renderLoadout(){
  if(!$('weaponList'))return;const pool=weaponPool();if(!pool.some(w=>w.id===inspectedWeapon))inspectedWeapon=(loadoutTab==='melee'?loadout.melee:loadout.guns[activeGunSlot])||pool[0]?.id;
  $('weaponCategoryTitle').textContent=loadoutTab==='melee'?'SELECT ONE MELEE WEAPON':settings.mode==='pistol'?'SELECT TWO PISTOLS':settings.mode==='sniper'?'SELECT TWO PRECISION WEAPONS':'SELECT TWO GUNS';$('weaponCategoryHelp').textContent=loadoutTab==='melee'?'Choose the close-quarters weapon you carry in slot 3.':`Choose a gun for slot ${activeGunSlot+1}. All weapons are unlocked.`;
  const root=$('weaponList');root.innerHTML='';for(const w of pool){const selected=loadoutTab==='melee'?loadout.melee===w.id:loadout.guns.includes(w.id);const button=document.createElement('button');button.className=`weapon-card ${selected?'selected':''}`;button.style.setProperty('--weapon-color',w.color);const top=document.createElement('div');top.className='weapon-card-top';const cat=document.createElement('small');cat.textContent=w.category.toUpperCase();const dot=document.createElement('i');top.append(cat,dot);const name=document.createElement('b');name.textContent=w.name;const stats=document.createElement('div');stats.className='mini-stat';const stat1=document.createElement('span');stat1.textContent=`DMG ${w.damage}`;const stat2=document.createElement('span');stat2.textContent=w.kind==='melee'?`${w.range.toFixed(1)}M`:`${Math.round(60000/w.fireMs)} RPM`;stats.append(stat1,stat2);button.append(top,name,stats);if(selected){const tag=document.createElement('span');tag.className='assign';tag.textContent=loadoutTab==='melee'?'EQUIPPED':`SLOT ${loadout.guns.indexOf(w.id)+1}`;button.append(tag);}button.addEventListener('click',()=>assignWeapon(w.id));root.append(button);}
  const w=currentInspected();$('previewType').textContent=w.category.toUpperCase()+' CLASS';$('previewSlot').textContent=loadoutTab==='melee'?'MELEE SLOT':'GUN SLOT '+(activeGunSlot+1);$('weaponEyebrow').textContent=`VB ARMORY / ${w.id.toUpperCase()}`;$('weaponName').textContent=w.name.toUpperCase();$('weaponDescription').textContent=w.description;$('weaponDamage').textContent=w.damage;$('statPower').textContent=w.power;$('statAccuracy').textContent=w.accuracy;$('statHandling').textContent=w.handling;$('statFireRate').textContent=w.kind==='melee'?`${(w.range).toFixed(1)}M`:`${Math.round(60000/w.fireMs)} RPM`;$('barPower').style.width=`${w.power}%`;$('barAccuracy').style.width=`${w.accuracy}%`;$('barHandling').style.width=`${w.handling}%`;$('barFireRate').style.width=`${w.kind==='melee'?Math.round(1000/w.fireMs*100):clamp(1000/w.fireMs*12,5,100)}%`;drawWeaponPreview(w);
  $('equippedGun1').textContent=weaponById(loadout.guns[0]).name;$('gun1Ammo').textContent=`${weaponById(loadout.guns[0]).mag||'—'} / ${weaponById(loadout.guns[0]).reserve||'—'}`;$('equippedGun2').textContent=weaponById(loadout.guns[1]).name;$('gun2Ammo').textContent=`${weaponById(loadout.guns[1]).mag||'—'} / ${weaponById(loadout.guns[1]).reserve||'—'}`;$('equippedMelee').textContent=weaponById(loadout.melee).name;
  let warning='';if(settings.mode==='melee')warning='MELEE ONLY: both gun slots remain equipped but cannot fire during this match.';else if(settings.mode==='pistol')warning='PISTOL ONLY: only the two equipped pistols can be used; the melee slot is disabled.';else if(settings.mode==='sniper')warning='SNIPERS ONLY: only the selected precision-class guns can be fired; melee is disabled.';$('loadoutModeWarning').textContent=warning;
}
byData('.loadout-tab').forEach(btn=>btn.addEventListener('click',()=>{loadoutTab=btn.dataset.tab;if(loadoutTab==='melee')inspectedWeapon=loadout.melee;else{activeGunSlot=0;inspectedWeapon=loadout.guns[0];}byData('.loadout-tab').forEach(b=>b.classList.toggle('active',b===btn));byData('.equipped-slot').forEach(b=>b.classList.toggle('selected',b.dataset.loadoutSlot===(loadoutTab==='melee'?'2':String(activeGunSlot))));renderLoadout();}));
byData('.equipped-slot').forEach(slot=>slot.addEventListener('click',()=>setActiveLoadoutSlot(+slot.dataset.loadoutSlot)));
renderLoadout();

function openLoadout(kind){pendingMatch=kind;$('menu').classList.add('hidden');$hud.classList.add('hidden');$loadoutScreen.classList.remove('hidden');$('loadoutConfirmText').textContent=kind==='online'?'CONFIRM LOADOUT FOR ROOM MATCH':'CONFIRM LOADOUT FOR SOLO PRACTICE';$('confirmLoadout').textContent='CONFIRM & DEPLOY →';renderLoadout();game.freezeInput(true);}
$('backFromLoadout').addEventListener('click',()=>{if(pendingMatch==='online'){network?.send('leave');network?.close();network=null;online=false;isHost=false;roomCode='';$lobbyPanel.classList.add('hidden');}pendingMatch=null;$loadoutScreen.classList.add('hidden');$menu.classList.remove('hidden');$hud.classList.add('hidden');game.setActive(false);game.freezeInput(true);});
$('confirmLoadout').addEventListener('click',async()=>{loadout=normalizeLoadout(loadout);savePrefs();if(pendingMatch==='solo'){ $('confirmLoadout').disabled=true;$('loadoutConfirmText').textContent='PREPARING MATCH…';await beginSoloMatch();}else if(pendingMatch==='online'){ $('confirmLoadout').disabled=true;$('loadoutConfirmText').textContent='PREPARING MATCH…';try{await game.waitForMap();if(pendingMatch!=='online')return;network?.send('loadout',{loadout});network?.send('deploy',{loadout});$('loadoutConfirmText').textContent='LOADOUT SUBMITTED — WAITING FOR SPAWN';}catch(error){$('confirmLoadout').disabled=false;$('loadoutConfirmText').textContent='MATCH PREPARATION FAILED';showToast(error.message||'Match preparation failed. Please try again.','warn');}}else{showToast('No match is waiting for a loadout.','warn');}});

// Lobby networking. Static Netlify serves the client; deploy server/server.mjs separately for online rooms.
function serverUrl(){
  const configured=String(import.meta.env.VITE_GAME_SERVER_URL||'').trim();
  const url=configured||(location.port&&['5173','5174','4173'].includes(location.port)
    ?'ws://localhost:8787/ws'
    :`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
  if(location.protocol==='https:'&&url.startsWith('ws://'))throw new Error('Secure multiplayer requires a wss:// connection.');
  return url;
}
function profileMessage(){return {name:$('nameInput').value.trim()||'Operator',col:$('colorInput').value,hat:+$('hatInput').value||0,skin:prefs.skin||'',skinPreset:prefs.skinPreset||'vanguard',vehicle:prefs.vehicle||'atlas-cycle',loadout,settings:getSettings()};}
async function connectRoom(action){if(network?.connected)network.close();network=null;const url=serverUrl();$('connectionStatus').textContent='CONNECTING…';showToast('Connecting to multiplayer room server…');const client=new MultiplayerClient(url,handleServerEvent);network=client;try{await client.connect();client.send(action,action==='create'?profileMessage():{...profileMessage(),code:$('roomCode').value.trim().toUpperCase()});}catch(error){network=null;$('connectionStatus').textContent='SERVER OFFLINE';showToast(error.message||'Could not connect to the room server.','warn');}}
$('createRoom').addEventListener('click',()=>{settings=getSettings();connectRoom('create').catch(()=>{});});$('joinRoom').addEventListener('click',()=>{if(!$('roomCode').value.trim())return showToast('Enter a four-character room code.','warn');connectRoom('join').catch(()=>{});});
$('roomCode').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);});
$('readyButton').addEventListener('click',()=>{if(!online||!network)return;ready=!ready;network.send('ready',{ready});});
function syncMapCollisionToServer(){if(!online||!isHost||!network?.connected||!game.mapData)return;const colliders=(game.mapData.colliders||[]).slice(0,3500).map(b=>({x:b.x,y:b.y,z:b.z,w:b.w,h:b.h,d:b.d}));network.send('mapColliders',{map:settings.map,colliders});}
$('startMatch').addEventListener('click',()=>{if(!online||!isHost||!network)return;settings=getSettings();game.buildMap(settings.map);network.send('settings',{settings});syncMapCollisionToServer();network.send('start');});
function lockLobbySettings(lock){['gameType','playMode','mapSelect','scoreLimit','timeLimit','respawnDelay'].forEach(id=>$(id).disabled=lock);}
function renderLobby(){
  if(!online||!roomCode){$lobbyPanel.classList.add('hidden');lockLobbySettings(false);return;}$lobbyPanel.classList.remove('hidden');$('roomCodeDisplay').textContent=roomCode;$('connectionStatus').textContent=network?.connected?'ROOM CONNECTED':'CONNECTING…';
  const root=$('roster');root.innerHTML='';for(const p of roster){const item=document.createElement('div');item.className='roster-player';const dot=document.createElement('i');dot.className='team-dot';dot.style.background=p.team===1?'var(--red)':p.team===0?'var(--blue)':'#b1bbc0';const n=document.createElement('span');n.className='roster-name';n.textContent=`${p.name||'Operator'}${p.id===localId?' (YOU)':''}`;const state=document.createElement('small');state.textContent=p.id===hostId?'HOST':p.ready?'READY':'WAIT';item.append(dot,n,state);root.append(item);}
  const everyoneReady=roster.every(p=>p.id===hostId||p.ready);
  $('startMatch').disabled=!isHost||!everyoneReady||roster.length===0;$('startMatch').style.display=isHost?'inline-flex':'none';$('readyButton').style.display=isHost?'none':'inline-flex';$('readyButton').textContent=ready?'✓ READY — CLICK TO UNREADY':'MARK READY';$('roomStatus').textContent=isHost?'HOST / WAITING FOR PLAYERS':ready?'READY / WAITING FOR HOST':'WAITING FOR HOST';lockLobbySettings(!isHost);
}
function updateSettingsFromServer(s){if(!s)return;setSettingsUI(s);if(!inMatch){game.buildMap(s.map);adaptLoadoutToMode(s.mode);renderLoadout();}}
function handleServerEvent(msg){
  if(!msg||!msg.type)return;
  switch(msg.type){
    case 'hello':localId=msg.id;break;
    case 'created':case 'joined':
      online=true;isHost=msg.role==='host';roomCode=msg.code;hostId=msg.hostId;localId=msg.self?.id||network?.id||localId;ready=!!msg.self?.ready;roster=msg.players||[];updateSettingsFromServer(msg.settings);renderLobby();showToast(msg.type==='created'?`Room ${roomCode} created.`:`Joined room ${roomCode}.`);break;
    case 'lobby':case 'settingsUpdated':
      if(msg.settings)updateSettingsFromServer(msg.settings);if(msg.code)roomCode=msg.code;if(msg.hostId)hostId=msg.hostId;if(msg.players)roster=msg.players;const self=roster.find(p=>p.id===localId);if(self)ready=!!self.ready;isHost=hostId===localId;renderLobby();break;
    case 'playerJoined':if(msg.player&&!roster.some(p=>p.id===msg.player.id))roster.push(msg.player);renderLobby();showToast(`${msg.player?.name||'An operator'} joined the room.`);break;
    case 'playerLeft':roster=roster.filter(p=>p.id!==msg.id);game.removeRemote(msg.id);renderLobby();break;
    case 'teamChanged':{const p=roster.find(x=>x.id===msg.id);if(p)p.team=msg.team;if(msg.id===localId){localScore.team=msg.team;game.local.team=msg.team;centerMessage(msg.team===0?'TEAM BLUE':'TEAM RED',1000);showToast(`You switched to ${msg.team===0?'BLUE':'RED'} team.`);}else{const remote=game.remote.get(msg.id);if(remote){remote.team=msg.team;remote.info.team=msg.team;}}if(msg.players){roster=msg.players;liveRoster=msg.players;}renderScoreboard();updateHUD(true);break;}
    case 'weaponChanged':if(msg.id!==localId){const p=roster.find(x=>x.id===msg.id)||{id:msg.id,name:'Operator'};game.updateRemote({...p,weapon:msg.weapon});}break;
    case 'loadoutUpdated':{const p=roster.find(x=>x.id===msg.id);if(p)p.loadout=msg.loadout;break;}
    case 'matchStart':
      game.clearCombatEffects();settings={...settings,...msg.settings};setSettingsUI(settings);online=true;matchKind='online';inMatch=false;dead=false;matchEnding=false;pendingMatch='online';serverStartAt=msg.startAt||Date.now()+4000;matchStartedAt=serverStartAt;matchEndsAt=msg.endsAt||Date.now()+settings.timeLimit*60000;teamScores=[0,0];objectiveState=msg.objectives||null;liveRoster=msg.players||[];roster=liveRoster;hostId=liveRoster.find(p=>p.host)?.id||hostId;localId=network?.id||localId;countedThisMatch=false;streak=0;serverStreakSync=false;susiSwordUnlocked=false;meleeThrown=false;meleeLost=false;localMeleeDrop=null;const selfp=liveRoster.find(p=>p.id===localId);if(selfp){localScore={kills:0,deaths:0,score:0,team:selfp.team??0};}
      clearOfflineBots();game.buildMap(settings.map);for(const p of liveRoster)if(p.id!==localId)game.updateRemote({...p,dead:true,y:-100});game.waitForMap().then(()=>game.setObjectives(objectiveState)).catch(error=>showToast(error.message||'Could not prepare this match.','warn'));$('confirmLoadout').disabled=false;openLoadout('online');break;
    case 'playerState':
      if(msg.player){const p=msg.player;if(p.id!==localId){game.updateRemote(p);}const i=roster.findIndex(x=>x.id===p.id);if(i>=0)roster[i]={...roster[i],...p};else roster.push(p);}
      break;
    case 'playerSpawn':
      if(msg.id===localId)break;{const p=roster.find(x=>x.id===msg.id)||{id:msg.id,name:'Operator'};game.updateRemote({...p,...msg.spawn,dead:false,health:msg.health,weapon:msg.weapon,loadout:msg.loadout,team:msg.team,vehicle:msg.vehicle||null});const rec=game.remote.get(msg.id);if(rec){rec.target.set(msg.spawn.x,msg.spawn.y,msg.spawn.z);rec.mesh.visible=true;}}break;
    case 'deployed':
      if(!online||!network)return;meleeThrown=false;meleeLost=false;localMeleeDrop=null;loadout=normalizeLoadout(msg.loadout||loadout);health=msg.health??100;shield=msg.shield??0;dead=false;pendingMatch=null;inMatch=true;matchEnding=false;localScore.team=msg.team??localScore.team;currentWeaponId=msg.weapon||defaultWeaponForMode();$('confirmLoadout').disabled=false;$loadoutScreen.classList.add('hidden');$menu.classList.add('hidden');$hud.classList.remove('hidden');$deathPanel.classList.add('hidden');game.clearLocalVehicle?.();game.spawn(msg.spawn);game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);initAmmo(true);game.setActive(true);const freeze=Date.now()<serverStartAt;game.freezeInput(freeze);if(!freeze)game.requestPointerLock();else centerMessage('MATCH STARTING',Math.max(1000,serverStartAt-Date.now()));updateHUD(true);if(!countedThisMatch){prefs.st.g=(prefs.st.g||0)+1;countedThisMatch=true;savePrefs();updateStats();}break;
    case 'shotFX':if(msg.id!==localId&&msg.origin&&msg.direction){if(Array.isArray(msg.rays)&&msg.rays.length){for(const ray of msg.rays)game.showTracer(msg.origin,ray.direction,ray.range||msg.range||80,msg.color||'#e7f5ed');}else game.showTracer(msg.origin,msg.direction,msg.range||80,msg.color||'#e7f5ed');}break;
    case 'killStreakReward':if(msg.id===localId){serverStreakSync=true;unlockReward(msg.reward,msg.streak);}break;
    case 'droneSpawn':if(msg.drone)game.showDrone(msg.drone.id,msg.drone.owner,msg.drone.x,msg.drone.y,msg.drone.z,msg.drone.expiresAt);break;
    case 'droneState':game.updateDroneStates(msg.drones||[]);break;
    case 'droneEnd':game.removeDrone(msg.id);break;
    case 'paintShot':if(Array.isArray(msg.from)&&Array.isArray(msg.to))game.showPaintShot(msg.from,msg.to);break;
    case 'paintHit':game.showPaintSplatter(msg.x,msg.y,msg.z);if(msg.to===localId)showToast('A paint drone tagged you!');break;
    case 'ssStrike':game.showAirstrike(msg.x,msg.z,msg.duration||2300);break;
    case 'ssStrikeImpact':game.showAirstrikeImpact(msg.x,msg.z);break;
    case 'blackHole':game.showBlackHole(msg);enterBossTheme();break;
    case 'blackHoleBurst':game.showBlackHoleBurst(msg.x,msg.z);break;
    case 'blackHoleEnd':game.endBlackHole();exitBossTheme();break;
    case 'meleeDropped':if(msg.drop)game.addMeleeDrop(msg.drop,false);break;
    case 'meleeDropState':for(const d of msg.drops||[])game.updateMeleeDrop(d);break;
    case 'meleeDropRemoved':game.removeMeleeDrop(msg.id);if(localMeleeDrop?.id===msg.id)localMeleeDrop=null;break;
    case 'meleeThrown':meleeThrown=true;meleeLost=false;localMeleeDrop={id:msg.dropId,weapon:msg.weapon,owner:localId};game.showWeapon('unarmed');showToast('Melee thrown. Press Y near it to pick it up.');updateHUD(true);break;
    case 'meleePicked':if(msg.id===localId){meleeThrown=false;meleeLost=false;localMeleeDrop=null;currentWeaponId=msg.weapon||loadout.melee;game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);centerMessage('MELEE RECOVERED',800);}else{const remote=game.remote.get(msg.id);if(remote)game.updateRemote({...remote.info,id:msg.id,meleeThrown:false,meleeLost:false,weapon:msg.weapon||remote.weapon});}break;
    case 'meleeLost':if(msg.id===localId){meleeThrown=true;meleeLost=true;localMeleeDrop=null;showToast('Your melee weapon despawned. It is lost for this life.','warn');updateHUD(true);}break;
    case 'ammo':if(msg.weapon){const a=ammoMap[msg.weapon]||{current:0,reserve:0};a.current=msg.ammo??a.current;a.reserve=msg.reserve??a.reserve;ammoMap[msg.weapon]=a;}break;
    case 'empty':if(msg.weapon===currentWeaponId)reloadCurrent();break;
    case 'reloadStarted':if(msg.weapon){beginReload(reloadsByWeapon,msg.weapon,performance.now()+Math.max(0,(msg.endsAt||Date.now())-Date.now()));if(msg.weapon===currentWeaponId)game.startReloadAnimation(Math.max(250,(msg.endsAt||Date.now())-Date.now()));}break;
    case 'reloadComplete':if(msg.id===localId||msg.id===undefined){const a=ammoMap[msg.weapon]||{};a.current=msg.ammo??a.current;a.reserve=msg.reserve??a.reserve;ammoMap[msg.weapon]=a;clearReload(reloadsByWeapon,msg.weapon);if(msg.weapon===currentWeaponId)showToast(`${weaponById(msg.weapon).name.toUpperCase()} RELOADED`);}break;
    case 'damage':
      if(msg.to===localId){health=msg.health??Math.max(0,health-msg.amount);shield=msg.shield??shield;$('damageOverlay').style.opacity='.82';setTimeout(()=>$('damageOverlay').style.opacity='0',170);sound(118,.12,'sawtooth',.18,55);if(health<=0)onLocalDeath(msg.from);}
      else {const target=game.remote.get(msg.to);if(target){target.health=msg.health;if(msg.health<=0)target.mesh.visible=false;}}
      break;
    case 'hitmarker':showHitMarker(msg.kind||'normal');if(msg.kind!=='blocked')sound(820,.05,'sine',.13,1080);break;
    case 'playerDied':
      if(msg.id===localId){if(online){prefs.st.d=(prefs.st.d||0)+1;savePrefs();updateStats();}onLocalDeath(msg.by);}
      else {const p=game.remote.get(msg.id);if(p)p.mesh.visible=false;}
      if(msg.by===localId&&msg.id!==localId){if(online&&serverStreakSync)serverStreakSync=false;else streak++;prefs.st.k=(prefs.st.k||0)+1;prefs.st.xp=(prefs.st.xp||0)+10;prefs.st.bs=Math.max(prefs.st.bs||0,streak);savePrefs();updateStats();boom();centerMessage('ELIMINATION',950);}
      if(msg.by&&msg.by!==msg.id&&msg.by!==localId)addKillFeed(msg.by,msg.id);else if(msg.by===localId&&msg.id!==localId)addKillFeed(msg.by,msg.id);
      if(msg.stats){teamScores=msg.stats.teams||teamScores;liveRoster=msg.stats.players||liveRoster;renderScoreboard();}if(msg.objectives)objectiveState=msg.objectives;break;
    case 'objectives':objectiveState=msg.objectives||objectiveState;if(online&&settings.gameType==='ctf')localCarrying=objectiveState?.flags?.find(f=>f.carrier===localId)?.id||null;if(msg.stats){teamScores=msg.stats.teams||teamScores;liveRoster=msg.stats.players||liveRoster;}game.setObjectives(objectiveState);break;
    case 'powerup':if(msg.id===localId){applyPowerup(msg.power,msg.shield);}markPickupCooldown(msg.power);break;
    case 'stun':if(msg.id===localId){const p=game.local;p.motion='stunned';p.motionStartedAt=performance.now();p.motionUntil=performance.now()+(msg.duration||1100);centerMessage('TRIPPED',700);}else{const p=game.remote.get(msg.id);if(p){p.motion='stunned';p.info.motion='stunned';p.motionUntil=Date.now()+(msg.duration||1100);p.info.motionUntil=p.motionUntil;}}break;
    case 'tripFX':if(msg.id===localId)game.swingVisual();else game.swingRemote(msg.id);if(msg.hit===localId){$('damageOverlay').style.opacity='.4';setTimeout(()=>$('damageOverlay').style.opacity='0',180);}break;
    case 'meleeFX':if(msg.id===localId)game.swingVisual();else game.swingRemote(msg.id);if(msg.hit===localId){$('damageOverlay').style.opacity='.4';setTimeout(()=>$('damageOverlay').style.opacity='0',180);}break;
    case 'deployWait':respawnAt=Date.now()+(msg.remaining||1)*1000;break;
    case 'matchEnd':handleOnlineMatchEnd(msg);break;
    case 'roomClosed':showToast(msg.reason||'Room closed.','warn');network?.close();network=null;online=false;isHost=false;roomCode='';renderLobby();if(inMatch)leaveToMenu();break;
    case 'error':showToast(msg.message||'Multiplayer error.','warn');break;
    case 'disconnected':if(network&&!network.intentionalClose){showToast('Connection to room server was lost.','warn');$('connectionStatus').textContent='DISCONNECTED';if(inMatch)pauseMatch(true);}break;
    case 'pong':break;
  }
}

// Loadout and spawn initialization.
function initAmmo(reset=false){for(const id of loadout.guns){const w=weaponById(id);if(w.kind!=='gun')continue;if(reset||!ammoMap[id])ammoMap[id]={current:w.mag,reserve:w.reserve};}for(const id of Object.keys(ammoMap))if(!loadout.guns.includes(id))delete ammoMap[id];if(reset)reloadsByWeapon={};}
function setWeapon(id){if(meleeThrown&&weaponById(id).kind==='melee'){showToast('Your melee weapon is on the ground. Press Y near it to pick it up.','warn');return;}const w=weaponById(id);if(!modeAllowed(id)){showToast(`${w.name} is disabled by ${PLAY_MODES.find(m=>m.id===settings.mode)?.name||'this mode'}.`,'warn');return;}if(!activeWeaponList().includes(id)){showToast('That weapon is not in your current loadout.','warn');return;}currentWeaponId=id;game.local.weapon=id;game.showWeapon(id);if(isReloading(reloadsByWeapon,id,performance.now()))game.startReloadAnimation(reloadDeadline(reloadsByWeapon,id)-performance.now());if(online&&network?.connected)network.send('selectWeapon',{weapon:id});$('weaponHud').textContent=w.name.toUpperCase();$('weaponCategoryHud').textContent=w.category.toUpperCase();byData('.weapon-slot').forEach(el=>el.classList.toggle('active',+el.dataset.hudSlot===slotIndexFor(id)));}
function slotIndexFor(id){if(id===loadout.melee||id==='susis_sword')return 2;return loadout.guns.indexOf(id);}
function selectSlot(slot){if(slot<0||slot>2)return;if(slot===2&&meleeThrown){showToast('MELEE DROPPED — press Y near it to recover.','warn');return;}const id=weaponForSlot(slot);if(!id||!modeAllowed(id)){showToast('That slot is restricted in this mode.','warn');return;}setWeapon(id);}
function switchWeapon(direction){const list=activeWeaponList();if(list.length<=1){setWeapon(list[0]||defaultWeaponForMode());return;}let ix=list.indexOf(currentWeaponId);if(ix<0)ix=0;setWeapon(list[(ix+direction+list.length)%list.length]);}
function reloadCurrent(){const w=weaponById(currentWeaponId);if(w.kind!=='gun'||!inMatch||dead||isReloading(reloadsByWeapon,w.id,performance.now()))return;initAmmo();const a=ammoMap[w.id];if(!a||a.current>=w.mag||a.reserve<=0)return;beginReload(reloadsByWeapon,w.id,performance.now()+w.reloadMs);game.startReloadAnimation(w.reloadMs);weaponSound({kind:'melee'});if(online&&network?.connected)network.send('reload',{weapon:w.id});else centerMessage(`RELOADING ${w.name.toUpperCase()}`,600);}
function doFire(auto=false){
  if(!inMatch||dead||matchEnding||Date.now()<matchStartedAt||$pausePanel.classList.contains('hidden')===false)return false;
  const w=weaponById(currentWeaponId);if(!modeAllowed(w.id))return false;if(w.kind==='melee'){if(!auto)performMelee();return false;}
  const now=performance.now(),effectiveFireMs=w.fireMs*(powerupExpiries.rapid>Date.now()?.55:1);if(isReloading(reloadsByWeapon,w.id,now)||now-(lastShotAt[w.id]||0)<effectiveFireMs*.91)return false;initAmmo();const ammo=ammoMap[w.id];if(!ammo||ammo.current<=0){reloadCurrent();return false;}
  lastShotAt[w.id]=now;ammo.current--;game.fireVisual(w.id);weaponSound(w);
  if(online&&network?.connected){syncState(true);const aim=game.getAim();network.send('fire',{weapon:w.id,dir:[aim.direction.x,aim.direction.y,aim.direction.z]});}
  else{
    const pelletCount=Math.max(1,w.pellets||1),hits=new Map();const aim=game.getAim();
    for(let i=0;i<pelletCount;i++){const dir=aim.direction.clone();if(pelletCount>1){dir.x+=(Math.random()-.5)*w.spread*2;dir.y+=(Math.random()-.5)*w.spread*2;dir.z+=(Math.random()-.5)*w.spread*2;dir.normalize();}const hit=game.castShot(w.id,'local',dir,aim.origin);if(hit){const bot=botStates.get(hit.id);if(bot?.alive){const old=hits.get(bot.id)||{bot,damage:0,head:false};old.damage+=(w.damage/pelletCount)*(hit.head?1.35:1)*(powerupExpiries.damage>Date.now()?1.6:1);old.head=old.head||hit.head;hits.set(bot.id,old);}}}
    for(const hit of hits.values()){damageBot(hit.bot,hit.damage,true);showHitMarker(hit.head?'head':'normal');sound(830,.045,'sine',.12,1100);}
  }
  return true;
}
function performMelee(){
  if(!inMatch||dead||Date.now()<matchStartedAt)return;if(meleeThrown){showToast(meleeLost?'Your melee weapon was lost for this life.':'Your melee is dropped. Press Y near it to pick it up.','warn');return;}const w=weaponById(currentWeaponId);if(w.kind!=='melee')return;const now=performance.now();if(now-(lastShotAt[w.id]||0)<w.fireMs*.88)return;lastShotAt[w.id]=now;game.swingVisual();weaponSound(w);
  const aim=game.getAim();if(online&&network?.connected){network.send('melee',{weapon:w.id,dir:[aim.direction.x,aim.direction.y,aim.direction.z]});return;}
  const p=game.local;let best=null,bestD=w.range;for(const bot of botStates.values()){if(!bot.alive)continue;if(settings.gameType!=='ffa'&&bot.team===localScore.team)continue;const dx=bot.x-p.x,dz=bot.z-p.z,d=Math.hypot(dx,dz);if(d<.1||d>w.range||Math.abs(bot.y-p.y)>.9)continue;const dot=(dx/d)*aim.direction.x+(dz/d)*aim.direction.z;if(dot<.24)continue;if(d<bestD){best=bot;bestD=d;}}
  if(best){damageBot(best,w.damage,true);showHitMarker('melee');}
}
function doTrip(){if(!inMatch||dead||Date.now()<matchStartedAt)return;const p=game.local,now=performance.now();if(now<(p.tripCooldown||0))return;p.tripCooldown=now+4200;p.motion='trip';p.motionUntil=now+650;game.swingVisual();sound(160,.14,'triangle',.21,62);if(online&&network?.connected){syncState(true);network.send('trip');return;}const dir={x:-Math.sin(game.yaw),z:-Math.cos(game.yaw)};let best=null,distBest=2.15;for(const bot of botStates.values()){if(!bot.alive||settings.gameType!=='ffa'&&bot.team===localScore.team)continue;const dx=bot.x-p.x,dz=bot.z-p.z,d=Math.hypot(dx,dz);if(d<.1||d>distBest||Math.abs(bot.y-p.y)>.65)continue;const dot=(dx/d)*dir.x+(dz/d)*dir.z;if(dot<.55)continue;best=bot;distBest=d;}
  if(best){best.stunnedUntil=Date.now()+1150;best.motion='stunned';const rec=game.remote.get(best.id);if(rec){rec.motion='stunned';rec.motionUntil=performance.now()+1150;}damageBot(best,10,true);showToast(`TRIP CONNECTED — ${best.name}`);}
}
function toggleSelectedVehicle(){
  if(!inMatch||dead||matchEnding)return;
  if(game.local.vehicleType){game.clearLocalVehicle();showToast('Vehicle parked.','');return;}
  const selected=vehicleById(prefs.vehicle||$('vehicleSelect')?.value||'atlas-cycle');
  if(!game.toggleLocalVehicle(selected.id)){showToast('Could not deploy that vehicle.','warn');return;}
  showToast(`${selected.name} deployed. Press H to park it.`,'reward');
}
function switchTeams(){
  if(!inMatch||dead||matchEnding)return;
  const type=GAME_TYPES.find(t=>t.id===settings.gameType);
  if(!type?.team){showToast('Team switching is only available in team-based modes.','warn');return;}
  if(online&&network?.connected){network.send('switchTeam');return;}
  localScore.team=localScore.team===0?1:0;game.local.team=localScore.team;
  // Keep offline squads balanced after the local player moves sides.
  const bots=[...botStates.values()].filter(b=>b.alive||!b.alive);
  bots.forEach((bot,i)=>{bot.team=i%2===0?1-localScore.team:localScore.team;const rec=game.remote.get(bot.id);if(rec){rec.team=bot.team;rec.info.team=bot.team;}});
  centerMessage(localScore.team===0?'TEAM BLUE':'TEAM RED',1000);showToast(`Switched to ${localScore.team===0?'BLUE':'RED'} team.`);renderScoreboard();updateHUD(true);
}
function handleAction(action,value){
  if(action==='firePress'){if(inMatch&&!dead){const w=weaponById(currentWeaponId);if(w.kind==='melee')performMelee();else doFire(false);}return;}
  if(action==='fireRelease')return;
  if(action==='autoFire'){doFire(true);return;}
  if(action==='reload'){reloadCurrent();return;}
  if(action==='slot'){selectSlot(value);return;}
  if(action==='switch'){switchWeapon(value);return;}
  if(action==='scores'){if(value)$('scoreboard').classList.remove('hidden');else $('scoreboard').classList.add('hidden');renderScoreboard();return;}
  if(action==='pause'){pauseMatch();return;}
  if(action==='vehicle'){toggleSelectedVehicle();return;}
  if(action==='jump'){if(inMatch&&!dead&&game.local.vehicleType==='rdx-hoverboard'){if(game.activateVehicleFlight())showToast('Hover system engaged.','reward');else showToast('Hover system unavailable right now.','warn');return;}if(inMatch&&!dead&&game.local.grounded&&!['crawl','slide','stunned','trip','backflip'].includes(game.local.motion)){game.local.vy=powerupExpiries.jump>Date.now()?11:8;game.local.grounded=false;}return;}
  if(action==='backflip'){if(inMatch&&!dead&&game.local.grounded&&performance.now()>(game.local.backflipCooldown||0)&&!game.local.vehicleType){const p=game.local;p.backflipCooldown=performance.now()+3500;p.motion='backflip';p.motionStartedAt=performance.now();p.motionUntil=performance.now()+950;p.vy=8.8;p.vx+=Math.sin(p.yaw)*3.2;p.vz+=Math.cos(p.yaw)*3.2;p.grounded=false;sound(260,.11,'triangle',.13,170);}return;}
  if(action==='slide'){const p=game.local;if(inMatch&&!dead&&p.grounded&&game.keys.has(game.bindings.sprint)&&performance.now()>(p.slideCooldown||0)){p.motion='slide';p.motionUntil=performance.now()+760;p.slideCooldown=performance.now()+1850;}return;}
  if(action==='trip'){doTrip();return;}
  if(action==='throwMelee'){toggleMeleeThrowPickup();return;}
  if(action==='blackhole'){triggerSusiBlackHole();return;}
  if(action==='interact'){interactObjective();return;}
  if(action==='crouch'||action==='crawl')return;
}
game.setCallbacks({onAction:handleAction,onAutoFire:()=>handleAction('autoFire'),onPickup:p=>collectPickup(p),onPerformanceFallback:()=>showToast('Graphics were reduced to keep gameplay smooth on this device.','warn')});

function toggleMeleeThrowPickup(){
  if(!inMatch||dead||matchEnding||Date.now()<matchStartedAt)return;
  const current=weaponById(currentWeaponId);
  if(meleeThrown){
    if(online&&network?.connected){network.send('pickupMelee');return;}
    const drop=localMeleeDrop;if(drop&&Math.hypot(game.local.x-drop.x,game.local.z-drop.z)<=3){game.removeMeleeDrop(drop.id);localMeleeDrop=null;meleeThrown=false;meleeLost=false;currentWeaponId=drop.weapon||loadout.melee;game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);centerMessage('MELEE RECOVERED',900);updateHUD(true);}
    else showToast(meleeLost?'Your melee weapon was lost.':'Get closer to your dropped melee weapon to recover it.','warn');
    return;
  }
  if(current.kind!=='melee'){showToast('Equip your melee weapon first, then press Y to throw it.','warn');return;}
  if(online&&network?.connected){network.send('throwMelee');return;}
  const p=game.local,aim=game.getAim(),id=`local-drop-${Date.now()}`,dir=aim.direction.clone();
  const initialDrop={id,owner:'local',weapon:currentWeaponId,x:p.x+dir.x*.8,y:p.y+1.05,z:p.z+dir.z*.8,expiresAt:Date.now()+18000};
  localMeleeDrop=game.addMeleeDrop({...initialDrop,vx:dir.x*10.5,vy:dir.y*10.5+2.4,vz:dir.z*10.5},true)||initialDrop;meleeThrown=true;game.showWeapon('unarmed');centerMessage('MELEE THROWN — PRESS Y TO RECOVER',1300);
}
function triggerSusiBlackHole(){if(!inMatch||dead||currentWeaponId!=='susis_sword'||!susiSwordUnlocked){showToast('Reach a 20-kill streak and equip Susi’s Sword first.','warn');return;}if(online&&network?.connected){network.send('blackhole');return;}if(game.local.blackHoleUsed){showToast('Susi’s Sword has already bent this match.','warn');return;}game.local.blackHoleUsed=true;const p=game.local;const x=clamp(p.x-Math.sin(game.yaw)*12,-110,110),z=clamp(p.z-Math.cos(game.yaw)*12,-110,110);game.showBlackHole({x,z,duration:6100});enterBossTheme();setTimeout(()=>{game.endBlackHole();exitBossTheme();},6100);for(const bot of botStates.values()){if(!bot.alive||settings.gameType!=='ffa'&&bot.team===localScore.team)continue;if(Math.hypot(bot.x-x,bot.z-z)<19)damageBot(bot,Math.max(26,105*(1-Math.hypot(bot.x-x,bot.z-z)/24)),true);}}
function unlockReward(reward,streakValue){if(reward==='drone'){showToast('V’S EYE VIEW deployed — paint drone active!','reward');centerMessage('V’S EYE VIEW',1200);}else if(reward==='ss-strike'){showToast('SS STRIKE INBOUND! Clear the target zone.','reward');centerMessage('SS STRIKE INBOUND',1500);}else if(reward==='susi-sword'){susiSwordUnlocked=true;currentWeaponId='susis_sword';game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);showToast('20 STREAK — SUSI’S SWORD UNLOCKED','reward');centerMessage('SUSI’S SWORD ACQUIRED',1800);}if(streakValue)streak=streakValue;updateHUD(true);}

// Solo Practice uses local bots and the same shooting/movement/objective loop, without a server dependency.
function clearOfflineBots(){for(const id of [...botStates.keys()])game.removeRemote(id);botStates.clear();offlinePlayers=[];offlineDom=[];offlineFlags=[];localCarrying=null;}
function botWeapon(){if(settings.mode==='melee')return 'knife';if(settings.mode==='pistol')return Math.random()>.5?'revolver':'pistol';if(settings.mode==='sniper')return ['sniper','marksman','crossbow'][Math.floor(Math.random()*3)];return ['rifle','smg','shotgun','pistol','marksman','burst'][Math.floor(Math.random()*6)];}
function spawnBots(){clearOfflineBots();const spawns=game.mapData?.spawns||[];const names=['ROOK','NOMAD','HOLLOW','MICA','VEX','KITE','EMBER','SABLE'];const count=8;for(let i=0;i<count;i++){const id=`bot-${++botCounter}`,team=settings.gameType==='ffa'?null:i%2,spawn=spawns[(i+2)%spawns.length]||{x:(Math.random()-.5)*150,y:0,z:(Math.random()-.5)*150},weapon=botWeapon();const info={id,name:`${names[i]}-${String(i+1).padStart(2,'0')}`,col:team===1?'#df756b':team===0?'#63aee3':['#dc8f69','#a8a8df','#a9b66b'][i%3],hat:i%5,team,x:spawn.x,y:spawn.y,z:spawn.z,weapon,health:100,motion:'stand'};game.createRemote(info,true);const rec={id,name:info.name,team,x:spawn.x,y:spawn.y,z:spawn.z,health:100,alive:true,weapon,nextShot:Date.now()+700+Math.random()*1400,kills:0,deaths:0,score:0,stunnedUntil:0,motion:'stand',targetX:spawn.x,targetZ:spawn.z,roamAt:Date.now()+Math.random()*2000};botStates.set(id,rec);offlinePlayers.push(rec);}localScore={kills:0,deaths:0,score:0,team:settings.gameType==='ffa'?null:0};teamScores=[0,0];offlineDom=(game.mapData?.objectives?.dom||[{id:'A',x:-42,z:-42},{id:'B',x:0,z:0},{id:'C',x:42,z:42}]).map(p=>({...p,owner:null,progress:0,tick:Date.now()}));offlineFlags=(game.mapData?.objectives?.ctf||[{id:'blue',team:0,x:-98,z:0},{id:'red',team:1,x:98,z:0}]).map(f=>({...f,homeX:f.x,homeZ:f.z,carrier:null,returnAt:0}));objectiveState={dom:offlineDom,flags:offlineFlags,teamScores};}
function startSoloFromMenu(){if(online&&network){network.send('leave');network.close();network=null;}game.clearCombatEffects();online=false;isHost=false;roomCode='';$lobbyPanel.classList.add('hidden');settings=getSettings();openLoadout('solo');}
$('soloPlay').addEventListener('click',startSoloFromMenu);
async function beginSoloMatch(){
  settings=getSettings();
  try{if(game.mapData?.config?.id!==settings.map)game.buildMap(settings.map);await game.waitForMap();}
  catch(error){$('confirmLoadout').disabled=false;$('loadoutConfirmText').textContent='MATCH PREPARATION FAILED';showToast(error.message||'Match preparation failed. Please try again.','warn');return false;}
  countedThisMatch=false;pendingMatch=null;streak=0;serverStreakSync=false;susiSwordUnlocked=false;game.local.blackHoleUsed=false;meleeThrown=false;meleeLost=false;localMeleeDrop=null;matchKind='solo';online=false;inMatch=true;dead=false;matchEnding=false;offlineGameOver=false;spawnBots();health=100;shield=0;powerupExpiries={};ammoMap={};initAmmo(true);currentWeaponId=defaultWeaponForMode();game.clearLocalVehicle?.();game.spawn(game.mapData?.spawns?.[0]||{x:-96,y:0,z:-88});game.local.team=localScore.team;game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);game.setActive(true);game.freezeInput(false);game.setSensitivity(prefs.sens);$('menu').classList.add('hidden');$loadoutScreen.classList.add('hidden');$hud.classList.remove('hidden');$pausePanel.classList.add('hidden');$deathPanel.classList.add('hidden');$matchEndPanel.classList.add('hidden');matchStartedAt=Date.now()+1200;matchEndsAt=Date.now()+settings.timeLimit*60000;serverStartAt=matchStartedAt;streak=0;localScore.kills=0;localScore.deaths=0;localScore.score=0;localScore.team=settings.gameType==='ffa'?null:0;teamScores=[0,0];prefs.st.g=(prefs.st.g||0)+1;prefs.st.xp=(prefs.st.xp||0)+1;savePrefs();updateStats();updateHUD(true);centerMessage('ROUND STARTING',1150);setTimeout(()=>{if(inMatch&&!dead){game.requestPointerLock();}},100);return true;}

function refreshRespawnOptions(){
  const guns=WEAPONS.filter(w=>w.kind==='gun'&&(settings.mode==='pistol'?w.category==='pistol':settings.mode==='sniper'?w.category==='sniper':true));const melee=WEAPONS.filter(w=>w.kind==='melee');
  for(const [id,list,selected] of [['respawnGun1',guns,loadout.guns[0]],['respawnGun2',guns,loadout.guns[1]],['respawnMelee',melee,loadout.melee]]){const el=$(id);el.innerHTML='';for(const w of list){el.add(new Option(w.name,w.id));}el.value=list.some(w=>w.id===selected)?selected:list[0]?.id;}
}
function readRespawnLoadout(){let g1=$('respawnGun1').value,g2=$('respawnGun2').value;if(g1===g2){const opt=[...$('respawnGun2').options].find(o=>o.value!==g1);if(opt)g2=opt.value;}$('respawnGun2').value=g2;loadout=normalizeLoadout({guns:[g1,g2],melee:$('respawnMelee').value});prefs.loadout=loadout;savePrefs();if(online&&network?.connected)network.send('loadout',{loadout});}
function onLocalDeath(by){if(dead||!inMatch)return;dead=true;health=0;if(localMeleeDrop?.id)game.removeMeleeDrop(localMeleeDrop.id);localMeleeDrop=null;meleeThrown=false;meleeLost=false;if(!online&&localCarrying){const f=offlineFlags.find(x=>x.id===localCarrying);if(f){f.x=game.local.x;f.z=game.local.z;f.carrier=null;f.returnAt=Date.now()+15000;}localCarrying=null;}streak=0;powerupExpiries={};shield=0;reloadsByWeapon={};game.clearLocalVehicle?.();game.local.dead=true;game.local.motion='dead';game.freezeInput(true);game.mouseFire=false;try{document.exitPointerLock?.();}catch{};deathAt=Date.now();respawnAt=deathAt+settings.respawnSeconds*1000;respawnRequested=false;refreshRespawnOptions();$('deathCause').textContent=by?(by===localId?'You were eliminated.':`Eliminated by ${nameFor(by)}.`):'You were lost in the field.';$('deathPanel').classList.remove('hidden');$('deathCountdown').textContent=String(settings.respawnSeconds);if(!online){localScore.deaths++;prefs.st.d=(prefs.st.d||0)+1;savePrefs();updateStats();}
  clearInterval(deathInterval);deathInterval=setInterval(()=>{if(!dead){clearInterval(deathInterval);return;}const left=Math.max(0,Math.ceil((respawnAt-Date.now())/1000));$('deathCountdown').textContent=String(left);if(left<=0){clearInterval(deathInterval);deployAfterDeath();}},100);}
function deployAfterDeath(){if(!dead||!inMatch)return;readRespawnLoadout();if(online&&network?.connected){network.send('deploy',{loadout});}else{dead=false;$('deathPanel').classList.add('hidden');health=100;shield=0;initAmmo(true);currentWeaponId=defaultWeaponForMode();const spawn=game.mapData.spawns.filter(s=>settings.gameType==='ffa'||s.team===localScore.team);game.spawn(spawn[Math.floor(Math.random()*spawn.length)]||{x:0,y:0,z:0});game.local.team=localScore.team;game.local.weapon=currentWeaponId;game.showWeapon(currentWeaponId);game.freezeInput(false);game.requestPointerLock();centerMessage('RE-DEPLOYED',800);}}
$('deployNow').addEventListener('click',()=>{readRespawnLoadout();respawnRequested=true;$('deployNow').textContent=`LOADOUT SAVED — ${Math.max(0,Math.ceil((respawnAt-Date.now())/1000))} SEC`;if(Date.now()>=respawnAt)deployAfterDeath();});

function nameFor(id){if(id==='local'||id===localId)return prefs.name;const bot=botStates.get(id);if(bot)return bot.name;return roster.find(p=>p.id===id)?.name||'Operator';}
function addKillFeed(killerId,victimId){const row=document.createElement('div');row.className='kill-row';const a=document.createElement('span');a.className='killer';a.textContent=nameFor(killerId);const icon=document.createElement('span');icon.className='kill-icon';icon.textContent='✕';const b=document.createElement('span');b.className='victim';b.textContent=nameFor(victimId);row.append(a,icon,b);$('killFeed').prepend(row);while($('killFeed').children.length>5)$('killFeed').lastElementChild.remove();setTimeout(()=>row.remove(),5200);}
function showHitMarker(kind='normal'){const el=document.querySelector('.center-reticle');if(!el)return;el.classList.add('hit');el.style.color=kind==='head'?'#fff1ab':kind==='melee'?'#f5c3ff':kind==='blocked'?'#9ea8ae':'var(--lime)';clearTimeout(showHitMarker.timer);showHitMarker.timer=setTimeout(()=>el.classList.remove('hit'),190);}
function markPickupCooldown(id){const p=game.pickups.find(x=>x.userData.id===id);if(p){p.userData.active=false;p.userData.cooldownUntil=Date.now()+20000;p.visible=false;}}
function collectPickup(pickup){if(!inMatch||dead)return;if(online&&network?.connected){network.send('pickup',{id:pickup.id});markPickupCooldown(pickup.id);}else{markPickupCooldown(pickup.id);applyPowerup(pickup.id);}}
function applyPowerup(id,newShield){const def=POWERUPS.find(p=>p.id===id);if(!def)return;if(id==='shield'){shield=newShield??Math.min(100,shield+50);}else powerupExpiries[id]=Date.now()+def.duration;centerMessage(`${def.name.toUpperCase()} ACQUIRED`,1000);sound(620,.16,'sine',.2,1200);}
function interactObjective(){if(!inMatch||dead)return;if(settings.gameType==='ctf')centerMessage(localCarrying?'RETURN TO BASE':'CAPTURE THE ENEMY FLAG',1000);else if(settings.gameType==='dom')centerMessage('HOLD CONTROL ZONES TO SCORE',1000);else centerMessage('NO OBJECTIVE NEARBY',800);}

// Local combat helpers and bot AI share weapon data with networked combat.
function lineBlocked(from,to){const delta=to.clone().sub(from),distance=delta.length();if(distance<.01)return false;delta.normalize();return game.raycastMap(from,delta,Math.max(0,distance-.25))<distance-.25;}
function updateOfflineDroneAttacks(){
  if(online||!inMatch||dead)return;
  const t=Date.now();
  for(const drone of game.drones.values()){
    if(drone.owner!=='local'||t<(drone.nextFireAt||0))continue;
    drone.nextFireAt=t+720;
    let target=null,best=44;
    const from=new THREE.Vector3(drone.x,drone.y,drone.z);
    for(const bot of botStates.values()){
      if(!bot.alive||(settings.gameType!=='ffa'&&bot.team===localScore.team))continue;
      const distance=Math.hypot(bot.x-drone.x,bot.z-drone.z);if(distance>=best)continue;
      const to=new THREE.Vector3(bot.x,bot.y+1,bot.z);
      if(lineBlocked(from,to))continue;
      target=bot;best=distance;
    }
    if(target){const to=new THREE.Vector3(target.x,target.y+1,target.z);game.showPaintShot([from.x,from.y,from.z],[to.x,to.y,to.z]);damageBot(target,7,true);game.showPaintSplatter(target.x,target.y+1,target.z);}
  }
}
function damageBot(bot,damage,byLocal,killer=null){if(!bot?.alive)return;bot.health-=damage;const record=game.remote.get(bot.id);if(record)record.health=bot.health;if(bot.health>0)return;bot.health=0;bot.alive=false;bot.deaths++;bot.respawnAt=Date.now()+settings.respawnSeconds*1000;game.setBotState(bot.id,{dead:true,y:-100,motion:'dead'});if(byLocal){localScore.kills++;localScore.score++;prefs.st.k=(prefs.st.k||0)+1;prefs.st.xp=(prefs.st.xp||0)+10;prefs.st.bs=Math.max(prefs.st.bs||0,++streak);savePrefs();updateStats();if(settings.gameType==='tdm'||settings.gameType==='dom')teamScores[localScore.team??0]++;addKillFeed('local',bot.id);boom();for(const reward of rewardsForKillStreak(streak)){if(reward==='drone'){unlockReward('drone',streak);const id=`solo-eye-${Date.now()}`;game.showDrone(id,'local',game.local.x,game.local.y+3.3,game.local.z,Date.now()+15000);}else if(reward==='ss-strike'){unlockReward('ss-strike',streak);const sx=game.local.x-Math.sin(game.yaw)*18,sz=game.local.z-Math.cos(game.yaw)*18;game.showAirstrike(sx,sz);for(const other of botStates.values())if(other.alive&&(settings.gameType==='ffa'||other.team!==localScore.team)&&Math.hypot(other.x-sx,other.z-sz)<14)damageBot(other,65,true);}else if(reward==='susi-sword'){susiSwordUnlocked=true;unlockReward('susi-sword',streak);}}}else if(killer){killer.kills++;killer.score=(killer.score||0)+1;if((settings.gameType==='tdm'||settings.gameType==='dom')&&(killer.team===0||killer.team===1))teamScores[killer.team]++;addKillFeed(killer.id,bot.id);}else if(settings.gameType==='ffa'){localScore.score+=0;}checkOfflineWin();}
function damageLocal(dmg,bot){if(dead||!inMatch)return;let d=dmg;if(shield>0){const absorbed=Math.min(shield,d);shield-=absorbed;d-=absorbed;}health=Math.max(0,health-d);$('damageOverlay').style.opacity='.8';setTimeout(()=>$('damageOverlay').style.opacity='0',160);sound(120,.12,'sawtooth',.18,45);if(health<=0){if(bot){bot.kills++;bot.score=(bot.score||0)+1;if((settings.gameType==='tdm'||settings.gameType==='dom')&&(bot.team===0||bot.team===1))teamScores[bot.team]++;}onLocalDeath(bot?.id||null);}}
function chooseBotTarget(bot){const enemies=[...botStates.values()].filter(b=>b.alive&&b.id!==bot.id&&(settings.gameType==='ffa'||b.team!==bot.team));if(!dead&&inMatch&&(settings.gameType==='ffa'||bot.team!==localScore.team))return {local:true,x:game.local.x,y:game.local.y,z:game.local.z,team:localScore.team};let best=null,dist=Infinity;for(const e of enemies){const d=Math.hypot(e.x-bot.x,e.z-bot.z);if(d<dist){best=e;dist=d;}}return best;}
function botCanOccupy(bot,x,z){for(const b of game.getNearby(x,z)){if(x>b.x-b.w/2-.32&&x<b.x+b.w/2+.32&&z>b.z-b.d/2-.32&&z<b.z+b.d/2+.32&&bot.y<b.y+b.h-.2)return false;}return true;}
function updateBots(dt){const now=Date.now();if(now-lastBotTick<70)return;lastBotTick=now;const frameDt=Math.min(.12,dt*2.5);for(const bot of botStates.values()){
  if(!bot.alive){if(now>=(bot.respawnAt||0)){const opts=game.mapData.spawns.filter(s=>settings.gameType==='ffa'||s.team===bot.team);const sp=opts[Math.floor(Math.random()*opts.length)]||{x:0,y:0,z:0};bot.x=sp.x;bot.y=sp.y;bot.z=sp.z;bot.health=100;bot.alive=true;bot.weapon=botWeapon();bot.nextShot=now+900;bot.motion='stand';game.setBotState(bot.id,{x:bot.x,y:bot.y,z:bot.z,weapon:bot.weapon,dead:false,motion:'stand'});}continue;}
  if(bot.stunnedUntil>now){bot.motion='stunned';game.setBotState(bot.id,{x:bot.x,y:bot.y,z:bot.z,yaw:bot.yaw,motion:'stunned',weapon:bot.weapon,dead:false});continue;}
  const target=chooseBotTarget(bot);let dx=0,dz=0,distance=999;if(target){dx=target.x-bot.x;dz=target.z-bot.z;distance=Math.hypot(dx,dz);const targetYaw=Math.atan2(-dx,-dz);bot.yaw=targetYaw;if(distance>11||weaponById(bot.weapon).kind==='melee'&&distance>1.75){const dir=distance||1;const strafe=(bot.id.charCodeAt(4)%2?1:-1)*.22;let nx=bot.x+(dx/dir+(-dz/dir)*strafe)*2.9*frameDt,nz=bot.z+(dz/dir+(dx/dir)*strafe)*2.9*frameDt;nx=clamp(nx,-110,110);nz=clamp(nz,-110,110);if(botCanOccupy(bot,nx,bot.z)){bot.x=nx;}else{bot.roamAt=0;}if(botCanOccupy(bot,bot.x,nz)){bot.z=nz;}else{bot.roamAt=0;}bot.motion=distance>14?'sprint':'walk';}
  }else{if(now>bot.roamAt){bot.targetX=clamp(bot.x+(Math.random()-.5)*40,-105,105);bot.targetZ=clamp(bot.z+(Math.random()-.5)*40,-105,105);bot.roamAt=now+2200+Math.random()*2800;}const vx=bot.targetX-bot.x,vz=bot.targetZ-bot.z,d=Math.hypot(vx,vz);if(d>1.2){const nx=bot.x+vx/d*1.7*frameDt,nz=bot.z+vz/d*1.7*frameDt;if(botCanOccupy(bot,nx,bot.z))bot.x=nx;if(botCanOccupy(bot,bot.x,nz))bot.z=nz;bot.yaw=Math.atan2(-vx,-vz);}bot.motion='walk';}
  if(target&&distance<weaponById(bot.weapon).range*.8&&distance>0.1&&now>=bot.nextShot&&bot.stunnedUntil<now){const w=weaponById(bot.weapon);bot.nextShot=now+w.fireMs*(w.auto?.9:1.25)*(0.8+Math.random()*.7);const from=new THREE.Vector3(bot.x,bot.y+1.42,bot.z),to=new THREE.Vector3(target.x,target.y+(target.local&&game.local.motion==='crawl'?.48:target.local&&['crouch','slide'].includes(game.local.motion)?.85:1.03),target.z);const spread=Math.min(5.5,.38+distance*.045),aimPoint=to.clone();aimPoint.x+=(Math.random()-.5)*spread*2;aimPoint.z+=(Math.random()-.5)*spread*2;aimPoint.y+=(Math.random()-.5)*(.2+distance*.018);const blocked=lineBlocked(from,aimPoint),chance=(settings.mode==='sniper'?.16:settings.mode==='pistol'?.23:settings.mode==='melee'?.5:.19),aimError=aimPoint.distanceTo(to),hitRadius=target.local&&game.local.motion==='crawl'?.62:1.05;if(distance<=w.range&&!blocked&&Math.random()<chance&&aimError<hitRadius){const direction=aimPoint.clone().sub(from).normalize();game.showTracer([from.x,from.y,from.z],[direction.x,direction.y,direction.z],Math.min(w.range,distance),w.color);if(target.local){damageLocal(w.damage*.42,bot);}else if(target.alive){target.health-=w.damage*.27;if(target.health<=0)damageBot(target,Math.abs(target.health)+1,false,bot);}}
  }
  game.setBotState(bot.id,{x:bot.x,y:bot.y,z:bot.z,yaw:bot.yaw,motion:bot.stunnedUntil>now?'stunned':bot.motion,weapon:bot.weapon,dead:false});
}}
function tickOfflineObjectives(dt){if(!inMatch||online||dead)return;const now=Date.now();if(settings.gameType==='dom'){
  for(const point of offlineDom){let counts=[0,0];if(Math.hypot(game.local.x-point.x,game.local.z-point.z)<8.5&&localScore.team!==null)counts[localScore.team]++;for(const b of botStates.values())if(b.alive&&b.team!==null&&Math.hypot(b.x-point.x,b.z-point.z)<8.5)counts[b.team]++;if(counts[0]!==counts[1]){const t=counts[0]>counts[1]?0:1;point.progress=clamp(point.progress+(t===0?1:-1)*dt*25,-100,100);if(point.progress>=100)point.owner=0;else if(point.progress<=-100)point.owner=1;else if(point.owner===0&&point.progress<10)point.owner=null;else if(point.owner===1&&point.progress>-10)point.owner=null;}if(point.owner!==null&&now-point.tick>=3000){teamScores[point.owner]++;point.tick=now;}}
  objectiveState={dom:offlineDom,flags:offlineFlags,teamScores};game.setObjectives(objectiveState);
 }
 if(settings.gameType==='ctf'){
  for(const flag of offlineFlags){if(flag.carrier==='local'){flag.x=game.local.x;flag.z=game.local.z;}if(flag.carrier===null&&flag.returnAt&&now>=flag.returnAt){flag.x=flag.homeX;flag.z=flag.homeZ;flag.returnAt=0;}if(flag.team===1&&localCarrying===null&&Math.hypot(game.local.x-flag.x,game.local.z-flag.z)<2.4){localCarrying='red';flag.carrier='local';flag.returnAt=0;centerMessage('ENEMY FLAG TAKEN',900);}const homeFlag=offlineFlags.find(f=>f.team===0);if(flag.carrier==='local'&&flag.team===1&&homeFlag?.carrier===null&&Math.hypot(game.local.x-homeFlag.homeX,game.local.z-homeFlag.homeZ)<4.4){teamScores[0]+=5;localScore.score+=5;localCarrying=null;flag.carrier=null;flag.x=flag.homeX;flag.z=flag.homeZ;flag.returnAt=0;centerMessage('FLAG CAPTURED +5',1300);checkOfflineWin();}}
  objectiveState={dom:offlineDom,flags:offlineFlags,teamScores,carrying:localCarrying};
 }
}
function checkOfflineWin(){if(offlineGameOver||!inMatch||online)return;let winner=null,reason='score';if(settings.gameType==='ffa'){const best=[{id:'local',name:prefs.name,score:localScore.score},...Array.from(botStates.values()).map(b=>({id:b.id,name:b.name,score:b.score}))].sort((a,b)=>b.score-a.score)[0];if(best&&best.score>=settings.scoreLimit)winner=best;}
  else if(Math.max(...teamScores)>=settings.scoreLimit){const team=teamScores[0]===teamScores[1]?null:teamScores[0]>teamScores[1]?0:1;if(team!==null)winner={team};}
  if(!winner&&Date.now()>=matchEndsAt){reason='time';if(settings.gameType==='ffa'){const all=[{id:'local',name:prefs.name,score:localScore.score},...Array.from(botStates.values()).map(b=>({id:b.id,name:b.name,score:b.score}))].sort((a,b)=>b.score-a.score);winner=all[0];}else{const t=teamScores[0]===teamScores[1]?null:teamScores[0]>teamScores[1]?0:1;if(t!==null)winner={team:t};}}
  if(winner||(reason==='time'&&Date.now()>=matchEndsAt)){offlineGameOver=true;showMatchEnd(winner,reason,localScore,teamScores);}}
function handleOnlineMatchEnd(msg){matchEnding=true;inMatch=true;game.freezeInput(true);game.setActive(false);showMatchEnd(msg.winner,msg.reason,msg.stats?.players?.find(p=>p.id===localId)||localScore,msg.stats?.teams||teamScores);}
function showMatchEnd(winner,reason,me,teams){matchEnding=true;inMatch=false;dead=false;game.freezeInput(true);game.setActive(false);$deathPanel.classList.add('hidden');$pausePanel.classList.add('hidden');$('scoreboard').classList.add('hidden');$hud.classList.remove('hidden');$matchEndPanel.classList.remove('hidden');const won=winner?(winner.id!==undefined?(winner.id===localId||winner.id==='local'):winner.team!==null&&winner.team===localScore.team):false;$('matchEndTitle').textContent=winner?(won?'VICTORY':'DEFEAT'):'DRAW';$('matchEndTitle').style.color=winner?(won?'var(--lime)':'var(--red)'):'var(--gold)';$('matchEndDescription').textContent=reason==='time'?'Time expired. Final scores are locked.':settings.gameType==='ctf'?'The flag operation has concluded.':'The score limit was reached.';const k=me?.kills??localScore.kills,d=me?.deaths??localScore.deaths,score=me?.score??localScore.score;$('matchEndStats').innerHTML=`<div class="end-summary"><div class="end-stat"><small>ELIMINATIONS</small><b>${k}</b></div><div class="end-stat"><small>DEATHS</small><b>${d}</b></div><div class="end-stat"><small>POINTS</small><b>${score}</b></div></div><div class="end-summary"><div class="end-stat"><small>BLUE TEAM</small><b>${teams?.[0]??0}</b></div><div class="end-stat"><small>RED TEAM</small><b>${teams?.[1]??0}</b></div><div class="end-stat"><small>MAP</small><b style="font-size:19px">${(MAPS.find(m=>m.id===settings.map)?.name||'MAP').split(' ')[0].toUpperCase()}</b></div></div>`;}
$('returnLobby').addEventListener('click',()=>{if(online&&network?.connected){inMatch=false;matchEnding=false;dead=false;$matchEndPanel.classList.add('hidden');$hud.classList.add('hidden');$menu.classList.remove('hidden');game.setActive(false);game.freezeInput(true);network.send('requestState');network.send('ready',{ready:false});$('confirmLoadout').disabled=false;renderLobby();}else leaveToMenu();});
function leaveToMenu(){game.clearCombatEffects();inMatch=false;dead=false;matchEnding=false;matchKind='solo';pendingMatch=null;online=false;isHost=false;roomCode='';network?.send('leave');network?.close();network=null;clearInterval(deathInterval);clearTimeout(localMatchEndTimer);clearOfflineBots();$menu.classList.remove('hidden');$loadoutScreen.classList.add('hidden');$hud.classList.add('hidden');$pausePanel.classList.add('hidden');$deathPanel.classList.add('hidden');$matchEndPanel.classList.add('hidden');$lobbyPanel.classList.add('hidden');game.setActive(false);game.freezeInput(true);lockLobbySettings(false);renderLobby();}
$('leaveMatch').addEventListener('click',leaveToMenu);
function pauseMatch(force=false){if(!inMatch||matchEnding)return;const opening=force||$pausePanel.classList.contains('hidden');if(opening){$('switchTeamButton')?.classList.toggle('hidden',!GAME_TYPES.find(t=>t.id===settings.gameType)?.team);$pausePanel.classList.remove('hidden');game.freezeInput(true);try{document.exitPointerLock?.();}catch{}}else{$pausePanel.classList.add('hidden');game.freezeInput(false);game.requestPointerLock();}}
$('resumeMatch').addEventListener('click',()=>pauseMatch(false));
$('switchTeamButton')?.addEventListener('click',()=>switchTeams());
$('controlsToggle')?.addEventListener('click',()=>{const card=$('controlsCard');if(!card)return;const hidden=card.classList.toggle('is-collapsed');prefs.showControls=!hidden;$('controlsToggle').setAttribute('aria-expanded',String(!hidden));$('controlsToggle').textContent=hidden?'CONTROLS +':'CONTROLS −';savePrefs();});
if(prefs.showControls===false){$('controlsCard')?.classList.add('is-collapsed');$('controlsToggle')?.setAttribute('aria-expanded','false');if($('controlsToggle'))$('controlsToggle').textContent='CONTROLS +';}

function updateHUD(force=false){if(!inMatch&&!matchEnding)return;const now=Date.now(),w=weaponById(currentWeaponId),a=ammoMap[currentWeaponId]||{current:0,reserve:0};$('hudGameType').textContent=(GAME_TYPES.find(g=>g.id===settings.gameType)?.name||'MATCH').toUpperCase();$('hudMode').textContent=(PLAY_MODES.find(m=>m.id===settings.mode)?.name||'ALL WEAPONS').toUpperCase();$('healthValue').textContent=Math.ceil(health);$('healthMeter').style.width=`${clamp(health,0,100)}%`;$('shieldValue').textContent=Math.ceil(shield);$('shieldMeter').style.width=`${clamp(shield,0,100)}%`;$('staminaFill').style.width=`${game.local.stamina||100}%`;$('weaponHud').textContent=meleeThrown&&w.kind==='melee'?'MELEE DROPPED':w.name.toUpperCase();$('weaponCategoryHud').textContent=w.category.toUpperCase();$('ammoCurrent').textContent=w.kind==='gun'?(isReloading(reloadsByWeapon,w.id,performance.now())?'↻':a.current??w.mag):'—';$('ammoReserve').textContent=w.kind==='gun'?(a.reserve??w.reserve):'MELEE';$('hudGun1').textContent=weaponById(loadout.guns[0]).name.toUpperCase();$('hudGun2').textContent=weaponById(loadout.guns[1]).name.toUpperCase();$('hudMelee').textContent=meleeThrown?'DROPPED':weaponById(susiSwordUnlocked?'susis_sword':loadout.melee).name.toUpperCase();byData('.weapon-slot').forEach(el=>{const slot=+el.dataset.hudSlot;el.classList.toggle('active',weaponForSlot(slot)===currentWeaponId);el.style.opacity=modeAllowed(weaponForSlot(slot))?'1':'.32';});
  const seconds=Math.max(0,Math.ceil((matchEndsAt-now)/1000));const mins=String(Math.floor(seconds/60)).padStart(2,'0'),secs=String(seconds%60).padStart(2,'0');$('matchClock').textContent=now<matchStartedAt?`00:${String(Math.ceil((matchStartedAt-now)/1000)).padStart(2,'0')}`:`${mins}:${secs}`;$('matchPhase').textContent=now<matchStartedAt?'PREPARE':seconds<60?'FINAL MINUTE':'MATCH LIVE';
  const blueLabel=$('teamScoreBlue').querySelector('small'),redLabel=$('teamScoreRed').querySelector('small');if(settings.gameType==='ffa'){const players=scoreboardPlayers().sort((a,b)=>(b.score||0)-(a.score||0));const mine=players.find(p=>p.id===localId||p.id==='local');blueLabel.textContent='YOU';redLabel.textContent='LEADER';$('teamScoreBlue').querySelector('b').textContent=mine?.score??localScore.score;$('teamScoreRed').querySelector('b').textContent=players[0]?.score??0;}else{blueLabel.textContent='BLUE';redLabel.textContent='RED';$('teamScoreBlue').querySelector('b').textContent=teamScores[0]||0;$('teamScoreRed').querySelector('b').textContent=teamScores[1]||0;}
  const rewardChips=[];if(susiSwordUnlocked)rewardChips.push('<span class="power-chip" style="--power-color:#17141f">SUSI’S SWORD · B</span>');if(meleeThrown)rewardChips.push('<span class="power-chip" style="--power-color:#f3e9bd">MELEE DROPPED · Y</span>');const powers=Object.entries(powerupExpiries).filter(([id,expiry])=>expiry>now).map(([id,expiry])=>{const def=POWERUPS.find(p=>p.id===id);return `<span class="power-chip" style="--power-color:${def?.color||'#fff'}">${def?.name||id} ${Math.ceil((expiry-now)/1000)}s</span>`;}).join('');$('powerupHud').innerHTML=(shield>0?'<span class="power-chip" style="--power-color:var(--blue)">SHIELD '+Math.ceil(shield)+'</span>':'')+powers+rewardChips.join('');const nextReward=nextKillStreakReward(streak);const streakValue=$('killstreakValue'),streakNext=$('killstreakNext'),streakFill=$('killstreakFill');if(streakValue)streakValue.textContent=String(streak);if(streakNext)streakNext.textContent=nextReward?`${Math.max(0,nextReward.at-streak)} KILLS → ${nextReward.name.toUpperCase()}`:'SINGULARITY READY · PRESS B';if(streakFill){const start=nextReward?(nextReward.at===5?0:nextReward.at===10?5:10):20;streakFill.style.width=`${nextReward?clamp((streak-start)/(nextReward.at-start)*100,0,100):100}%`; }
  if(settings.gameType==='dom'&&objectiveState?.dom){$('objectiveStatus').innerHTML=objectiveState.dom.map(p=>`<div class="objective-line"><span class="objective-dot" style="background:${p.owner===0?'var(--blue)':p.owner===1?'var(--red)':'#88989f'}"></span><b>${p.id}</b><span>${p.owner===0?'BLUE CONTROL':p.owner===1?'RED CONTROL':`${Math.round(Math.abs(p.progress||0))}% CAPTURE`}</span></div>`).join('');}else if(settings.gameType==='ctf'){$('objectiveStatus').innerHTML=`<div class="objective-line"><span class="objective-dot" style="background:var(--red)"></span><b>ENEMY FLAG</b><span>${localCarrying?'CARRIED — RETURN TO BASE':'STEAL & CAPTURE'}</span></div><div class="objective-line"><span class="objective-dot" style="background:var(--blue)"></span><b>HOME FLAG</b><span>DEFEND YOUR BASE</span></div>`;}else $('objectiveStatus').innerHTML='';
  if(now>=matchEndsAt&&!online)checkOfflineWin();if(now<matchStartedAt&&inMatch)game.freezeInput(true);else if(inMatch&&!dead&&$pausePanel.classList.contains('hidden'))game.freezeInput(false);
  if(force)renderScoreboard();
}
function scoreboardPlayers(){if(online)return (liveRoster.length?liveRoster:roster).map(p=>({...p}));return [{id:'local',name:prefs.name,team:localScore.team,kills:localScore.kills,deaths:localScore.deaths,score:localScore.score},...Array.from(botStates.values()).map(b=>({id:b.id,name:b.name,team:b.team,kills:b.kills,deaths:b.deaths,score:b.score}))];}
function renderScoreboard(){const players=scoreboardPlayers().sort((a,b)=>(b.score||0)-(a.score||0)||(b.kills||0)-(a.kills||0));const table=document.createElement('table');table.className='score-table';table.innerHTML='<thead><tr><th>OPERATOR</th><th>TEAM</th><th>K</th><th>D</th><th>PTS</th></tr></thead>';const body=document.createElement('tbody');for(const p of players){const tr=document.createElement('tr');if(p.id===localId||p.id==='local')tr.className='is-me';const name=document.createElement('td');name.textContent=p.name||'Operator';const team=document.createElement('td');const dot=document.createElement('i');dot.className='team-tag';dot.style.background=p.team===1?'var(--red)':p.team===0?'var(--blue)':'#a8b4ba';team.append(dot,document.createTextNode(p.team===0?'BLUE':p.team===1?'RED':'—'));const k=document.createElement('td');k.textContent=p.kills||0;const d=document.createElement('td');d.textContent=p.deaths||0;const sc=document.createElement('td');sc.textContent=p.score||0;tr.replaceChildren(name,team,k,d,sc);body.append(tr);}table.append(body);const root=$('scoreboardContent');root.innerHTML='';root.append(table);$('scoreboardRoom').textContent=online?`ROOM ${roomCode}`:'SOLO PRACTICE';}

function tickReload(){const now=performance.now();for(const [id,endAt] of Object.entries(reloadsByWeapon)){if(endAt>now)continue;if(online&&network?.connected)continue;const w=weaponById(id),a=ammoMap[id];if(a){const need=Math.max(0,w.mag-a.current),loaded=Math.min(need,a.reserve);a.current+=loaded;a.reserve-=loaded;}clearReload(reloadsByWeapon,id);if(a&&id===currentWeaponId)showToast(`${w.name.toUpperCase()} RELOADED`);}}
function syncState(force=false){if(!online||!network?.connected||!inMatch||dead||pendingMatch)return;const now=performance.now();if(!force&&now-lastSyncAt<60)return;lastSyncAt=now;const p=game.local;network.send('state',{x:p.x,y:p.y,z:p.z,yaw:game.yaw,pitch:game.pitch,motion:p.motion,aiming:!!game.aiming,weapon:currentWeaponId,vehicle:p.vehicleType||null});}
function tickPickupRespawn(){const n=Date.now();for(const p of game.pickups){if(!p.userData.active&&p.userData.cooldownUntil&&n>=p.userData.cooldownUntil){p.userData.active=true;p.userData.cooldownUntil=0;p.visible=true;}}}
function tickOfflineFlagsAndTimer(dt){if(!online&&inMatch&&!dead){tickOfflineObjectives(dt);}}

// Render/update loop. Gameplay state is updated every frame; network state is sent at 16–20 Hz.
let lastFrame=performance.now();function frame(now){requestAnimationFrame(frame);const dt=Math.min(.05,(now-lastFrame)/1000||0);lastFrame=now;const canMove=inMatch&&!dead&&!matchEnding&&!pendingMatch&&$pausePanel.classList.contains('hidden');const weapon=weaponById(currentWeaponId);game.update(dt,{playing:inMatch,alive:!dead,inputAllowed:canMove,currentWeapon:weapon,canFire:canMove&&Date.now()>=matchStartedAt&&!['backflip','trip','stunned'].includes(game.local.motion),speedBoost:powerupExpiries.speed>Date.now(),jumpBoost:powerupExpiries.jump>Date.now()});const scoped=!!(game.aiming&&inMatch&&!dead&&['sniper','marksman','crossbow'].includes(weapon.id));$('scopeOverlay')?.classList.toggle('visible',scoped);$('scopeOverlay')?.setAttribute('aria-hidden',String(!scoped));
  if(inMatch&&!matchEnding){tickReload();tickPickupRespawn();if(!online){updateBots(dt);updateOfflineDroneAttacks();tickOfflineFlagsAndTimer(dt);checkOfflineWin();if(localMeleeDrop&&Date.now()>=localMeleeDrop.expiresAt){game.removeMeleeDrop(localMeleeDrop.id);localMeleeDrop=null;meleeThrown=true;meleeLost=true;showToast('You lost your melee weapon.','warn');}}syncState();if(now-lastHudAt>80){lastHudAt=now;updateHUD();}if(!$('scoreboard').classList.contains('hidden')&&now-lastScoreboardAt>400){lastScoreboardAt=now;renderScoreboard();}}
}
requestAnimationFrame(frame);

// After core input callbacks are registered, handle online/solo start + respawn transitions.
// GameWorld reports only actual mouse-down events here; automatic guns repeat from its frame callback.
game.setCallbacks({onAction:handleAction,onAutoFire:()=>handleAction('autoFire'),onPickup:p=>collectPickup(p),onPerformanceFallback:()=>showToast('Graphics were reduced to keep gameplay smooth on this device.','warn')});

// The canvas class receives a real press event from the input handler without hijacking UI buttons.
// Rebind through the callback surface instead of relying on untrusted DOM event targets.
finishBoot();

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
const refs = new Set([...js.matchAll(/\$\(["']([^"']+)["']\)/g)].map(m => m[1]));
const missing = [...refs].filter(id => !ids.has(id));
if (missing.length) {
  console.error(`DOM audit failed; missing ids: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`DOM audit passed: ${refs.size} referenced elements resolve in index.html.`);
}
for (const filename of ['src/main.js','src/game.js','src/maps.js','src/network.js','server/server.mjs','shared/game-data.js','shared/map-layout.js','shared/combat-geometry.js','shared/raycast-grid.js','shared/killstreaks.js','shared/reload-state.js']) {
  const code = fs.readFileSync(path.join(root, filename), 'utf8');
  for (const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const importPath = path.resolve(path.dirname(path.join(root, filename)), match[1]);
    if (!fs.existsSync(importPath)) {
      console.error(`Import audit failed: ${filename} references missing ${match[1]}`);
      process.exitCode = 1;
    }
  }
}
if (!process.exitCode) console.log('Local module import audit passed.');

const requiredPlayerFeatures = [
  ['branded loading screen', html.includes('id="bootLoader"')],
  ['studio credit', html.includes('Created by <strong>KuchurPuchur Studios</strong>')],
  ['three-hour fact', html.includes('The entire game was built in 3 hours.')],
  ['background music controls', html.includes('id="musicToggle"') && html.includes('id="musicNext"')],
  ['five selectable default skins', ['vanguard','night-ops','desert-ranger','arctic','neon-recon'].every(id=>html.includes(`value="${id}"`))],

  ['pause-screen music controls', html.includes('id="musicTogglePause"') && html.includes('id="musicNextPause"')],
];
for (const [label, ok] of requiredPlayerFeatures) {
  if (!ok) {
    console.error(`Release UI audit failed: missing ${label}.`);
    process.exitCode = 1;
  }
}
for (const forbiddenId of ['serverUrl','mapAssetStatus','exportMapColliders']) {
  if (new RegExp(`\\bid=["']${forbiddenId}["']`).test(html)) {
    console.error(`Release UI audit failed: obsolete player control ${forbiddenId} remains.`);
    process.exitCode = 1;
  }
}
const mapSource = fs.readFileSync(path.join(root, 'src/maps.js'), 'utf8');
if (/GLTFLoader|DRACOLoader|MeshoptDecoder|assetUrl|externalMap/i.test(mapSource)) {
  console.error('Release map audit failed: imported-map loader code remains.');
  process.exitCode = 1;
}
const mapSourceAudit = fs.readFileSync(path.join(root, 'src/maps.js'), 'utf8');
const gameSourceAudit = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
const serverSourceAudit = fs.readFileSync(path.join(root, 'server/server.mjs'), 'utf8');
const rayGridSource = fs.readFileSync(path.join(root, 'shared/raycast-grid.js'), 'utf8');
for (const [label, ok] of [
  ['rotated collider footprints', mapSourceAudit.includes('rotatedFootprint(w,d,opts.rotationY||0)')],
  ['horizontal log collider', mapSourceAudit.includes("{w:3.2,h:1.1,d:1.1}")],
  ['fresh aim direction', gameSourceAudit.includes('const aimPitch=this.pitch-this.cameraRecoil+flipProgress*Math.PI*2;')],
  ['exact client grid traversal', gameSourceAudit.includes('rayGridCells(origin,direction,maxDistance,cell)')],
  ['exact server grid traversal', serverSourceAudit.includes('rayGridCells(o,d,maxDistance,index.cellSize)')],
  ['corner-safe grid traversal', rayGridSource.includes('Supercover corners')],
  ['confirmed shooter hit markers', serverSourceAudit.includes("type:'hitmarker',kind:hit.head?'head':'normal'")],
  ['blocked-shot feedback is visually distinct', js.includes("kind==='blocked'?'#9ea8ae'")],
  ['thrown melee resets on death', serverSourceAudit.includes('target.meleeThrown=false;target.meleeLost=false')],
  ['thrown melee reset on deploy', serverSourceAudit.includes('p.meleeThrown=false;p.meleeLost=false;p.meleeDropId=null')],
  ['distinct Susi sword view model', gameSourceAudit.includes("id==='susis_sword'") && gameSourceAudit.includes('voidEdge')],
  ['remote melee swing animation', gameSourceAudit.includes('swingRemote(id)') && gameSourceAudit.includes('p.swingUntil>performance.now()')],
  ['shoulder and hip pivot animation rig', gameSourceAudit.includes('pivotPart(4,12,4,[40,16]') && gameSourceAudit.includes('pivotPart(4,12,4,[0,16]')],
  ['white drone paint projectile visuals', gameSourceAudit.includes('showPaintShot(fromValues,toValues)') && serverSourceAudit.includes("type:'paintShot'") && js.includes("case 'paintShot'")],
  ['killstreak reward schedule shared by client/server', js.includes('rewardsForKillStreak(streak)') && serverSourceAudit.includes('rewardsForKillStreak(killer.killStreak)')],
  ['killstreak progress HUD', html.includes('id="killstreakValue"') && js.includes('nextKillStreakReward(streak)')],
  ['remote melee becomes visibly unarmed when thrown', gameSourceAudit.includes("info.meleeThrown?'unarmed'") && gameSourceAudit.includes("if(id==='unarmed')")],
  ['VizBlaster pump animation', gameSourceAudit.includes('this.vmPump.userData.pumped=true') && gameSourceAudit.includes('pump=new THREE.Group()')],
  ['skin atlas is opaque and headwear is aligned', gameSourceAudit.includes('transparent:false') && gameSourceAudit.includes('c.position.y=.285') && gameSourceAudit.includes('head.position.set(0,.685,0)') && gameSourceAudit.includes('d.head.position.set(0,.505,0)')],
  ['reward event does not double-count the same kill', js.includes('serverStreakSync=true;unlockReward(msg.reward,msg.streak)') && js.includes('if(online&&serverStreakSync)serverStreakSync=false;else streak++')],
  ['melee pickup restores the dropped weapon', js.includes('currentWeaponId=drop.weapon||loadout.melee') && js.includes('game.local.weapon=currentWeaponId')],
  ['stunned first-person camera and stance restrictions', gameSourceAudit.includes("const stunnedNow=p.motion==='stunned'") && gameSourceAudit.includes("!['crawl','slide','stunned','trip','backflip'].includes(p.motion)")],
  ['jump cannot cancel a forced movement animation', js.includes("!['crawl','slide','stunned','trip','backflip'].includes(game.local.motion)")],
  ['interior stuck-player recovery scan', gameSourceAudit.includes('for(let x=-112;x<=112;x+=4)for(let z=-112;z<=112;z+=4)if(recover(x,z))return')],
]) {
  if (!ok) { console.error(`Combat/collision audit failed: ${label}.`); process.exitCode = 1; }
}
if (!process.exitCode) console.log('Combat and map-collision regression audit passed.');


const featureAudit = [
  ['deep per-weapon optical zoom', gameSourceAudit.includes('sniper:10.5,marksman:16,crossbow:20')],
  ['scope reticle and lens UI', html.includes('id="scopeOverlay"') && fs.readFileSync(path.join(root,'src/styles.css'),'utf8').includes('.scope-overlay.visible~.center-reticle')],
  ['reloads tracked independently per weapon', serverSourceAudit.includes('isReloading(p.reloads,id,now())') && serverSourceAudit.includes('Object.entries(p.reloads||{})')],
  ['team switching in team-based matches', serverSourceAudit.includes("case 'switchTeam'") && js.includes("network.send('switchTeam')")],
  ['all requested drivable vehicle choices', ['atlas-cycle','yamaha-bike','royal-enfield','decathlon-skateboard','rdx-hoverboard'].every(id=>js.includes(id)||fs.readFileSync(path.join(root,'shared/game-data.js'),'utf8').includes(id))],
  ['vehicle selection synchronized before online match', serverSourceAudit.includes("case 'vehicleChoice'") && js.includes("network.send('vehicleChoice'")],
  ['remote vehicles cleared on respawn', js.includes('vehicle:msg.vehicle||null') && serverSourceAudit.includes('vehicle:null')],
  ['toggleable compact controls overlay', html.includes('id="controlsToggle"') && js.includes("classList.toggle('is-collapsed')")],
  ['bot spread and reduced aim accuracy', js.includes('aimPoint.distanceTo(to)') && js.includes("settings.mode==='sniper'?.16")],
  ['actual remote backflip rotation', gameSourceAudit.includes('rig.rotation.x=Math.PI*2*progress') && serverSourceAudit.includes('backflip:950')],
  ['Sword of Lilith is a valid melee weapon', fs.readFileSync(path.join(root,'shared/game-data.js'),'utf8').includes("id:'lilith_sword'")],
];
for (const [label, ok] of featureAudit) {
  if (!ok) { console.error(`Gameplay feature audit failed: ${label}.`); process.exitCode = 1; }
}
if (!process.exitCode) console.log('Gameplay feature audit passed.');

if (!process.exitCode) console.log('Final-release UI and built-in-map audit passed.');

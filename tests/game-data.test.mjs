import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, GAME_TYPES, PLAY_MODES, WEAPONS, POWERUPS, VEHICLES, WORLD_LIMIT, vehicleById, weaponById, normalizeLoadout, activeLoadoutIds, allowedWeapon } from '../shared/game-data.js';
import { getDistrictFootprints, getSpawnCandidates } from '../shared/map-layout.js';

test('project data includes the required game types, modes, maps, and power-ups', () => {
  assert.equal(GAME_TYPES.length, 4);
  assert.deepEqual(new Set(GAME_TYPES.map(x => x.id)), new Set(['tdm','ffa','ctf','dom']));
  assert.equal(PLAY_MODES.length, 4);
  assert.deepEqual(new Set(PLAY_MODES.map(x => x.id)), new Set(['all','melee','pistol','sniper']));
  assert.equal(MAPS.length, 5);
  assert.deepEqual(MAPS.map(map => map.id), ['metro','atlas','dune','pine','oldtown']);
  assert.ok(MAPS.every(map => !map.external && !map.assetUrl));
  assert.ok(MAPS.every(map => map.name && map.subtitle && map.biome));
  assert.equal(POWERUPS.length, 6);
});

test('loadouts normalize to exactly two distinct unlocked guns and one melee weapon', () => {
  const out = normalizeLoadout({ guns: ['rifle','rifle','totally-invalid'], melee: 'not-a-melee' });
  assert.equal(out.guns.length, 2);
  assert.equal(new Set(out.guns).size, 2);
  assert.ok(out.guns.every(id => weaponById(id).kind === 'gun'));
  assert.equal(weaponById(out.melee).kind, 'melee');
  assert.equal(out.melee, 'knife');
});

test('gameplay modes filter usable weapon slots independently of game type', () => {
  const loadout = normalizeLoadout({ guns: ['pistol','revolver'], melee: 'axe' });
  assert.deepEqual(activeLoadoutIds(loadout, 'melee'), ['axe']);
  assert.ok(activeLoadoutIds(loadout, 'pistol').every(id => allowedWeapon(weaponById(id), 'pistol')));
  assert.ok(activeLoadoutIds(loadout, 'sniper').every(id => allowedWeapon(weaponById(id), 'sniper')));
  assert.deepEqual(activeLoadoutIds(loadout, 'all'), ['pistol','revolver','axe']);
});

test('weapon definitions use unique ids and valid ammo/combat parameters', () => {
  const ids = WEAPONS.map(w => w.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 16);
  for (const w of WEAPONS) {
    assert.ok(w.name && w.description && w.color, `${w.id} has display metadata`);
    assert.ok(w.damage > 0 && w.fireMs > 0 && w.range > 0, `${w.id} has usable combat stats`);
    if (w.kind === 'gun') assert.ok(w.mag > 0 && w.reserve >= 0 && w.reloadMs > 0, `${w.id} has ammo data`);
    else assert.equal(w.category, 'melee');
  }
});


test('each built-in arena has a distinct layout and usable edge deployment lanes',()=>{
  const layouts=MAPS.map(map=>JSON.stringify(getDistrictFootprints(map.id).map(({x,z,w,d,h})=>({x,z,w,d,h}))));
  assert.equal(new Set(layouts).size,MAPS.length,'map footprints should not all collapse to one layout');
  for(const map of MAPS){
    for(const team of [0,1]){
      const spawns=getSpawnCandidates(map.id,team);
      assert.ok(spawns.length>=15,`${map.id} should have multiple spawn choices per team`);
      assert.ok(spawns.every(p=>Math.abs(p.x)<WORLD_LIMIT&&Math.abs(p.z)<WORLD_LIMIT),`${map.id} spawns must remain inside world bounds`);
      assert.ok(spawns.every(p=>Math.sign(p.x)===(team===0?-1:1)),`${map.id} team spawns should stay on their side`);
    }
  }
});

test('VizBlaster and the streak reward blade remain defined weapon entries',()=>{
  assert.equal(weaponById('vizblaster').category,'shotgun');
  assert.equal(weaponById('vizblaster').pellets,9);
  assert.equal(weaponById('susis_sword').kind,'melee');
  assert.equal(weaponById('susis_sword').unlockStreak,20);
});


import { rewardsForKillStreak, nextKillStreakReward } from '../shared/killstreaks.js';
import { SKIN_PRESETS } from '../src/skin-presets.js';

test('kill streak reward schedule grants cumulative rewards at 5, 10, and 20 kills',()=>{
  assert.deepEqual(rewardsForKillStreak(4),[]);
  assert.deepEqual(rewardsForKillStreak(5),['drone']);
  assert.deepEqual(rewardsForKillStreak(10),['drone','ss-strike']);
  assert.deepEqual(rewardsForKillStreak(20),['drone','ss-strike','susi-sword']);
  assert.equal(nextKillStreakReward(0).at,5);
  assert.equal(nextKillStreakReward(7).at,10);
  assert.equal(nextKillStreakReward(15).id,'susi-sword');
  assert.equal(nextKillStreakReward(20),null);
});

test('VizBlaster remains a close-range nine-pellet shotgun with balanced timing',()=>{
  const w=weaponById('vizblaster');
  assert.equal(w.pellets,9);
  assert.ok(w.damage>0&&w.damage<=100);
  assert.ok(w.range<=35);
  assert.ok(w.fireMs>=700);
});


test('five named default skins are selectable and have complete color palettes',()=>{
  assert.equal(SKIN_PRESETS.length,5);
  assert.deepEqual(SKIN_PRESETS.map(s=>s.id),['vanguard','night-ops','desert-ranger','arctic','neon-recon']);
  for(const skin of SKIN_PRESETS){
    for(const key of ['name','skin','hair','shirt','pants','accent'])assert.ok(skin[key],`${skin.id} missing ${key}`);
  }
});


test('all five selectable vehicles have distinct IDs and valid handling data',()=>{
  assert.equal(VEHICLES.length,5);
  assert.equal(new Set(VEHICLES.map(v=>v.id)).size,5);
  assert.deepEqual(VEHICLES.map(v=>v.id),['atlas-cycle','yamaha-bike','royal-enfield','decathlon-skateboard','rdx-hoverboard']);
  for(const vehicle of VEHICLES){assert.ok(vehicle.name&&vehicle.description);assert.ok(vehicle.speed>0);assert.ok(vehicle.handling>=0&&vehicle.handling<=100);assert.equal(vehicleById(vehicle.id).id,vehicle.id);}
});


test('reload timings are tuned per gun rather than shared globally',()=>{
  assert.ok(weaponById('pistol').reloadMs < weaponById('rifle').reloadMs);
  assert.ok(weaponById('rifle').reloadMs < weaponById('lmg').reloadMs);
  assert.ok(weaponById('sniper').reloadMs > weaponById('crossbow').reloadMs);
});

export const MAPS = [
  { id: 'metro', name: 'Metro District', subtitle: 'Downtown · rail yard · rooftops', biome: 'city', sky: 0x9bb4c8, fog: 0xb1bdc5, ground: '#62696d', road: '#33383c', wall: '#777d80', accent: '#60a9b6', objectivePositions:{ctf:[{id:'blue',team:0,x:-102,y:0,z:0},{id:'red',team:1,x:102,y:0,z:0}],dom:[{id:'A',x:-44,z:-44},{id:'B',x:0,z:44},{id:'C',x:44,z:-44}]} },
  { id: 'atlas', name: 'Fort Atlas', subtitle: 'Forward base · hangars · watchtowers', biome: 'military', sky: 0x9ba99a, fog: 0xb8b9a9, ground: '#777866', road: '#484d42', wall: '#737766', accent: '#c4b77a', objectivePositions:{ctf:[{id:'blue',team:0,x:-100,y:0,z:0},{id:'red',team:1,x:100,y:0,z:0}],dom:[{id:'A',x:-58,z:0},{id:'B',x:0,z:62},{id:'C',x:58,z:0}]} },
  { id: 'dune', name: 'Red Dune Works', subtitle: 'Refinery · containers · dry ravines', biome: 'desert', sky: 0xd5b58e, fog: 0xcdb28c, ground: '#b99668', road: '#6f604d', wall: '#9a7954', accent: '#e5a154', objectivePositions:{ctf:[{id:'blue',team:0,x:-102,y:0,z:0},{id:'red',team:1,x:102,y:0,z:0}],dom:[{id:'A',x:-60,z:-56},{id:'B',x:0,z:54},{id:'C',x:60,z:-52}]} },
  { id: 'pine', name: 'Pine Research', subtitle: 'Conifer forest · labs · service tunnels', biome: 'forest', sky: 0x90aca6, fog: 0x8daba1, ground: '#4e6652', road: '#4b5550', wall: '#6f7a77', accent: '#88bf9a', objectivePositions:{ctf:[{id:'blue',team:0,x:-56,y:0,z:0},{id:'red',team:1,x:56,y:0,z:0}],dom:[{id:'A',x:-58,z:-24},{id:'B',x:58,z:0},{id:'C',x:0,z:60}]} },
  { id: 'oldtown', name: 'Old Quarter', subtitle: 'Abandoned blocks · collapsed streets · courtyards', biome: 'ruins', sky: 0x99999b, fog: 0xa6a3a0, ground: '#656362', road: '#3b3b3b', wall: '#6d6762', accent: '#c68c6e', objectivePositions:{ctf:[{id:'blue',team:0,x:-102,y:0,z:0},{id:'red',team:1,x:102,y:0,z:0}],dom:[{id:'A',x:-60,z:-54},{id:'B',x:60,z:0},{id:'C',x:-18,z:58}]} },
];

// Damage is per confirmed hit. All inventory items are unlocked; modes filter what can be used in a match.
export const WEAPONS = [
  { id:'pistol', name:'Pistol', category:'pistol', kind:'gun', damage:23, fireMs:260, mag:15, reserve:90, reloadMs:1150, spread:.006, range:75, auto:false, recoil:.018, color:'#c8d2d8', handling:78, accuracy:74, power:42, description:'Fast, dependable sidearm.' },
  { id:'revolver', name:'Revolver', category:'pistol', kind:'gun', damage:48, fireMs:510, mag:6, reserve:48, reloadMs:1550, spread:.003, range:88, auto:false, recoil:.045, color:'#b69a72', handling:52, accuracy:88, power:80, description:'Heavy single-shot precision.' },
  { id:'smg', name:'SMG', category:'smg', kind:'gun', damage:13, fireMs:82, mag:32, reserve:160, reloadMs:1450, spread:.02, range:60, auto:true, recoil:.017, color:'#71c2d8', handling:91, accuracy:55, power:43, description:'Compact close-range spray.' },
  { id:'rifle', name:'Assault Rifle', category:'rifle', kind:'gun', damage:19, fireMs:115, mag:30, reserve:150, reloadMs:1750, spread:.009, range:105, auto:true, recoil:.024, color:'#92b18d', handling:74, accuracy:77, power:67, description:'Versatile full-auto rifle.' },
  { id:'shotgun', name:'Shotgun', category:'shotgun', kind:'gun', damage:64, pellets:8, fireMs:820, mag:8, reserve:48, reloadMs:1900, spread:.055, range:24, auto:false, recoil:.075, color:'#c88f60', handling:44, accuracy:38, power:96, description:'Devastating at room distance.' },
  { id:'vizblaster', name:'VizBlaster', category:'shotgun', kind:'gun', damage:81, pellets:9, fireMs:880, mag:7, reserve:42, reloadMs:1980, spread:.068, range:29, auto:false, recoil:.085, color:'#a7f4ff', handling:43, accuracy:48, power:100, description:'Nine-pellet breacher with a pump-action cycle and tight indoor grouping.' },
  { id:'sniper', name:'Sniper Rifle', category:'sniper', kind:'gun', damage:92, fireMs:980, mag:5, reserve:35, reloadMs:2200, spread:.0004, range:220, auto:false, recoil:.09, color:'#8394ac', handling:37, accuracy:99, power:100, description:'High-impact long-range rifle.' },
  { id:'lmg', name:'LMG', category:'lmg', kind:'gun', damage:16, fireMs:105, mag:75, reserve:225, reloadMs:2850, spread:.018, range:92, auto:true, recoil:.028, color:'#a9a09a', handling:40, accuracy:66, power:64, description:'Sustained fire and large magazine.' },
  { id:'minigun', name:'Minigun', category:'lmg', kind:'gun', damage:9, fireMs:55, mag:120, reserve:360, reloadMs:3300, spread:.032, range:76, auto:true, recoil:.011, color:'#d7a45c', handling:25, accuracy:53, power:62, description:'Spins up into a wall of fire.' },
  { id:'laser', name:'Laser Rifle', category:'rifle', kind:'gun', damage:17, fireMs:90, mag:36, reserve:180, reloadMs:1650, spread:.004, range:125, auto:true, recoil:.008, color:'#d18bff', handling:82, accuracy:89, power:58, description:'Stable energy weapon with a bright trace.' },
  { id:'crossbow', name:'Crossbow', category:'sniper', kind:'gun', damage:78, fireMs:760, mag:1, reserve:20, reloadMs:1250, spread:.001, range:135, auto:false, recoil:.02, color:'#bfa081', handling:56, accuracy:93, power:84, description:'Quiet, deliberate projectile weapon.' },
  { id:'burst', name:'Burst Rifle', category:'rifle', kind:'gun', damage:21, fireMs:390, mag:24, reserve:120, reloadMs:1700, spread:.007, range:115, auto:false, burst:3, recoil:.027, color:'#6eb6ab', handling:69, accuracy:85, power:70, description:'Three-round burst for controlled fights.' },
  { id:'marksman', name:'Marksman Rifle', category:'sniper', kind:'gun', damage:53, fireMs:420, mag:10, reserve:70, reloadMs:1800, spread:.002, range:175, auto:false, recoil:.04, color:'#9babc3', handling:58, accuracy:95, power:87, description:'Semi-automatic precision rifle.' },
  { id:'knife', name:'Combat Knife', category:'melee', kind:'melee', damage:38, fireMs:430, range:2.15, recoil:.02, color:'#dce4e9', handling:96, accuracy:80, power:38, description:'Quick, quiet close-quarters strike.' },
  { id:'sword', name:'Field Sword', category:'melee', kind:'melee', damage:52, fireMs:630, range:2.65, recoil:.035, color:'#78d5ec', handling:72, accuracy:75, power:58, description:'Balanced blade with extended reach.' },
  { id:'axe', name:'Breach Axe', category:'melee', kind:'melee', damage:66, fireMs:790, range:2.5, recoil:.06, color:'#c78b6a', handling:48, accuracy:64, power:76, description:'Slow swing with heavy impact.' },
  { id:'bat', name:'Tactical Bat', category:'melee', kind:'melee', damage:43, fireMs:520, range:2.55, recoil:.045, color:'#d0a875', handling:80, accuracy:70, power:49, description:'Fast blunt weapon for tight spaces.' },
  { id:'hammer', name:'Sledge Hammer', category:'melee', kind:'melee', damage:78, fireMs:920, range:2.35, recoil:.075, color:'#939da7', handling:35, accuracy:57, power:95, description:'Very heavy, very close-range impact.' },
  { id:'susis_sword', name:"Susi's Sword", category:'melee', kind:'melee', damage:88, fireMs:710, range:3.15, recoil:.055, color:'#15131d', handling:68, accuracy:78, power:100, special:true, unlockStreak:20, description:'A mathematically black blade that can bend the arena into a singularity.' },
  { id:'lilith_sword', name:'The Sword of Lilith', category:'melee', kind:'melee', damage:74, fireMs:680, range:2.95, recoil:.05, color:'#c7a4ff', handling:70, accuracy:82, power:89, description:'A violet-edged relic built for fast, precise close-quarters strikes.' },
];

export const VEHICLES = [
  { id:'atlas-cycle', name:'Atlas Ka Cycle', type:'cycle', speed:7.0, handling:88, description:'Lightweight pedal cycle. Agile in alleys and tight lanes.' },
  { id:'yamaha-bike', name:'Yamaha Bike', type:'sport-bike', speed:13.4, handling:75, description:'Fast road bike with responsive steering.' },
  { id:'royal-enfield', name:'Royal Enfield', type:'cruiser-bike', speed:10.2, handling:64, description:'Stable cruiser with heavier acceleration.' },
  { id:'decathlon-skateboard', name:'Decathlon Skateboard', type:'skateboard', speed:8.3, handling:94, description:'Quick turns and low profile for urban routes.' },
  { id:'rdx-hoverboard', name:"RDX's Hoverboard", type:'hoverboard', speed:10.4, handling:90, description:'A levitating board for fast traversal and short flight.' },
];
export function vehicleById(id) { return VEHICLES.find(v => v.id === id) || VEHICLES[0]; }

export const GAME_TYPES = [
  { id:'tdm', name:'Team Deathmatch', description:'Work with your squad. First team to the score limit wins.', team:true },
  { id:'ffa', name:'Free-for-All', description:'Every player for themselves. Highest individual score wins.', team:false },
  { id:'ctf', name:'Capture the Flag', description:'Steal the enemy flag and bring it to your home base.', team:true },
  { id:'dom', name:'Domination', description:'Capture and hold three control zones to earn steady points.', team:true },
];
export const PLAY_MODES = [
  { id:'all', name:'All Weapons', description:'Use your two selected guns and selected melee weapon.' },
  { id:'melee', name:'Melee Only', description:'Gun slots remain equipped but cannot be fired; melee attacks only.' },
  { id:'pistol', name:'Pistol Only', description:'Only Pistol and Revolver can be fired.' },
  { id:'sniper', name:'Snipers Only', description:'Only Sniper Rifle, Marksman Rifle and Crossbow can be fired.' },
];
export const POWERUPS = [
  { id:'speed', name:'Overdrive', color:'#53e4f1', duration:12000 },
  { id:'damage', name:'Damage Boost', color:'#ff9954', duration:10000 },
  { id:'regen', name:'Regeneration', color:'#80e879', duration:12000 },
  { id:'shield', name:'Shield', color:'#70a2ff', duration:0 },
  { id:'rapid', name:'Rapid Fire', color:'#ffe06a', duration:10000 },
  { id:'jump', name:'High Jump', color:'#d8a1ff', duration:12000 },
];
export const MAP_SIZE = 240;
export const WORLD_LIMIT = 115;
export const SCORE_LIMITS = [10, 15, 20, 30, 50];

export function weaponById(id) { return WEAPONS.find(w => w.id === id) || WEAPONS[0]; }
export function allowedWeapon(weapon, mode) {
  if (!weapon) return false;
  if (mode === 'melee') return weapon.kind === 'melee';
  if (weapon.kind === 'melee') return mode === 'all';
  if (mode === 'pistol') return weapon.category === 'pistol';
  if (mode === 'sniper') return weapon.category === 'sniper';
  return true;
}
export function normalizeLoadout(value) {
  const inLoadout = value && typeof value === 'object' ? value : {};
  const gunIds = new Set(WEAPONS.filter(w => w.kind === 'gun').map(w => w.id));
  const meleeIds = new Set(WEAPONS.filter(w => w.kind === 'melee' && !w.special).map(w => w.id));
  let guns = Array.isArray(inLoadout.guns) ? inLoadout.guns.filter(id => gunIds.has(id)) : [];
  guns = [...new Set(guns)].slice(0, 2);
  while (guns.length < 2) {
    const fallback = WEAPONS.find(w => w.kind === 'gun' && !guns.includes(w.id));
    if (fallback) guns.push(fallback.id); else break;
  }
  const melee = meleeIds.has(inLoadout.melee) ? inLoadout.melee : 'knife';
  return { guns, melee };
}
export function activeLoadoutIds(loadout, mode) {
  const normalized = normalizeLoadout(loadout);
  if (mode === 'melee') return [normalized.melee];
  return [...normalized.guns.filter(id => allowedWeapon(weaponById(id), mode)), normalized.melee].filter(id => allowedWeapon(weaponById(id), mode));
}

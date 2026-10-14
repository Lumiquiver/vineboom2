export const SKIN_PRESETS=[
  {id:'vanguard',name:'Vanguard',skin:'#d6aa86',hair:'#30221d',shirt:'#3d6b76',pants:'#283943',accent:'#d5b16d'},
  {id:'night-ops',name:'Night Ops',skin:'#b98567',hair:'#151a20',shirt:'#27333d',pants:'#171e28',accent:'#6db4cf'},
  {id:'desert-ranger',name:'Desert Ranger',skin:'#d6a47e',hair:'#4b3328',shirt:'#9a784f',pants:'#514637',accent:'#d8bd7f'},
  {id:'arctic',name:'Arctic Recon',skin:'#e4c4a8',hair:'#786456',shirt:'#b7cbd1',pants:'#6d8790',accent:'#f0f3f3'},
  {id:'neon-recon',name:'Neon Recon',skin:'#c88e73',hair:'#20242b',shirt:'#285b57',pants:'#242f3b',accent:'#7bf0d2'},
];
export function createPresetSkinCanvas(presetId='vanguard',fallback='#54a8e8'){
  const p=SKIN_PRESETS.find(x=>x.id===presetId)||SKIN_PRESETS[0];
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  const rect=(a,b,w,h,col)=>{x.fillStyle=col;x.fillRect(a,b,w,h);};
  // Minecraft atlases are fully opaque underneath the six-part rig. Starting with
  // transparent pixels made unpainted UV faces render as black, especially on heads.
  rect(0,0,64,64,p.pants||fallback);
  // Head UV net: skin face, hair cap/sides, and a clearly visible eye line.
  rect(0,0,32,16,p.skin);
  rect(8,0,8,8,p.hair);rect(0,8,8,8,p.hair);rect(24,8,8,8,p.hair);
  rect(8,8,8,8,p.skin);rect(8,8,8,2,p.hair);
  rect(10,11,1,2,'#25282b');rect(13,11,1,2,'#25282b');rect(10,14,4,1,'#985f53');
  rect(16,0,8,8,p.skin);rect(16,8,8,8,p.skin);
  // Torso UV net (x=16..40, y=16..32): shirt, shoulder seams, and belt.
  rect(16,16,24,16,p.shirt);
  rect(20,20,8,12,p.shirt);rect(22,20,2,8,p.accent);rect(20,28,8,4,p.pants);
  rect(16,28,4,4,p.accent);rect(28,16,8,4,p.pants);rect(32,20,8,12,p.shirt);
  rect(34,21,4,2,p.accent);rect(35,25,3,1,'#27353b');
  // Right/left arm atlases, with skin hands at the bottom of each sleeve.
  rect(40,16,16,16,p.shirt);rect(44,20,4,8,p.shirt);rect(44,28,4,4,p.skin);rect(48,16,4,4,p.accent);
  rect(32,48,16,16,p.shirt);rect(36,52,4,8,p.shirt);rect(36,60,4,4,p.skin);rect(40,48,4,4,p.accent);
  // Leg atlases and dark boots. Every region used by the rig has a solid color.
  rect(0,16,16,16,p.pants);rect(4,20,4,8,p.pants);rect(4,28,4,4,'#242a30');rect(8,16,4,4,p.accent);
  rect(16,48,16,16,p.pants);rect(20,52,4,8,p.pants);rect(20,60,4,4,'#242a30');rect(24,48,4,4,p.accent);
  // Keep transparent RGBA source pixels from revealing black holes when custom skins overlay this atlas.
  c.dataset.preset=presetId;return c;
}

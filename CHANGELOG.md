# Changelog

## 2.1.0 — Final release polish

- Removed imported-map loading, map-specific collision exporting, and imported-map lobby checks. The game now offers five built-in procedural arenas.
- Added a branded startup/loading screen with progress feedback, the KuchurPuchur Studios credit, and the three-hour development fact.
- Added three original procedural synth-music themes, player-controlled track switching, persistent music preference, and music controls on the menu and pause screen.
- Smoothed screen transitions, improved keyboard focus and disabled-button states, and removed the manual multiplayer server URL field. Production now automatically uses the same origin for room connections.
- Published project licensing and third-party notices and rewrote the README for players and contributors.


## 2.1.1 — Beta stability and combat fixes

- Replaced sampled collision ray traversal with corner-safe grid traversal on both client and server; synchronized aim calculation to the latest camera yaw/pitch and added a visible shooter hit marker for confirmed online damage.
- Corrected rotated prop collision footprints and the fallen-log collider in Pine Research, hardened recovery/spawn selection with safe perimeter/interior searches, and removed unsafe spawn fallbacks.
- Reset thrown-melee state when dying/respawning and clean up dropped items; melee items now have distinct dropped models, including the black-and-violet Susi’s Sword.
- Added dedicated first-/third-person Susi’s Sword geometry and visible remote melee-swing animations.
- Ensured match-start/death state cleanup and kept temporary drone/effect state from carrying over between rounds. Expanded collision and weapon regression audits.


## 2.1.2 — Beta feature completion and animation polish

- Consolidated killstreak schedule in shared client/server logic; fixed online reward events from incrementing the same kill twice and added/verified a persistent streak-progress HUD.
- Added a visible white paint projectile for V’s Eye View in both solo and online play, synchronized thrown-melee visibility, and restored the exact dropped melee weapon after solo pickup.
- Refined the VizBlaster pump-action feedback, five selectable skin presets, opaque fallback skin atlas, and shoulder/hip pivot animation rig; corrected crown position on the head.
- Added first-person low stances during crouch/crawl, an eased camera fall when tripped, restricted jumping during forced animations, and enabled quality-scaled shadows with an automatic low-performance fallback.
- Added extra startup quotes, regression tests for killstreak milestones, VizBlaster balance, and all five skin presets.


## 2.1.3 — Scope, weapon flow, vehicles, and team controls

- Added strong per-weapon ADS field-of-view magnification and a scoped lens/crosshair overlay for sniper-class weapons.
- Replaced the global server reload lock with independent per-weapon deadlines. A reloading weapon can complete while the player uses their second gun; reload time remains weapon-specific.
- Improved the backflip into a full backward 360-degree rig rotation, matching the local camera timing with remote animations.
- Added a compact translucent, persistent, user-toggleable HUD controls panel and corrected its collapse state styling.
- Reduced bot tick frequency, introduced range-scaled aim error, and lowered bot hit probability for more forgiving offline practice.
- Added team switching during live team-based multiplayer matches, including dropping a carried CTF flag before changing sides; offline bot teams are reassigned to keep the match balanced.
- Added selectable drivable Atlas Ka Cycle, Yamaha Bike, Royal Enfield, Decathlon Skateboard, and RDX Hoverboard models; synchronized selected vehicle types through room state and added server-side vehicle choice/speed validation.
- Added The Sword of Lilith to the unlocked melee arsenal.
- Reduced baseline render pixel ratio, kept shadows off except on the high preset, added idle-menu render throttling, and retained automatic low-performance fallback.
- Added reload-timer and vehicle-data tests and expanded source audits for all requested features.

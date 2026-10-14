# VineBoom

**VineBoom v2.1.3** is a browser-based 3D multiplayer FPS created by **KuchurPuchur Studios**. It includes four game types, four weapon rulesets, custom loadouts, movement abilities, five distinct procedural arenas, room-code multiplayer, solo bot practice, player preferences, Minecraft skin support, and an original synthesized background-music playlist.

The project is released under the MIT License. See [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## Features

- **Game types:** Team Deathmatch, Free-for-All, Capture the Flag, and Domination.
- **Weapon rulesets:** All Weapons, Melee Only, Pistol Only, and Snipers Only.
- **Custom loadout:** equip exactly two distinct unlocked guns and one melee weapon; choose during the armory screen and during the death countdown.
- **Combat:** weapon-specific recoil, damage, ammunition, reload times, and per-gun reload timers. Switching to your other gun no longer blocks it while a different gun reloads. Scoped rifles use real field-of-view zoom with a scope overlay, with stronger magnification for sniper-class weapons. Confirmed-hit feedback, kill feed, scoreboard, and match-end flow are retained.
- **Movement:** sprint and stamina, crouch, slide, full-rotation backflip, crawl/prone, jump, and range-limited trip action with synchronized remote swing/stance animation.
- **Five built-in arenas:** Metro District, Fort Atlas, Red Dune Works, Pine Research, and Old Quarter. Arenas are procedurally generated and require no external map downloads.
- **Online rooms:** create or join a four-character room code, ready up, configure host match settings, balance teams, switch sides during active team-based matches, and play on one WebSocket-enabled Node server.
- **Solo practice:** local bot opponents for offline practice.
- **Player personalization:** Minecraft-style 64×64 skin PNG import, five selectable built-in skin presets, optional username lookup, team color, headgear, sensitivity, graphics quality, and saved local statistics.
- **Power-ups and kill-streak rewards:** Overdrive, Damage Boost, Regeneration, Shield, Rapid Fire, High Jump, V’s Eye View paint drone, SS Strike, and Susi’s Sword. The armory also includes The Sword of Lilith.
- **Performance:** resolution scaling, high-quality-only dynamic shadows, reduced idle-menu render rate, and an automatic low-performance fallback. The controls reminder is a compact translucent panel and can be hidden with its toggle.
- **Original background music:** three synthesized themes, with an on/off switch and next-track control. Audio starts after the first player interaction to respect browser autoplay policies.
- **Vehicles:** select and deploy the Atlas Ka Cycle, Yamaha Bike, Royal Enfield, Decathlon Skateboard, or RDX Hoverboard. Use H to mount/park the selected vehicle; the hoverboard can briefly fly.

## Requirements

- Node.js 20 or later
- npm
- A modern browser with WebGL support

## Run the game and multiplayer on one server

1. Download or clone this repository.
2. In the project directory, install dependencies:

   ```bash
   npm install
   ```

3. Build the frontend and start the single server process:

   ```bash
   npm start
   ```

4. Open [http://localhost:8787](http://localhost:8787).
5. Choose **Create Room** and share the four-character room code with friends. They open the same address and use **Join**.

The production command builds the browser client and then launches one Node process. That server serves the HTML, JavaScript, CSS, static files, `/health`, and the `/ws` multiplayer endpoint on the same port. Set `PORT` if your host assigns a port automatically. Optional server limits and origin restrictions are documented in `.env.example`.

For local development with hot reload, use two terminals:

```bash
npm run server
```

```bash
npm run dev
```

Open the Vite address shown in the terminal. In Vite development mode, the client connects to the local room server at `ws://localhost:8787/ws` automatically. In the production one-server build, the client uses the same hostname as the game page and switches to secure WebSockets when served over HTTPS.

## Validation commands

Run all syntax, interface/import, collision, gameplay-data, vehicle, and per-weapon reload regression checks:

```bash
npm run check
```

Create the frontend production build:

```bash
npm run build
```

Run the static preview server after building:

```bash
npm run preview
```

`npm run check` validates JavaScript syntax, verifies local imports and HTML element references, and runs the built-in data tests. For online play, test with two or more browser sessions connected to the same running Node server. These checks are automated source/data regressions, not a substitute for an actual WebGL browser session. Network availability, host configuration, and browser/GPU behavior can affect runtime results; test with two or more clients before publishing a production build.

## Deployment

For **online multiplayer**, deploy the whole project to a Node.js host that supports a persistent process and WebSocket upgrades, then run `npm start`. Point players at the same public HTTPS URL; no separate game-server URL needs to be entered in the player UI.

`npm run build` also creates the static frontend in `dist/`, which can be deployed to a static host for a solo/front-end preview. Static hosting by itself cannot run the persistent WebSocket room server, so it does not provide online multiplayer unless a separate compatible room server is configured at build time using `VITE_GAME_SERVER_URL`.

The single-server process exposes a lightweight health endpoint at `/health`. It reports whether the frontend build is available and gives the current room/player counts.

## Controls

| Action | Default |
|---|---|
| Move | `W A S D` |
| Aim | Mouse movement |
| Fire | Left mouse button |
| Aim down sights | Right mouse button |
| Sprint | `Left Shift` |
| Jump | `Space` |
| Crouch | `C` |
| Slide | `Left Ctrl` while sprinting |
| Backflip | `V` |
| Crawl / prone | `Z` |
| Trip | `G` at close range |
| Reload | `R` |
| Weapon slots | `1`, `2`, `3` |
| Previous / next weapon | `Q` / `E` or mouse wheel |
| Interact / objective hint | `F` |
| Deploy / park selected vehicle | `H` |
| Switch teams | Pause menu → **SWITCH TEAM** (team modes only) |
| Toggle controls reminder | Click **CONTROLS − / +** on the right side of the HUD |
| Scoreboard | Hold `Tab` |
| Pause | `Esc` |

Controls can be rebound in the game settings. Desktop keyboard and mouse are the supported control scheme.

## Project structure

```text
index.html                 Player-facing app shell and loading screen
src/main.js                Menus, loadout, music, HUD, input actions, and match flow
src/game.js                Three.js rendering, movement, vehicle models, scopes, weapons, collision, and effects
src/maps.js                Five procedural arenas, map collision, pickups, and objectives
src/network.js             Browser WebSocket client
shared/game-data.js        Shared map, game type, mode, weapon, vehicle, and power-up definitions
shared/reload-state.js     Independent per-weapon reload timers
server/server.mjs          Single-process HTTP + authoritative room/combat server
scripts/start-server.mjs   Build-and-run production command
scripts/audit-project.mjs  HTML/import/source audit
scripts/*.mjs              Project scripts
tests/                     Gameplay-data unit tests
LICENSE                    MIT License for this project
THIRD-PARTY-NOTICES.md     Third-party software and font notices
```

## Open-source contribution notes

- Keep gameplay data shared between the client and server where rules must match.
- Do not add client-only scoring for online matches; important score and damage changes belong in `server/server.mjs`.
- Run `npm run check` after edits and test both solo practice and at least two networked clients before release.
- Keep player-facing UI copy focused on gameplay; put setup notes and maintainer guidance in project documentation.
- Use original or appropriately licensed assets, and document new third-party assets and their licenses.

## Credits

**Created by KuchurPuchur Studios.**

Third-party software and font licensing details are listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). The loading screen's three-hour development fact is a studio-provided credit/fact displayed as requested.

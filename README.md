[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# PORT SOLANO

**An original open-world crime game that runs entirely in a desktop browser.** One self-contained static site — no build step, no network requests, no external assets. Every sprite is drawn in code on a 2D canvas; every sound is synthesized live with WebAudio.

You arrive in Port Solano with $120, a borrowed hatchback and a cousin named Darío who owes dangerous people money. Work Marisol Vega's jobs across six districts, steal what you need, outrun the Policía Municipal, and settle the debt — or just live in the city: run taxi fares, race the Harbour Run, find the 20 hidden packages, and watch the sun go down over the bay.

## The city

A 240×240-tile city (7,680×7,680 px) generated deterministically from a seed, with ~280 named buildings:

- **Barrio Viejo** — the old town: tight blocks, the plaza, your safehouse *Casa de Darío*
- **Centro** — downtown towers, the *Terminal de Buses*, *Hospital San Roque*, the *Comisaría Central*
- **Zona Industrial** — warehouses and yards east of the river of avenues
- **Las Colinas** — quiet suburbs and cul-de-sacs
- **La Playa** — beachfront hotels along the sand
- **El Puerto** — the working harbour: docks, cranes, container yards
- **Isla Brisa** — a little island in the bay, reached by a single bridge

## What's in the game

- **On foot and by car** — WASD movement with mouse aim, sprint, and any of ~90 parked or moving cars to take. Six vehicle types (compact, sedan, muscle car, pickup, taxi, police cruiser) with distinct speed, grip, durability and looks.
- **Traffic and pedestrians** — lane-following traffic that brakes, honks, panics and flees; pedestrians who stroll, cross at crosswalks, run from gunfire and drop cash when knocked down.
- **Wanted system** — crimes only count when witnessed. 1–5 stars bring cruisers that chase and ram; from 3 stars they shoot; at 5 they set up ahead of you. Lose them and the heat decays. Getting caught with a cop at your elbow fills the bust meter.
- **Combat** — fists, pistol, and a buyable SMG and shotgun with ammo economy at **Armas Solano**.
- **A seven-mission story** — Marisol Vega, cousin Darío and dock boss El Pulpo: a welcome drive, a car theft for the chop dock, a timed delivery, a dock shootout, a hot pickup and escape, a checkpoint run, and a finale that settles everything. Dialogue scenes, world markers, minimap markers, cash rewards.
- **Side work** — taxi fares in any taxi, the Harbour Run checkpoint race, 20 hidden packages with a counter and a completion bonus.
- **Economy and shops** — gun shop, food stands that heal, and **Solano Customs**: repaint your car (a fresh colour throws off the heat) and repair it. The safehouse saves the game and heals you.
- **Consequences** — get dropped and you wake at Hospital San Roque minus a fee; get busted and you wake at the Comisaría minus a fine. Wanted cleared either way.
- **HUD and minimap** — cash, health, wanted stars, weapon and ammo, in-game clock, mission banner and objective line, and a live minimap with roads, your arrow, police blips, mission/taxi/race markers, shops and the safehouse.
- **Day and night** — a full clock with dawn/dusk tinting, streetlight glow and headlights after dark.
- **Polish** — handbrake drifts with fading skid marks and tyre smoke, collision damage with engine smoke, muzzle flashes, sparks, screen shake, floating cash text, district name cards when you cross a border.
- **Sound, all synthesized** — engine hum tied to speed, police sirens that swell as they close in, per-weapon gunshots, punches, horns, pickup blips, a mission-complete jingle and a looping synth track. `M` mutes.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move / drive |
| Mouse | Aim · click to attack or shoot |
| `Shift` | Sprint (on foot) |
| `Space` | Handbrake (in a car) |
| `E` | Enter / exit car · talk · buy · save at the safehouse |
| `1`–`4` | Fists / pistol / SMG / shotgun |
| `Esc` / `P` | Pause |
| `M` | Mute |

## Play it

Open `game/index.html` in a desktop browser — that's the whole game. For local development, `node serve.ts` serves it at <http://localhost:8902>.

Progress (cash, story, position, packages, weapons, your current car) saves to `localStorage`; **Continue** on the title screen picks up where you left off. Saving at the safehouse also fully heals you.

## Screenshots

Four scenes are scripted for capture in `shots.json` (`game/?shot=start|drive|chase|docks&seed=7`): the title screen over the bay at golden hour, driving a Centro avenue in traffic, a three-star harbour chase, and the shootout at Almacén Pulpo. The scenes drive the real game with scripted input — no mock-ups.

## Layout

- `game/index.html` — page shell, HUD, menus; loads `game/src/main.js`
- `game/src/` — the game in focused ES modules: `config`, `random`, `input`, `audio`, `citygen`, `entities`, `police`, `missions`, `render`, `minimap`, `shots`, `main`
- `main.ts` — the delivery program: copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored library
- `serve.ts` — the local development server
- `vendor/makefun-game.ts` — the competition kit's library, byte-identical

## License

MIT — see `LICENSE`. Port Solano, its city, characters and story are original works created for this entry.

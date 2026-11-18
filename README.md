[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# PORT SOLANO

**An original open-world crime game that runs entirely in a desktop browser.** One self-contained static site — no build step, no network requests, no external assets. Every sprite is drawn in code on a 2D canvas; every sound is synthesized live with WebAudio.

You step off the bus at the Terminal with $25 and family in town: your cousin Darío has a room, and your tía Marisol Vega has work — the kind that pays in cash. Across six districts and one island, her crew is squeezing out the dock boss El Pulpo. Steal cars, take a boat across the bay, run the crew's errands, dodge La Patrulla on road, on foot and on the water, and settle the bay's accounts — or just live in the city: run taxi fares and courier packages, race two checkpoint circuits, find the 20 hidden packages, and watch the rain roll in over the water.

## The city

A 240×240-tile city (7,680×7,680 px) generated deterministically from a single seed — the same seed always builds the same city, street for street — with 299 named buildings, ~1,200 props, 52 parked cars and 20 hidden packages:

- **Barrio Viejo** — the old town: tight blocks, the Plaza Mayor, market stalls
- **Centro** — downtown towers, the *Terminal de Buses*, *Hospital San Solano*, the *Comisaría Central*
- **Zona Industrial** — warehouses, yards and dumpster alleys east of the avenues
- **Las Colinas** — quiet suburbs; *Casa de Darío*, your safehouse
- **La Playa** — beachfront hotels, food stands, umbrellas and towels on the sand
- **El Puerto** — the working harbour: docks, cranes, crates and barrels
- **Isla Brisa** — a little island in the bay, reached by a single bridge — or by boat

Rooftops wear their clutter: AC units with fan discs, vent stacks, water towers, parapets and bright signs over the shops. The bay is alive too — dinghies and speedboats ride at the docks and the island shore.

## What's in the game

- **On foot, by car, by boat** — WASD movement with mouse aim and sprint; any parked or moving car can be taken (six vehicle types — compact, sedan, muscle, pickup, taxi, police cruiser — with distinct speed, grip, durability and looks). At the water's edge, press `E` to board a moored dinghy or speedboat: wide, sliding turns, a foam wake, and you can shoot from the deck. Step ashore again wherever the hull reaches land.
- **Traffic and pedestrians** — lane-following traffic that brakes, honks, panics and flees; pedestrians who stroll, run from gunfire and drop cash when knocked down.
- **Wanted system** — crimes only count when witnessed. 1–5 stars bring cruisers that chase and ram; from 3 stars they shoot; at 5 they set roadblocks ahead of you. Lose them and the heat decays. Stay close to a stopped officer long enough and the bust meter fills.
- **Foot patrols** — uniformed officers walk beats at the Comisaría, the plaza, the customs dock, the hotel and the terminal. They witness crimes, chase you on foot, and their hands fill the same bust meter.
- **The helicopter** — at five stars a Patrulla helicopter shadows you on a slow orbit, pins a spotlight circle on the ground around you (you cannot hide from it), and fires bursts. Drop below five stars and it climbs away.
- **The harbour patrol** — take to the water at three stars or more and a police speedboat answers in kind: it runs you down across the bay and shoots like a cruiser. Step back onto land and it gives up.
- **Combat and armour** — fists, pistol, SMG, shotgun and the long-range automatic **Fusil** rifle, with an ammo economy at **Armas Solano** — which also sells a *chaleco antibalas*: body armour with its own HUD bar that absorbs damage before your health does.
- **A nine-mission story** — Marisol Vega, cousin Darío and dock boss El Pulpo: a welcome drive, a car theft for the chop dock, a timed crate delivery, a dock shootout, a hot pickup and escape, a checkpoint run, a night boat delivery to Isla Brisa, an island raid to clear El Pulpo's crew and sink his speedboat, and a finale that settles everything. Dialogue scenes, world and minimap markers, cash rewards — completable end to end.
- **Side work** — taxi fares in any taxi; **courier deliveries** (pick up a package at the terminal, hotel, plaza, warehouse, Comisaría or beach stand and beat the clock across the city — pay scales with distance, leftovers of the clock come back as a speed bonus); two checkpoint races, the **Harbour Run** and the bridge-and-island **Isla Loop**; 20 hidden packages with a counter and a completion bonus.
- **Economy and shops** — the gun shop, food stands that heal, and **Solano Customs**: repaint your car (a fresh colour throws off the heat) and repair it. The safehouse saves the game and heals you.
- **Consequences** — get dropped and you wash up at Hospital San Solano minus a fee (or ashore, if your boat dies under you); get busted and you walk out of the Comisaría minus a fine. Wanted cleared either way.
- **Radio** — three synthesized stations while you drive or sail: **Bajo Profundo** (sub-bass and minor keys), **Radio Bahía** (the latin-tinged house loop) and **Marea Chill** (slow pads, no drums). `R` or `]` tunes up, `[` tunes down; the station name rides the HUD.
- **Weather** — every few minutes a rain band rolls in off the bay: streaking rain, a darker blue grade, wet sheen on the asphalt, and the soft wash of rain in the mix. Then it blows over and the streets dry.
- **HUD and minimap** — cash, health and armour bars, wanted stars, weapon and ammo, radio station, in-game clock, mission banners and an objective line, and a live minimap with roads, your arrow, police car/boat blips, the helicopter's ring, mission/taxi/race/courier markers, shops and the safehouse.
- **Day and night** — a full clock with dawn/dusk tinting, streetlight glow, headlights after dark — and the helicopter's spotlight burning through it.
- **Polish** — handbrake drifts with fading skid marks and tyre smoke, collision damage with engine smoke, wakes and splashes, muzzle flashes, sparks, screen shake, floating cash text, district name cards when you cross a border.
- **Sound, all synthesized** — engine hum tied to speed (at the wheel or the helm), police sirens that swell as they close in, rain noise, per-weapon gunshots, punches, horns, pickup blips, a mission-complete jingle and the three radio loops. `M` mutes.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move · drive · sail |
| Mouse | Aim · click to attack or shoot |
| `Shift` | Sprint (on foot) |
| `Space` | Handbrake (in a car) |
| `E` | Enter / exit car or boat · talk · use a shop · pick up a courier package · save at the safehouse |
| `1`–`5` | Fists / pistol / SMG / shotgun / rifle |
| `R` / `]` | Radio: next station |
| `[` | Radio: previous station |
| `Esc` / `P` | Pause |
| `M` | Mute |

## How it maps to the brief

The gta6-01 brief asks for an original, browser-playable open-world crime game in the spirit of the genre's classics. PORT SOLANO answers it system for system: a full city with districts and landmarks; free-roam on foot, in cars and in boats; a wanted system with ground, foot, water and air response; a chained story campaign with named characters and dialogue; side jobs and races for the hours between missions; shops, an economy and save/continue; and a day/night, weather and radio layer that makes the city feel lived-in. It is 100% original — every name, line of dialogue, street and note of music was made for this entry — and 100% self-contained: vanilla JS ES modules, canvas rendering, WebAudio synthesis, no assets, no network, no build step.

## Play it

Open `game/index.html` in a desktop browser — that's the whole game. For local development, `node serve.ts` serves it at <http://localhost:8902>.

Progress (cash, story, position, packages, weapons, armour, your current car or boat) saves to `localStorage`; **Continue** on the title screen picks up where you left off — saves from earlier versions load with sensible defaults. Saving at the safehouse also fully heals you.

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

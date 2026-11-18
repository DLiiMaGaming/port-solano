[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/DLiiMaGaming/port-solano/reward.svg)](https://make.fun/c/gta6-01)

# PORT SOLANO

An original top-down 2D open-world crime game in the spirit of GTA 6, built for the
[make.fun gta6-01](https://make.fun/c/gta6-01) bounty. One coastal city, one island, one
crime boss — and you, a nobody with a borrowed name, working your way up Marisol Vega's
ladder until the bay answers to you.

Everything is original: the city of Puerto Solano, its people (Marisol Vega, Darío, the
boss they call El Pulpo), its radio stations and its crimes. No third-party assets, no
libraries, no network requests — the whole game is hand-written vanilla JavaScript on a
`<canvas>`, and every sound is synthesized live with WebAudio. It plays offline in a
desktop browser straight from `game/index.html`.

## Play it

```sh
node serve.ts          # then open http://localhost:8080
```

— or just open `game/index.html` in desktop Chrome. Keyboard + mouse, or a gamepad.

## The city

Puerto Solano is generated deterministically from seed `20261124`: a 240×240-tile
(7,680×7,680 px) coastal city that is identical on every load.

- **Six districts plus an island** — Barrio Viejo, Centro, Zona Industrial, Las Colinas,
  La Playa and El Puerto on the mainland; Isla Brisa across a causeway bridge, with its
  own streets, palms and secrets.
- **378 named buildings** with street frontages, doorways, window rows that light up at
  night, awnings, and rooftop props (AC units, water towers) — every one placed by the
  generator along real street frontages, never floating in a block.
- **1,000+ props**: street lamps with light pools after dark, palms, market stalls,
  benches, beach umbrellas, crates, barrels and dumpsters — the solid ones are real
  cover in a firefight.
- **Functional locations**: Armas Solano (gun shop), Solano Customs (repaint + repair),
  Casa de Darío (safehouse: save and heal), Hospital San Solano (where the dead wake
  up, minus a bill), Comisaría Central (police HQ), taxi stands, two race starts,
  courier spots, and docks with moored boats around the bay and the island.
- **20 hidden packages** scattered over rooftops' edges, alleys, piers and the island.
- **Living street life**: lane-driving traffic that stops, swerves and occasionally
  piles up; pedestrians who stroll, wait, and flee from gunfire; parked cars waiting
  to be borrowed.
- **A full day/night cycle** (dawn gold, noon glare, dusk amber, lit windows and lamp
  pools at night) and **rain bands** that roll in off the bay, slick the streets and
  hiss on the radio.

## Systems

- **On foot**: run, sprint, fight with fists or four firearms — pistol, SMG, shotgun
  and rifle — each with its own spread, cadence, pellet pattern and tracer; a separate
  armor pool absorbs 75% of incoming damage until it is gone.
- **Six car types** with distinct handling, top speed, armor and silhouettes: compact,
  sedan, muscle, pickup, taxi and police cruiser — headlight cones at night, a lit
  TAXI sign, flashing cruiser light bars, skid marks, exhaust smoke, crash damage.
- **Car theft**: any parked or stopped car can be taken; the owner may have opinions.
- **Boats**: dinghies and speedboats moored at the docks and the island, with wake
  physics and shore-based boarding — step off a pier onto a deck, step back onto land.
- **Wanted system, 1–5 stars**: cruisers pursue and ram; from 3 stars officers shoot
  on sight and a police boat joins on the water; at 5 stars roadblocks seal the
  avenues and a helicopter hunts you with a spotlight and a door gunner. Foot-patrol
  officers walk beats all over the city — if one reaches you with a full bust meter,
  you are arrested. Die instead and the hospital sends the bill. Either way, a mission
  in progress fails and can be retried at its marker.
- **Work**: drive a Taxi Solano cab and take fares; run two checkpoint races (Harbour
  Run on the mainland, Isla Loop over the bridge and around the island); take timed
  courier deliveries that pay by distance and punctuality.
- **Shops**: Armas Solano sells weapons, ammo and armor; Solano Customs repaints and
  repairs whatever you are driving — including a stolen cruiser, no questions asked.
- **Radio**: three fully synthesized stations while you drive — Bajo Profundo (bass
  and drums), Radio Bahía (the default: warm chords and a lead line) and Marea Chill
  (slow pads) — plus synthesized engine, gunfire, sirens, rain and UI sounds. No audio
  files anywhere.
- **Save / continue**: the safehouse (or the title screen's Continue) persists cash,
  story progress, weapons, armor, packages and your current ride in `localStorage`.
- **Minimap**: a live 96-tile window with the player, mission markers, police,
  contacts, taxi pickups and hostile blips.

## Story

Nine missions, one arc. Marisol Vega runs the bay's errands; Darío owes the wrong man;
El Pulpo owns the warehouse, the island, and — he believes — everyone in them.

1. **Llegada** — arrive broke, meet Marisol, get introduced to Darío. ($40)
2. **El Recado** — a driving/collection job under a timer, with the bay watching. ($300)
3. **Almacén Pulpo** — a warehouse shootout over El Pulpo's account books. ($450)
4. **Persecución** — heat, a chase, and losing the police the hard way. ($500)
5. **El Taxi** — a cover job: drive Marisol's people in a cab, no questions. ($600)
6. **La Redada** — a raid on the customs yard. ($700)
7. **Marea Nocturna** — a night boat delivery to Isla Brisa. ($850)
8. **La Isla del Pulpo** — clear the island crew and sink El Pulpo's marked speedboat. ($1,200)
9. **El Último Amanecer** — the finale, at dawn, back where it started. ($1,600)

Every mission has full intro and outro dialogue, and the objectives mix go-to,
collection, timed runs, shootouts, an escape, a taxi cover, a boat run and a sinking.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move / drive | WASD or arrow keys | Left stick |
| Aim | Mouse | Right stick |
| Fire / attack | Left mouse button | Right trigger (RT) |
| Sprint | Shift | Left stick click / LB |
| Interact / enter / exit vehicle | E | A (cross) |
| Handbrake | Space | B (circle) |
| Weapon slots 1–5 | 1 2 3 4 5 | D-pad left / right |
| Radio next / previous station | R / F | Y (triangle) / X (square) |
| Pause / resume | Esc or P | Start |
| Mute | M | — |
| Confirm (menus, dialogue) | Enter, Space or E | A (cross) |

On the title screen: **N** starts a new game, **C** continues a saved one.

## How it maps to the brief

- **A city to explore on foot and by car** — a 240×240-tile seeded city, six districts
  and an island, 378 named buildings, functional shops and services, hidden packages.
- **Traffic and pedestrians** — lane-following traffic AI with yielding and crash
  reactions; pedestrians with walk cycles, clothing colors and flight responses.
- **Cars to steal and drive** — six types with distinct handling; any car can be taken.
- **A wanted level and police who respond** — 1–5 stars with pursuing cruisers, shots
  from 3 stars, roadblocks and a helicopter at 5, a police boat on water, foot patrols
  who bust, arrest and hospital respawns, and heat that decays only out of sight.
- **Missions and a story** — a nine-mission arc with dialogue, varied objective types,
  escalating rewards, failure and retry; plus repeatable taxi, race and courier work.
- **Combat** — fists and four firearms, armor, hostile crews with cover-seeking
  movement, muzzle flashes, tracers, blood and smoke.
- **A HUD with a minimap** — cash, clock, district, wanted stars, bust meter, health
  and armor bars, weapon and ammo, radio station, objective line, live minimap.
- **A start screen and a way to save** — title menu with New Game / Continue, pause
  menu, game-over flow, and safehouse saves persisted in `localStorage`.
- **Polish** — day/night cycle with a golden-hour grade and vignette, animated water
  with shore foam, rain, headlight cones and lamp pools, skid marks, a three-station
  synthesized radio and a fully synthesized soundscape. Screenshots are staged by the
  game's own `shots.js` scenes (see `shots.json`), never edited.

## Structure

```
main.ts                  delivery program: copies game/ + screenshots/ to the output
                         directory and writes dossier.json via vendor/makefun-game.ts
serve.ts                 local dev server for game/ (cache headers, friendly errors)
shots.json               the five scripted screenshot scenes
game/index.html          shell, HUD and menus
game/src/config.js       tunables: world size, weapons, vehicles, prices, caps
game/src/random.js       seeded RNG + shuffle / pick / pickWeighted helpers
game/src/citygen.js      deterministic city generation and spatial queries
game/src/entities.js     player, cars, boats, pedestrians, combat, traffic
game/src/police.js       wanted levels, cruisers, roadblocks, helicopter, patrols
game/src/missions.js     the 9-mission story, taxi fares, races, courier job
game/src/audio.js        WebAudio synth engine: SFX, engines, sirens, 3 radio stations
game/src/input.js        keyboard + mouse + gamepad, normalized to one input object
game/src/render.js       the canvas renderer: city, entities, weather, lighting, HUD art
game/src/minimap.js      the minimap: prerendered city, live blips
game/src/shots.js        screenshot scene staging (used by shots.json)
game/src/main.js         game state, the fixed-step loop, shops, saves, boot
```

The simulation runs on a fixed 60 Hz step decoupled from rendering, with entity caps
and view culling throughout — the same modules run headless under Node for testing,
which is how the story's end-to-end completability was verified.

## License

MIT — see [LICENSE](LICENSE).

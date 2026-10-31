# For All Our Kind

A four-faction lane battle prototype inspired by the Warcraft III map Survival Chaos. Four otherwise friendly peoples run a simulated war to learn who would fare best in a real one.

## Play

Open the GitHub Pages site, or locally:

```bash
npm start
```

then visit http://localhost:8080. There is no build step and no dependencies; the game is plain ES modules.

## How it works

- **Map.** Four corner bases, each sending a wave every 20 s down three lanes: one to each neighbour and one through the free-for-all centre toward the diagonal opponent. Outside battles an army is a single point moving along its lane.
- **Battles.** When enemy armies meet, a 2D battle starts on a round arena. Each army phases in on the side it arrived from, in its owner's formation, rotated to match its direction of travel (so a battle on a bend is west-vs-south). Reinforcements join running battles. Units are circles with collision; the sim is a deterministic 30 Hz tick with a seeded RNG.
- **Targeting.** Closest enemy on arrival; switch if another enemy comes into range first; when the target dies, a random enemy in range, else the closest.
- **Stats.** HP, ACC, DMG, ARM, EVA, SPD, RNG. Hit chance `(50 + ACC) / (100 + 2·EVA)`, capped at 1. Damage `DMG − ARM` (minimum 1). SPD is attacks per second and movement (SPD 1 crosses from the arena edge to the centre in 10 s). RNG is in unit diameters; 0 means melee.
- **Towers.** An army that reaches the end of its lane unopposed damages that player directly (10,000 HP).
- **Eliminations.** When a player falls, lanes route through their corner, so the two neighbours' lanes face each other around the bend. Mid lanes aimed at the dead player retarget the clockwise-closest survivor.
- **Economy.** 1 gold per tier per kill. 20 g adds a unit permanently to one lane's wave; 60 g buys a unit type's one-time upgrade, which applies in all lanes immediately.

## Code layout

- `src/sim/` deterministic simulation: `data.js` (all numbers and faction content), `battle.js`, `map.js`, `game.js`, `ai.js`
- `src/ui/` browser front end and procedural placeholder art
- `tools/playtest.js` headless balance tests, `tools/tune-upgrades.js` upgrade strength search

## Balance playtests

```bash
npm run playtest:lanes     # 1v1 lane snowball rates, starting waves only
npm run playtest:upgrades  # upgrade vs one extra unit per lane, by unit count
npm run playtest:games     # full 4-player games with the simple AI
```

Targets: no 1v1 lane pairing above 60% for one side; no faction winning more than 50% of AI games; each upgrade worse than one more unit early, better once you have about 8 to 10 of that unit.

Results at the time of the first prototype (2026-10-31):

- Lanes, 200 seeds per pairing: every pairing between 45% and 55%.
- AI games, 200 games: Librarians 39%, Compatriots 23%, Visitors 20%, Apex 19%.
- Upgrades: crossover between about 7 and 11 units for every type (most at 8 to 10), negative at 2 to 6 units.

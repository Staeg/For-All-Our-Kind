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
- **Stats.** HP, ACC, DMG, ARM, EVA, SPD, RNG. Hit chance `(50 + ACC) / (100 + 2·EVA)`, capped at 1. Damage `DMG − ARM` (minimum 1); ARM can go negative, which amplifies damage. SPD is attacks per second and movement (SPD 1 crosses from the arena edge to the centre in 10 s). RNG is in unit diameters; 0 means melee.
- **Deploy screen and shop.** The side panel shows the battle view next to a deploy screen for one lane: its formation and its tower. Pick the lane with the arrow tabs or by clicking one of your towers on the map; a fight at that tower appears in the battle view at the same time. Drag units within your quarter of the field, or drop one on another to swap. Below sits an icon bar of your units: hover for name, cost, stats and upgrade; click to pin the panel, then hover the upgrade badge to see its effect and click it to buy. Drag an icon onto the deploy screen (or onto one of your towers) to buy that unit for the lane, at the spot you drop it.
- **Map.** Each castle has its health bar beneath it. Eliminated players' buildings disappear.
- **Towers.** An army that reaches an enemy tower with nobody left to fight starts a battle against the tower itself, which stands in the arena on the defender's side. Units can only hit the tower while none of the defender's units are in that fight, and every hit damages the player directly (10,000 HP). The tower shoots back at anything within 12 diameters (SPD 0.2, ACC 100, DMG 500). Defending waves join the fight as they leave the base.
- **Eliminations.** When a player falls, a wave of fire rolls from their corner down both perimeter lanes and kills every unit it reaches. After that, lanes route through their corner, so the two neighbours' lanes face each other around the bend. Mid lanes aimed at the dead player retarget the clockwise-closest survivor.
- **Economy.** 1 gold per tier per kill. 20 g adds a unit permanently to one lane's wave; 60 g buys a unit type's one-time upgrade, which applies in all lanes immediately, even mid-battle.
- **Upgrades.** Each unit type has one upgrade, and none of them are stat boosts: each changes how the unit fights (rules in `data.js`, effects in `battle.js`).

  | Faction | Unit | Upgrade | Effect |
  |---|---|---|---|
  | Librarians | Dust Warden | Reshelving | Fallen Wardens leave sand piles that re-form at 25% HP if any Librarian is standing when the battle ends. |
  | | Scroll Slinger | Footnotes | Each hit gives the target −1 ARM for the battle, up to −5. |
  | | Hourglass Sage | Rewind | Once per battle per Sage, a Librarian within 6 diameters that would die returns to its position and HP of 3 s earlier. |
  | Visitors | Ember Wisp | Wildfire | Hits burn for 3 s (2 damage/s, ignoring ARM); a burning unit's death ignites every enemy touching it. |
  | | Stone Visitor | Lodestone | Pulls enemies within 4 diameters toward the Stone. |
  | | Gale Sprite | Crosswind | Hits shove the target half a diameter away. |
  | Compatriots | Spore Comrade | Common Body | Damage to any Comrade is split evenly across all Comrades in the battle. |
  | | Shelf Bulwark | Shelter | Half of each hit on a touching Compatriot goes to the Bulwark through its ARM, and the ally heals by the Bulwark's ARM. |
  | | Puffball Lobber | Cordyceps | Hits infect; infected enemies rise on death as 6 s husks at half HP fighting for you. |
  | Apex | Servitor | Postmortem | Servitors take 1 less damage per hit, for the rest of the game, from each unit type that has killed an upgraded Servitor (up to 5). |
  | | Striker Frame | Redline | Each hit adds heat: +20% attack speed, +10% move speed, 1 damage/s per stack, until the battle ends. |
  | | Optic Lancer | Long Exposure | The first shot in each battle deals +1 damage per second since the Lancer's last battle, up to +40. |

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

- Lanes, 200 seeds per pairing (exact formations, tower fights): every pairing between 41% and 59%.
- AI games, 200 games: Librarians 38%, Apex 30%, Compatriots 21%, Visitors 12%. Average game 10.6 min.
- Upgrades (stat boosts, since replaced): crossover between about 7 and 11 units for every type.

After the switch to effect upgrades (2026-11-01, numbers not yet tuned):

- Upgrades, 12 seeds: Rewind is ahead from 2 Sages; Footnotes, Shelter and Cordyceps from about 4; Common Body, Lancer and Servitor around 9 to 11; Reshelving, Lodestone, Crosswind and Redline never beat one more unit, and Wildfire hovers around even. The isolated-battle test undervalues Reshelving and Postmortem, whose payoff comes across battles.
- AI games, 100 games: Librarians 44%, Apex 26%, Compatriots 19%, Visitors 11%.

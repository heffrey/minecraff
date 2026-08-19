# Minecraff - 8-bit Adventure Game

A 2D browser-based adventure game featuring Alex and Steve. Chop trees, collect
resources, build structures, survive the night, and explore diverse biomes.

Built for two people at one laptop: the keyboard is split into a left half and a
right half, and either player can take either half.

## Features

- **Two Playable Characters, fully equal**: Steve and Alex can both move, jump,
  attack, chop and dig. Neither is a passenger
- **Split-hemisphere controls**: one player drives the left half of the keyboard,
  the other the right. Press **Backspace** to swap sides
- **Picture-in-picture**: walk far enough apart and the trailing player gets their
  own inset view, so nobody is dragged along by the other's camera
- **Beacons**: an off-screen partner shows up as a chevron at the screen edge with
  their distance, plus a column of light rising from where they are standing
- **Minimap**: a strip across the bottom showing biomes, both players, the tunnels
  you have dug, and how far apart you are
- **Tech Tree**: 17 nodes across 5 tiers, each with a real effect — faster
  digging and chopping, bigger yields, more HP and damage, deeper shafts, light,
  movement speed. Unlocks are shared and apply to both players
- **Workshop**: 13 craftable items that stack as charges. Press **C** to spend
  one: heal both players, plant a permanent torch, wall off a mob, ramp out of
  your own hole, drop a waypoint and ride back to it later
- **Darkness**: night and depth both dim the world, and the cave is genuinely
  dark. Torches and Lanterns widen the light you carry; a Gold Lamp plants a
  ward that lights its patch and keeps night spawns away
- **Day/Night Cycle**: 10-minute full cycle — DAY, EVENING, NIGHT, DAWN — with phase-based sky colors, stars, and a moon
- **Night Enemies**: Zombies, skeletons, and creepers spawn at night and burn at dawn
- **Biomes**: Grassland, Sand, Swamp (slimes at evening), Cave (spiders, always hostile), Snow
- **Tree Chopping**: Chop trees to collect wood (hold E near a tree)
- **Ground Digging**: Dig down up to 50 layers (90 with Deep Shafts) to collect materials (dirt, stone, iron, etc.). Hold E to dig continuously. Colors darken with depth
- **Directional Digging**: While underground, press E + arrow keys (left/right/down) to dig in that direction
- **Material Placement**: Place blocks (wood, dirt, stone, clay, gold, iron, silver) by opening the palette (P), selecting a material (1–9), and clicking
- **Tile Destruction**: Right-click a placed tile to remove it and return the material to inventory
- **Step-up Physics**: Characters automatically step up onto placed tiles (up to one tile height)
- **Falling into Holes**: Characters fall into dug holes and can be trapped underground
- **Particle Effects**: Wood sprites and material particles on block destruction/digging
- **Inventory System**: Track collected resources; auto-saved to localStorage
- **Debug Mode**: Press B to toggle bounding boxes and a time-of-day overlay

## Controls

The keyboard is split into two hemispheres. Each player owns one; the bindings
belong to the *side*, not to the character, so swapping sides swaps who drives
what.

| | Left hemisphere | Right hemisphere |
|---|---|---|
| Move | **A** / **D** | **←** / **→** |
| Jump | **W** | **↑** |
| Duck / dig down | **S** | **↓** |
| Act | **F** (or **E**) | **/** (or **.**) |

By default Alex is on the left and Steve is on the right.

- **Backspace**: swap sides. An on-screen banner confirms who ended up where, and
  the in-game hints ("Press F to chop") update to name each player's new key

Both players act independently and at the same time — one can be felling a tree
while the other is halfway down a mine shaft.

### Acting

Your action key does the first thing that applies: attack a mob in range, chop a
nearby tree, then dig. Trees count within 120px and they regrow, so the same spot
can chop one minute and dig the next.

**Hold your down key (S or ↓) with your action key when you mean to dig** — that
skips the attack and chop checks entirely.

### Digging and Tunneling

- **Act + down**: dig down, always, even next to a tree or animal
- **Act** alone: dig straight down, but only when nothing else is in reach
- **Act + left**: tunnel left at the current depth
- **Act + right**: tunnel right at the current depth
- **Act + up** does *not* dig — up is reserved for jumping

Hold the keys; digging is continuous at ~300ms per block (faster with Earthworks,
Tool Smithing or a pickaxe), down to 50 layers — 90 once Deep Shafts is researched.

Digging stops if you walk to another tile, a mob comes into range, or you release
your action key.

### Playing apart

Walk far enough apart horizontally and the view splits: the main view stays with
Steve and Alex gets a picture-in-picture inset in the top-right. It fades in and
out rather than popping, and it takes a moment of genuine separation to trigger,
so a jump near the threshold will not flicker the screen.

Whenever a player is off the edge of a view — sideways *or* below ground — a
chevron appears at that edge in their colour with the distance in blocks. While
split, each player also emits a translucent column of light so you can spot each
other across the terrain.

### General (shared, either player)
- **I**: Toggle inventory display
- **M**: Toggle the minimap
- **T**: Open the tech tree / workshop (**Tab** switches tabs, **Esc** closes).
  Arrows move the selection, **Enter** researches or crafts
- **C**: Spend one charge of the selected workshop item. Works with the panel
  closed, so you can drop a torch or throw up a wall mid-fight. Pickaxes are the
  exception — they engage themselves and wear down per block dug
- **P**: Open/close material palette
- **1–9**: Select material (when palette open)
- **Left-click**: Place selected material
- **Right-click**: Destroy placed tile (returns to inventory)
- **Backspace**: Swap keyboard hemispheres
- **B**: Toggle debug mode
- **Shift + Arrow/WASD**: Manual camera scroll — only while debug mode is on, so a
  stray Shift during play cannot freeze both players

While the tech tree is open it swallows the movement keys, so reading it does not
send either character wandering off.

## Getting Started

```bash
git clone git@github.com:heffrey/minecraff.git
cd minecraff
python3 -m http.server 8000
# open http://localhost:8000
```

## Project Structure

```
minecraff/
├── index.html                       # Main HTML
├── game.js                          # Core game logic, input, world rendering
├── coop.js                          # Split camera, picture-in-picture, beacons
├── minimap.js                       # Minimap strip
├── techtree.js                      # Tech tree + workshop panel
├── style.css                        # Styling
├── sprite-editor.html               # Sprite editor UI
├── sprite-editor.js                 # Sprite editor logic
├── steve.png / alex.png             # Character sprite sheets
├── trees.png                        # Trees sprite sheet
├── mobs.png                         # Mob sprites (zombie, skeleton, creeper, slime, spider, pig)
├── materials.png                    # Placeable material tiles (3x3 grid)
├── inventory.png / inventory2.png   # Inventory UI sprites
├── inventory-sprite-config.json     # Inventory frame mappings
├── trees-sprite-config.json         # Tree frame mappings
├── docs/coop-contract.md            # How the four scripts fit together
└── docs/superpowers/                # Design specs and implementation plans
```

The four scripts load in order and share one global scope — there is no module
system and no build step. `game.js` owns the state and defines
`drawWorld(ctx, camX, camY, w, h)`, which the other modules re-run with a
different camera to render the picture-in-picture. See `docs/coop-contract.md`
for the full set of hooks.

## Biomes

| Biome    | World X       | Notes |
|----------|---------------|-------|
| Cave     | x < -1000     | Dark, spiders always hostile, no burn |
| Grassland| -1000 – 2000  | Default |
| Sand     | 2000 – 3000   | — |
| Swamp    | 3000 – 4000   | Slimes spawn at evening |
| Snow     | x > 4000      | — |

## Day/Night Cycle

Full cycle: 10 minutes. Phases:

| Phase   | Cycle position | Sky |
|---------|----------------|-----|
| DAY     | 0.0 – 0.40     | Biome sky color |
| EVENING | 0.40 – 0.55    | Sunset gradient |
| NIGHT   | 0.55 – 0.75    | Near-black with stars & moon |
| DAWN    | 0.75 – 1.0     | Sunrise gradient |

Hostile mobs (zombies, skeletons, creepers, slimes) burn and despawn at dawn. Spiders in the cave biome are permanent.

## Technical Notes

- Vanilla JS + HTML5 Canvas, no dependencies
- `requestAnimationFrame` game loop with delta-time
- Tile grid: 32×32px, snapped to world coordinates
- Biome colors lerped via `lerpColor()` each frame
- Save/load via `localStorage` (inventory + placed tiles + camera + dug ground holes)
- Time state resets on page load (not persisted)
- Ground digging: up to 50 layers deep (`MAX_DIG_DEPTH`), persisted as Set of `"worldX,depth"` keys
- Ground rendering: 50-layer depth with progressive darkening and seeded color variations

## Debug Mode (B)

- Bounding boxes on characters, trees, tiles
- Time-of-day overlay: phase name + elapsed MM:SS / 10:00

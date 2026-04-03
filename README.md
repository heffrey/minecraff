# Minecraff - 8-bit Adventure Game

A 2D browser-based adventure game featuring Alex and Steve. Chop trees, collect resources, build structures, survive the night, and explore diverse biomes.

## Features

- **Two Playable Characters**: Steve (arrow keys) and Alex (WASD)
- **Day/Night Cycle**: 10-minute full cycle — DAY, EVENING, NIGHT, DAWN — with phase-based sky colors, stars, and a moon
- **Night Enemies**: Zombies, skeletons, and creepers spawn at night and burn at dawn
- **Biomes**: Grassland, Sand, Swamp (slimes at evening), Cave (spiders, always hostile), Snow
- **Tree Chopping**: Chop trees to collect wood (hold E near a tree)
- **Material Placement**: Place blocks (wood, dirt, stone, clay, gold, iron, silver) by opening the palette (P), selecting a material (1–9), and clicking
- **Tile Destruction**: Right-click a placed tile to remove it and return the material to inventory
- **Step-up Physics**: Characters automatically step up onto placed tiles (up to one tile height)
- **Particle Effects**: Wood sprite explosions on tree chop
- **Inventory System**: Track collected resources; auto-saved to localStorage
- **Debug Mode**: Press B to toggle bounding boxes and a time-of-day overlay

## Controls

### Steve
- **Arrow Left/Right**: Move
- **Arrow Up / Space**: Jump
- **E**: Chop nearby trees

### Alex
- **A/D**: Move
- **W**: Jump
- **E**: Chop nearby trees

### General
- **P**: Open/close material palette
- **1–9**: Select material (when palette open)
- **Left-click**: Place selected material
- **Right-click**: Destroy placed tile (returns to inventory)
- **B**: Toggle debug mode
- **Shift + Arrow/WASD**: Manual camera scroll

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
├── game.js                          # All game logic (~3300 lines)
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
└── docs/superpowers/                # Design specs and implementation plans
```

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
- Save/load via `localStorage` (inventory + placed tiles + camera)
- Time state resets on page load (not persisted)

## Debug Mode (B)

- Bounding boxes on characters, trees, tiles
- Time-of-day overlay: phase name + elapsed MM:SS / 10:00

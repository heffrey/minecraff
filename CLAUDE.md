# CLAUDE.md

## Project Overview

Minecraff is a 2D browser-based 8-bit adventure game featuring two playable characters (Alex and Steve). Players chop trees, collect resources, and explore the world. Built with vanilla JavaScript, HTML5 Canvas, and CSS — no frameworks, no build step, no dependencies.

## Tech Stack

- **Language**: Vanilla JavaScript (ES6+)
- **Rendering**: HTML5 Canvas API (800x600)
- **Styling**: Plain CSS
- **Build System**: None — static files served directly
- **Dependencies**: None

## Project Structure

```
minecraff/
├── index.html                    # Game entry point
├── game.js                       # Core game engine (~1400 lines)
├── style.css                     # Game styles
├── sprite-editor.html            # Sprite editor tool
├── sprite-editor.js              # Sprite editor logic
├── sprite-editor.css             # Sprite editor styles
├── inventory-sprite-config.json  # Item-to-sprite frame mappings
├── steve.png                     # Steve sprite sheet (256x256 frames, 4x4)
├── alex.png                      # Alex sprite sheet (256x256 frames, 4x4)
├── trees.png                     # Tree sprite sheet (194x260 frames, 5x4)
└── inventory.png                 # Inventory sprite sheet (164x228 frames, 6x1)
```

## Running Locally

The game requires an HTTP server (not `file://`) for CORS/sprite analysis:

```bash
python3 -m http.server 8000
# or
npx http-server
```

Then open `http://localhost:8000`.

## Key Architecture

- **SpriteSheet** — loads sprite sheets, extracts frames, analyzes alpha channels for collision
- **Character** — player characters with physics, animation, collision detection
- **Tree** — choppable trees with health/damage system
- **WoodParticle** — particle effects when trees are felled
- **InventoryItem** — resource tracking (wood, dirt, stone, clay, gold, iron, silver)

## No Build / No Tests

There is no build step, no bundler, no test framework, and no linter configured. The game runs as static files in any modern browser.

## Deployment

The site deploys to GitHub Pages via the `.github/workflows/deploy.yml` action on pushes to `main`.

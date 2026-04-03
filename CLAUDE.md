# CLAUDE.md — Minecraff Development Notes

## Project

Vanilla JS + HTML5 Canvas 2D side-scroller. All game logic lives in `game.js` (~3300 lines). No build step, no dependencies. Run with any static file server (`python3 -m http.server 8000`).

## Key Architecture

- **`game` object** (top of file): all global state — inventory, placedTiles, camera, dayNight, mobs, etc.
- **`Character` class**: Steve and Alex share one class. Physics, animation, collision all in `update()`.
- **`Mob` class**: enemies and passive animals. `hostile`, `burnsAtDawn`, `burning`, `burnedOut` flags.
- **`Tile` class**: placed materials. 32×32px, stored in world coordinates in `game.placedTiles`.
- **`gameLoop(timestamp)`**: single RAF loop — delta time, day/night phase, sky rendering, entity updates, draw.

## Coordinate System

Canvas Y increases **downward**. Ground is at `canvas.height - 50`. "Above" means **smaller Y**. This matters everywhere in collision code — do not confuse with math Y-up convention.

## Tile Collision

Characters use three methods:
- `getTileBelow()` — finds tile within ±8px of feet; snaps character to tile top each frame
- `getCollidingTilesHorizontal()` — blocks X movement; skips tiles where `standingOnTile` is true
- `getStepUpTile()` — finds tiles ahead that are higher than feet (up to 37px); called from `update()` before horizontal collision

`stepHeight = charFeetY - tileTopY` (positive = tile is above character = step up). The previous backwards sign was the source of "sticking on tiles" bugs.

## Day/Night

`game.dayNight.elapsed` accumulates delta ms. `cyclePos = elapsed / cycleDuration` (0–1). Phase derived from cyclePos ranges. Sky color lerped via `lerpColor(hexA, hexB, t)`. Stars are deterministic (index-based, no `Math.random()`). Phase transitions fire mob spawn/burn logic once per transition.

## Mob Lifecycle

Spawned by `spawnHostileMob(type, options)`. Cap: 8 hostile (non-spider) + 4 spiders. On DAWN transition: `hostile && burnsAtDawn` mobs get `burning = true` → flash red 1500ms → `burnedOut = true` → removed in the backwards `for` loop in `gameLoop`.

## Biomes

`getBiome(worldX)` returns string. `getBiomeColors(biome)` returns `{sky, nightSky, ground, grass}`. Cave at `x < -1000`, swamp at `3000–4000`, snow at `x > 4000`.

## Save / Load

`saveGame()` / `loadGame()` use `localStorage`. Persists: inventory, placedTiles (as JSON), camera position. Day/night state is NOT persisted (resets on load).

## Worktrees

Use `.worktrees/` for feature branches. It is gitignored. When working in a worktree, copy the current `game.js` from main before branching if it has uncommitted changes — the worktree branches from the last commit, not the working tree.

## Gotchas

- `gameLoop()` must be called via `requestAnimationFrame(gameLoop)`, never directly — a direct call passes `undefined` as `timestamp`, causing NaN cascade in delta-time and day/night.
- Mob array iteration uses backwards `for` + `splice` (not `forEach`) to safely remove during iteration.
- `getWorldBounds()` on Character uses `frameBounds.height` directly; the Steve idle-frame height adjustment only applies in specific positioning code paths, not in bounds.
- Remote `origin/main` may have mobile changes the owner rejected. Do not pull blindly.

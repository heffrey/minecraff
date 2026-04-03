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

## Sprite Frame Bounds

`SpriteSheet.analyzeFrameAlpha(frameIndex)` scans pixels to find the bounding box of non-transparent content and caches it in `spriteSheet.frameBounds[idx]`. The result has `{offsetX, offsetY, width, height}` where `offsetY` is the first non-transparent row from the frame top.

**Critical gotcha — bounding box vs. visual content:** The alpha analysis returns the bounding box of ALL non-transparent pixels across a frame. For blossom trees (frames 10-13), the sprite has a small trunk stub at the top (rows 0-17), a fully transparent gap (~50 rows), then the canopy. The bounding box spans from the stub top to canopy bottom, so `offsetY=0` and `height=237` — but drawing the full frame renders the trunk floating visibly above the canopy.

**How to override:** `trees-sprite-config.json` supports `frameHeightOverrides` and `frameOffsetYOverrides` keyed by frame index (string). These are applied to `frameBounds` after `analyzeAllFrames()` completes in the post-load code (`initGame`). `Tree.draw()` uses frameBounds for a clipped `drawImage` — it draws only from `offsetY` to `offsetY+height` in the source frame, so overriding `offsetY` to skip past a trunk stub actually hides it visually.

**To diagnose a new frame's layout:** Use browser console to scan row widths:
```js
const ss = game.spriteSheets.trees, fi = 11;
// ... rowWidths = pixel count per row, find stubEnd / canopyStart / canopyEnd
```
Typical blossom frame structure: stub (0-17), gap (18-64/74), canopy (64/74-236). Set `offsetY = canopyStart`, `height = canopyEnd - canopyStart + 1`.

**`drawFrame` does NOT clip** — it always draws the full `frameWidth × frameHeight`. Only `Tree.draw()` uses the clipped path via frameBounds (both X and Y). Character drawing uses a different system (feetAlignOffset + idleYOffset).

**Sprite sheet bleed:** Frames at the right edge of their column can have semi-transparent pixels from the adjacent frame bleeding in. Alpha threshold is 10, so alpha=16 pixels ARE detected. Frame 6 (dead tree) has green bleed from frame 7 at columns 188-193 — fixed via `frameWidthOverrides: {"6": 123}` in the JSON. When a frame shows a "slice of another tree", check the rightmost columns for off-color pixels and add a width override.

## Non-Uniform Sprite Sheet Layouts (Row Offsets)

For sprite sheets where rows are not evenly spaced (e.g., different content at different Y positions), use `rowOffsets` in the config JSON to specify the exact pixel Y where a row should be drawn. `SpriteSheet` stores `rowOffsets[rowIndex]` — when `drawFrame()` calculates source Y, it checks `this.rowOffsets[row]` and uses that instead of the standard `row * frameHeight` calculation. Same logic applies in `Mob.draw()` and `Tree.draw()` when computing source sprite coordinates.

**Example:** Pig sprites in `mobs.png` have proper 3D head geometry starting at Y=871, not at the default row 5 position (Y=900). Fixed via:
```json
"rowOffsets": {
  "5": 871
}
```

Both `Mob.draw()` and `Tree.draw()` check `this.spriteSheet.rowOffsets[row]` before calculating `sy` — applies automatically when the offset is set in config.

## Gotchas

- `gameLoop()` must be called via `requestAnimationFrame(gameLoop)`, never directly — a direct call passes `undefined` as `timestamp`, causing NaN cascade in delta-time and day/night.
- Mob array iteration uses backwards `for` + `splice` (not `forEach`) to safely remove during iteration.
- `getWorldBounds()` on Character uses `frameBounds.height` directly; the Steve idle-frame height adjustment only applies in specific positioning code paths, not in bounds.

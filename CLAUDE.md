# CLAUDE.md — Minecraff Development Notes

## Project

Vanilla JS + HTML5 Canvas 2D side-scroller for **two players at one laptop**. No
build step, no dependencies, no module system. Run with any static file server
(`python3 -m http.server 8000`).

Four scripts share one global scope, loaded in this order:

| File | Owns |
|---|---|
| `game.js` | state, input, simulation, `drawWorld()` |
| `coop.js` | `updateCoopCamera()`, `drawCoopOverlay()` — split camera, PIP, beacons |
| `minimap.js` | `drawMinimap()` |
| `techtree.js` | `drawTechPanel()`, `techPanelKey()`, `techPanelClick()`, `hasTech()` |

`docs/coop-contract.md` is the integration contract and is authoritative — read
it before touching any cross-file symbol. `gameLoop` calls every hook as
`typeof fn === 'function' && fn(...)`, so a module failing to load degrades the
game rather than killing it.

## Key Architecture

- **`game` object** (top of file): all global state — inventory, placedTiles, camera, dayNight, mobs, etc.
- **`Character` class**: Steve and Alex share one class. Physics, animation, collision all in `update()`.
- **`Mob` class**: enemies and passive animals. `hostile`, `burnsAtDawn`, `burning`, `burnedOut` flags.
- **`Tile` class**: placed materials. 32×32px, stored in world coordinates in `game.placedTiles`.
- **`gameLoop(timestamp)`**: single RAF loop — simulate, then `updateCoopCamera`, then `drawWorld`, then overlays, then HUD.

## Two-Player Parity

Both characters are fully equal. There is no "the player".

**`game.mining` and `game.digging` no longer exist.** Action state lives on each
character as `char.mining` / `char.digging`. Anything that scans for "the current
action" must take a character parameter — `startPlayerAction(char)`,
`updatePlayerAction(char, now)`, `stopPlayerAction(char)`. Reintroducing a global
here silently gives one player control of the other's pickaxe.

**Gotcha — `mining.targetTreeIndex` is an index into `game.trees`, and both
players hold one.** When one player fells a tree, `game.trees.splice()` shifts
every later index. The other player's index must be decremented if it was
greater, and their mining stopped if it was equal — otherwise they carry on
chopping whatever tree slid into that slot, or chop a stale index off the end of
the array.

### Hemispheres are a property of the keyboard, not of the character

`HEMISPHERES` is keyed by side (`left` = WASD+F, `right` = arrows+`/`) and never
moves. `game.controlAssignment` (`{left: 1, right: 0}`) maps side → player index,
and **Backspace** flips it via `swapControlHemispheres()`.

**`char.controls` and `char.hemisphere` are getters, deliberately.** They re-derive
from `game.controlAssignment` on every read, so a swap propagates everywhere at
once. Caching either one into a field reintroduces the bug this design exists to
prevent: stale bindings and world hints that name the wrong key. Anything that
prints a key must go through `actionKeyLabel(char)`.

`swapControlHemispheres()` clears `game.keys` and calls `stopPlayerAction()` +
`stop()` on both characters before flipping. Without that, a key held across the
swap latches movement on the player who just inherited it.

## `drawWorld` is pure rendering

`drawWorld(ctx, camX, camY, viewW, viewH, opts)` is called **twice per frame**
when the players are split — once for the main view, once inside a clip region
for the picture-in-picture inset.

So it must never mutate state and must never read `game.camera`. Every `update()`
call, every `splice()`, the day/night advance and the auto-save stay in
`gameLoop`. Moving any of them into `drawWorld` double-steps the simulation on
every frame the inset is visible — mobs move twice as fast, particles die early,
and it only reproduces when the players are far apart. Viewport culling reads
`camX/camY/viewW/viewH`, never `canvas.width/height`.

`opts.hud === false` suppresses world-space hints and debug boxes for the inset.

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

## Ground Digging

Steve can dig downward into the ground and sideways when underground. Hold **E** + direction to dig continuously (dig speed: 300ms per block).

**Storage:**
- `game.groundHoles` — Set of dug positions, keyed as `"worldGridX,depth"`
- `game.dugMaterials` — Map storing `"worldGridX,depth"` → material name for visual rendering

**Digging mechanics:**
- Depth is capped at `MAX_DIG_DEPTH` (50 layers, 1600px). This is a *rendering*
  limit as much as a gameplay one — `drawGroundWithHoles()` only paints that far
  down, so a deeper hole would be invisible while collision still walked into
  it. The dig scan and both render loops read the one constant; raise it and all
  three move together (at the cost of more layers drawn per frame). Digging into
  a column already dug to the cap does nothing, with no feedback
- E-key priority: mobs in range → trees → ground digging. Steve spawns among
  trees, so bare E near spawn chops wood and never reaches the dig branch.
  **Holding Down/S with E (`digIntent`) skips the attack and chop checks** and
  digs regardless — measured on the starting 3000px, only 26% of positions
  reached the dig branch on bare E (49% chop, 14% chicken, 11% mob), and because
  trees regrow and chickens wander, the same spot changes behaviour over time
- The attack/chop decision is duplicated: once in the E `keydown` handler and
  again in `gameLoop`, which re-runs it every frame E is held. The gameLoop copy
  must also honour `digIntent` and bail while `game.digging.isDigging`, or a tree
  in range hijacks a dig that already started
- Directional controls: **E + Down/S** or just **E** digs down; **E + Left/A**
  tunnels left; **E + Right/D** tunnels right. **E + Up** does NOT dig (Up is
  reserved for jump)
- Digging **down** advances `targetDepth`; digging **left/right** advances
  `targetTileX` by ±32 at a constant depth, carving a horizontal tunnel
- While holding E, Steve digs continuously (300ms per block)
- Cannot dig if a mob is in attack range
- Each block yields a material (dirt, stone, iron, etc.) based on biome and depth

**Gotcha — dig sentinels must be `null`, not `-1`.** World X goes negative (the
cave biome is entirely `x < -1000`, and ~half the starting trees sit at negative
X), so the old `game.digging.targetTileX >= 0` guard silently refused to dig
anywhere west of the origin: the dig started and Steve entered the `mine` state,
but `gameLoop` never removed a block. Any "is a target set?" test here has to be
a `!== null` check, never a sign test.

**Gotcha — abort check must compare against `originTileX`, not `targetTileX`.**
`game.digging.originTileX` records the tile the digger stood on when the dig
began. A sideways dig targets an *adjacent* tile, so comparing the digger's
current tile to `targetTileX` is never equal and aborts the dig on the very next
frame — that bug made tunneling silently impossible (the dig started, then died
before a single block was removed). Measure "did the player walk away?" against
`originTileX`.

**Visual rendering:**
- Surface (depth 0): Biome-specific color (green for default)
- Mid-layer (depth 1): Brown (#8B4513)
- Deep layers (2+): Progressive darkening from gray to near-black by depth ~10, then stays very dark
- Color variations: seeded random creates 15% darker/10% lighter blocks for visual interest
- Rocks spawn randomly, increasing frequency with depth (10% base + 2% per layer, capped at 50%)
- Renders up to 50 visible layers below surface (1600px)

**Collision with holes:**
- Character snaps to floorY calculated by checking contiguous dug depths
- Loop: `while (isGroundHole(tileX, depth)) depth++` to find first solid ground
- Mobs do NOT fall into holes (use fixed worldGroundY)

**Save/Load:**
- `groundHoles` serialized as array, restored as `new Set()`
- `dugMaterials` persisted as Object, restored as Map

## Mob Lifecycle

Spawned by `spawnHostileMob(type, options)`. Cap: 8 hostile (non-spider) + 4 spiders. On DAWN transition: `hostile && burnsAtDawn` mobs get `burning = true` → flash red 1500ms → `burnedOut = true` → removed in the backwards `for` loop in `gameLoop`.

### Death is a 2.5s window, not an instant

`Mob.die()` does not remove the mob. It sets `isDying = true` and starts a 2.5s
spin-and-fade; only when that finishes does `burnedOut = true` and the backwards
loop in `gameLoop` splice it out. So for 2.5 seconds a dead mob is still in
`game.mobs` — **every mob scan needs `isDying` in its skip condition, not just
`burnedOut`.** Three places got this wrong:

- **`Mob.takeDamage()` — this one crashed the game.** `createExplosion` damages
  every non-`burnedOut` mob in radius, and a dying creeper sits at distance 0 of
  its own blast. Damage → `die()` → `createExplosion` → damage → … recursed
  until `RangeError: Maximum call stack size exceeded`. Killing *any* creeper
  killed the game. `takeDamage()` now returns immediately when `isDying ||
  burnedOut`, and `die()` sets `isDying` **before** calling `createExplosion` so
  the blast cannot come back around.
- **`Character.attack()` target scan** — corpses were targetable, so they soaked
  hits and shielded live mobs standing behind them.
- **`createExplosion()`** — skips corpses now, so blasts don't fling them about.

`Mob.update()` returns early while `isDying`, so corpses already could not walk
or attack; that part was fine.

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

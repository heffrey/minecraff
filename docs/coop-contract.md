# Couch Co-op Contract

This document is the integration contract between `game.js` and the three new
modules added for two-player couch co-op. Every module is a plain `<script>`
loaded **after** `game.js` in `index.html`. There is no build step and no module
system, so everything shares one global scope. Do not use `import`/`export`.

Load order in `index.html`:

```html
<script src="game.js"></script>
<script src="coop.js"></script>
<script src="minimap.js"></script>
<script src="techtree.js"></script>
```

`game.js` defines every symbol below. A module may **read** them and may
**define** the hook functions assigned to it, but must not redefine anything
`game.js` owns.

---

## 1. Players

`game.characters` is `[steve, alex]` and both are fully equal. Each `Character`
carries its own action state — there is no global "the player" any more.

Per-character fields the modules rely on:

| Field | Meaning |
|---|---|
| `char.name` | `'Steve'` or `'Alex'` |
| `char.playerIndex` | `0` for Steve, `1` for Alex |
| `char.color` | hex string, the player's UI accent colour |
| `char.controls` | getter — the binding object for this player's current hemisphere (see §2) |
| `char.hemisphere` | getter — `'left'` or `'right'` |
| `char.hp`, `char.maxHp` | health |
| `char.mining` | `{ isMining, targetTreeIndex, lastHitTime, hitInterval }` |
| `char.digging` | `{ isDigging, targetTileX, originTileX, targetDepth, direction, lastHitTime, hitInterval }` |
| `char.getWorldBounds()` | `{x, y, width, height}` in world coordinates |

Helper: `playerCenter(char)` returns `{x, y}`, the character's world-space centre.

## 2. Controls — two swappable keyboard hemispheres

The two halves of the keyboard are fixed; which character each half drives is
not. `HEMISPHERES` is keyed by **side**, never by player:

```js
HEMISPHERES = {
    left:  { side: 'left',  label: 'WASD',   marker: '◀',
             left: ['a'], right: ['d'], jump: ['w'], down: ['s'], action: ['f', 'e'] },
    right: { side: 'right', label: 'ARROWS', marker: '▶',
             left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp'],
             down: ['ArrowDown'], action: ['/', '.'] }
}
```

Each binding value is an array of `KeyboardEvent.key` strings (already
lower-cased for letters; `game.keys` is written with a normalised key — see
`normalizeKey()`). `label` and `marker` are for UI only.

`game.controlAssignment` maps side → `playerIndex`:

```js
game.controlAssignment = { left: 1, right: 0 }   // default: Alex on WASD, Steve on the arrows
```

Per-character accessors, both **derived on every read** so a swap is visible
immediately — do not cache them:

| Accessor | Meaning |
|---|---|
| `char.controls` | getter → `HEMISPHERES[char.hemisphere]`, or `null` |
| `char.hemisphere` | getter → `'left'` \| `'right'` \| `null` |
| `hemisphereFor(char)` | the same lookup as a plain function |
| `controlsFor(char)` | the same lookup as a plain function |

`isControlDown(char, 'action')` answers "is that binding currently held?" — same
signature as before, and it reads the character's *current* hemisphere.

### `swapControlHemispheres()` — defined by `game.js`
Flips `game.controlAssignment`. Bound to **Backspace**, which is deliberately in
neither hemisphere so it can never double as a movement key. The swap clears
`game.keys` and calls `stopPlayerAction(char)` + `char.stop()` on both
characters first, so a key held across the swap cannot latch movement on the
player who just inherited it. It then sets `game.controlBanner`
(`{text, until}`) for a brief on-screen confirmation, and saves.

`controlAssignmentSummary()` renders the current assignment as
`"ALEX ◀ WASD+F   STEVE ▶ ARROWS+/"` — reuse it if you render the assignment in
a HUD of your own.

`char.color` belongs to the character (Steve `#4fc3f7`, Alex `#ff9800`) and does
**not** move when the hemispheres swap. Anything that labels a key — world
hints, HUD — must read it through `char.controls` / `actionKeyLabel(char)`, never
from a hardcoded side.

## 3. Camera and viewports — owned by `coop.js`

`game.camera` stays the **main** camera (`{x, y}` world coordinates of the
viewport's top-left) and is what every existing draw call reads.

`game.coop` is created by `game.js` with defaults and mutated by `coop.js`:

```js
game.coop = {
    split: false,        // true when the players are too far apart to share one view
    splitAt: 0,          // ms timestamp when the split began (0 when together)
    pip: null,           // {x, y, w, h, camX, camY, char} while split, else null
    beaconsEnabled: true
}
```

### `updateCoopCamera(deltaMs)` — defined by `coop.js`
Called once per frame from `gameLoop`, **before** any drawing. Decides
`game.coop.split`, moves `game.camera`, and fills in `game.coop.pip`.

### `drawCoopOverlay(ctx)` — defined by `coop.js`
Called from `gameLoop` after the world and characters are drawn but before the
inventory/palette HUD. Renders the picture-in-picture inset and the off-screen
beacons.

### `drawWorld(ctx, camX, camY, viewW, viewH, opts)` — defined by `game.js`
Renders sky, ground, tiles, mobs, chickens, trees, particles and characters for
an arbitrary camera. `gameLoop` calls it for the main view; `coop.js` calls it
again, inside a clip region, for the PIP. `opts.hud === false` suppresses
world-space hints ("Press / to chop", labelled per player) so the PIP stays clean.

**`drawWorld` must not read `game.camera` directly** — it takes the camera as
arguments precisely so it can be re-run for the inset.

## 4. Minimap — owned by `minimap.js`

### `drawMinimap(ctx)` — defined by `minimap.js`
Called from `gameLoop` in the HUD pass. Draws nothing when
`game.showMinimap === false`. `game.showMinimap` is declared in `game.js` and
toggled by the `M` key.

## 5. Tech tree and workshop — owned by `techtree.js`

`game.tech` is created by `game.js`:

```js
game.tech = {
    unlocked: new Set(['survival']),  // ids of researched nodes
    open: false,                      // panel visible
    tab: 'tech',                      // 'tech' | 'workshop'
    selected: null,                   // hovered/selected node or recipe id
    crafted: {},                      // recipeId -> charges on hand
    pickTier: null,                   // 'stone' | 'iron' | null -- pick in use
    toolBlocks: 0,                    // blocks left on the active pick
    plating: 0                        // iron_ingot uses, capped at 3
}
```

`game.torches` and `game.waypoints` (both arrays of `{x, y}` world coords) are
also owned by `game.js` and written by the workshop.

### Functions defined by `techtree.js`
| Function | Called from | Purpose |
|---|---|---|
| `drawTechPanel(ctx)` | `gameLoop` HUD pass | draw the overlay when `game.tech.open` |
| `techPanelKey(key)` | `keydown` | returns `true` if the panel consumed the key |
| `techPanelClick(mx, my)` | canvas `click` | returns `true` if the panel consumed the click |
| `hasTech(id)` | anywhere | `game.tech.unlocked.has(id)` |
| `useSelectedCraft()` | `keydown` (`C`) | spend one charge of the selected recipe |

### Functions defined by `game.js`, called from `techtree.js`

These are the only calls that go the other way. Each is invoked through a
`typeof x === 'function'` guard so the panel still works if `game.js` is older
than the module.

| Function | Called from | Purpose |
|---|---|---|
| `onTechUnlocked(id)` | `attemptResearch` | push newly-unlocked effects onto both characters |
| `applyCraftedEffect(id)` | `useSelectedCraft` | do the work of a spent charge; returns a **string to refuse** (charge kept) or truthy on success |
| `craftYield()` | `attemptCraft` | 1, or 2 once `pottery` is researched |
| `engageBestPick()` | `attemptCraft` | put a freshly crafted pick to work if none is in use |

`T` toggles the panel, `Tab` switches tabs, `Escape` closes.
While the panel is open it swallows keys so player movement is not triggered.
`C` spends a charge and deliberately works with the panel **shut**, so you can
drop a torch or throw up a wall mid-fight. It is bound in neither hemisphere,
the same reasoning that put the seat swap on Backspace.

## 6. Save / load

`saveGame()` writes `version: 3` and serialises `tech: [...game.tech.unlocked]`,
`crafted`, `pickTier`, `toolBlocks`, `plating`, `torches`, `waypoints`,
`controlAssignment`, plus a `players` array of `{x, y, hp}`. `loadGame()`
restores each under its own independent guard — a v2 save (or one written before
co-op existed) has none of these keys and must still load.

**Timed buffs are deliberately not persisted.** A `Date.now()` deadline written
before a reload is meaningless after it, and reloading should not hand out a
free 45 s of Snow Boots. Same reasoning that already keeps `dayNight` out of the
save.

**`applyTechToCharacters()` must run between the `tech` block and the `players`
block.** The players block clamps `hp` against `maxHp`; if the tech effects have
not been applied yet, `maxHp` is still the constructor's 20 and a 40 HP save
silently loads as 20.

## 7. Defensive calls

`gameLoop` calls every hook as `typeof fn === 'function' && fn(...)`, so the game
still runs if a module fails to load.

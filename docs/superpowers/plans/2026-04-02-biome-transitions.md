# Biome Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make biome transitions immersive by blending sky/ground colors and mixing vegetation as the player approaches a boundary.

**Architecture:** A `getBiomeBlend(playerX)` function returns a `{ fromBiome, toBiome, factor }` blend descriptor. The factor (0–1, smoothstepped) drives color interpolation via the existing `lerpColor()` and weighted vegetation pool selection during chunk spawning. All changes are in `game.js`.

**Tech Stack:** Vanilla JavaScript, Canvas 2D, existing `lerpColor()` helper

---

## File Map

- **Modify:** `game.js`
  - Add `BIOME_TRANSITIONS` config constant (~line 2580, after `getBiomeColors`)
  - Add `getBiomeBlend()` function (~line 2580)
  - Add `getBlendedBiomeColors()` function (~line 2580)
  - Update line 2773: replace `getBiomeColors(currentBiome)` with blended version
  - Add `BIOME_VEGETATION` config constant (~line 2445, before `spawnTreesInArea`)
  - Add `getVegetationFrameIndex()` helper (~line 2445)
  - Update `spawnTreesInArea()` frame selection to use blend-weighted pools

---

## Task 1: Add BIOME_TRANSITIONS config and getBiomeBlend()

**Files:**
- Modify: `game.js` — insert after `getBiomeColors()` (~line 2580)

- [ ] **Step 1: Open game.js and locate the insertion point**

Find the closing brace of `getBiomeColors` (around line 2579). The new code goes immediately after it.

- [ ] **Step 2: Insert BIOME_TRANSITIONS constant and getBiomeBlend() after getBiomeColors**

```js
// Transition zone config: each entry defines a boundary, which biomes are on each side,
// and how wide (in world units) the blend zone extends around that boundary.
const BIOME_TRANSITIONS = [
    { x: -1000, left: 'cave',    right: 'default', width: 150 },
    { x:  2000, left: 'default', right: 'sand',    width: 400 },
    { x:  3000, left: 'sand',    right: 'swamp',   width: 250 },
    { x:  4000, left: 'swamp',   right: 'snow',    width: 500 },
];

// Returns { fromBiome, toBiome, factor } for a given world X.
// factor is 0 (fully fromBiome) to 1 (fully toBiome), smoothstepped.
// Outside all transition zones, fromBiome === toBiome and factor === 0.
function getBiomeBlend(playerX) {
    for (const t of BIOME_TRANSITIONS) {
        const half = t.width / 2;
        if (playerX >= t.x - half && playerX <= t.x + half) {
            const raw = (playerX - (t.x - half)) / t.width; // 0..1 linear
            const factor = raw * raw * (3 - 2 * raw);       // smoothstep
            return { fromBiome: t.left, toBiome: t.right, factor };
        }
    }
    const b = getBiome(playerX);
    return { fromBiome: b, toBiome: b, factor: 0 };
}
```

- [ ] **Step 3: Verify in browser console**

Open the game in browser. In DevTools console run:
```js
console.log(getBiomeBlend(1900)); // near default→sand boundary
// Expected: { fromBiome: 'default', toBiome: 'sand', factor: ~0.156 }
console.log(getBiomeBlend(2000)); // exactly on boundary
// Expected: { fromBiome: 'default', toBiome: 'sand', factor: 0.5 }
console.log(getBiomeBlend(500));  // well inside default
// Expected: { fromBiome: 'default', toBiome: 'default', factor: 0 }
```

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add BIOME_TRANSITIONS config and getBiomeBlend()"
```

---

## Task 2: Add getBlendedBiomeColors() and wire into render

**Files:**
- Modify: `game.js` — insert after `getBiomeBlend()`, then update line 2773

- [ ] **Step 1: Insert getBlendedBiomeColors() immediately after getBiomeBlend()**

```js
// Returns biome colors interpolated between fromBiome and toBiome based on blend.factor.
function getBlendedBiomeColors(blend) {
    if (blend.factor === 0) return getBiomeColors(blend.fromBiome);
    const a = getBiomeColors(blend.fromBiome);
    const b = getBiomeColors(blend.toBiome);
    return {
        sky:      lerpColor(a.sky,      b.sky,      blend.factor),
        nightSky: lerpColor(a.nightSky, b.nightSky, blend.factor),
        ground:   lerpColor(a.ground,   b.ground,   blend.factor),
        grass:    lerpColor(a.grass,    b.grass,    blend.factor),
    };
}
```

- [ ] **Step 2: Update biome color lookup in the game loop (line ~2772-2773)**

Find this block (lines 2771-2773):
```js
    // Get current biome based on camera position
    const currentBiome = getBiome(game.camera.x + canvas.width / 2);
    const biomeColors = getBiomeColors(currentBiome);
```

Replace with:
```js
    // Get current biome and blend based on camera/player position
    const playerX = game.camera.x + canvas.width / 2;
    const currentBiome = getBiome(playerX);
    const biomeBlend = getBiomeBlend(playerX);
    const biomeColors = getBlendedBiomeColors(biomeBlend);
```

- [ ] **Step 3: Verify in browser**

Walk the player toward X=2000 (the default→sand boundary). The sky should gradually shift from `#87CEEB` (blue) to `#FFE4B5` (sandy yellow), and the ground from `#8B4513` to `#D2B48C`. There should be no instant color snap at the boundary line.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: blend sky and ground colors across biome boundaries"
```

---

## Task 3: Add BIOME_VEGETATION pools and blend-weighted tree spawning

**Files:**
- Modify: `game.js` — insert before `spawnTreesInArea()` (~line 2445), then update frame selection inside it

- [ ] **Step 1: Insert BIOME_VEGETATION config and getVegetationFrameIndex() before spawnTreesInArea**

These use the existing frame keys from `trees-sprite-config.json`.

```js
// Per-biome vegetation pools. Keys match game.treesMappings / game.shrubsMappings.
// treeRatio: probability that a spawn attempt picks a tree (vs. shrub).
const BIOME_VEGETATION = {
    default: {
        trees:     ['small', 'medium', 'medium2', 'blossom1', 'blossom2'],
        shrubs:    ['shrub1', 'shrub2', 'shrub3'],
        treeRatio: 0.7,
    },
    sand: {
        trees:     ['dead', 'stump'],
        shrubs:    ['shrub3'],
        treeRatio: 0.4,
    },
    swamp: {
        trees:     ['large', 'medium2', 'blossom3', 'blossom4'],
        shrubs:    ['shrub1', 'shrub2'],
        treeRatio: 0.7,
    },
    snow: {
        trees:     ['small', 'medium', 'large'],
        shrubs:    ['shrub2', 'shrub3'],
        treeRatio: 0.7,
    },
    cave: {
        trees:     [],
        shrubs:    ['shrub1'],
        treeRatio: 0,
    },
};

// Returns a frame index for a tree/shrub appropriate to biomeName, or null for cave (no trees).
function getVegetationFrameIndex(biomeName) {
    const pool = BIOME_VEGETATION[biomeName] ?? BIOME_VEGETATION.default;
    const isShrub = pool.trees.length === 0 || Math.random() >= pool.treeRatio;
    if (isShrub) {
        if (pool.shrubs.length === 0) return null;
        const key = pool.shrubs[Math.floor(Math.random() * pool.shrubs.length)];
        return game.shrubsMappings?.[key] ?? null;
    }
    const key = pool.trees[Math.floor(Math.random() * pool.trees.length)];
    return game.treesMappings?.[key] ?? null;
}
```

- [ ] **Step 2: Update frame selection inside spawnTreesInArea**

Find the block inside the `for (let chunkX = ...)` loop that computes `frameIndex` (lines ~2480-2492):

```js
        // Spawn 2-4 trees per chunk
        const treesPerChunk = 2 + Math.floor(Math.random() * 3);
        const chunkStartX = chunkX * chunkSize;
        const chunkEndX = chunkStartX + chunkSize;
        
        for (let i = 0; i < treesPerChunk; i++) {
            // Random X position within chunk
            const treeX = chunkStartX + Math.random() * chunkSize;
            
            // Randomly choose tree or shrub (70% trees, 30% shrubs)
            const isShrub = Math.random() < 0.3;
            const frameIndex = isShrub 
                ? shrubFrames[Math.floor(Math.random() * shrubFrames.length)]
                : treeFrames[Math.floor(Math.random() * treeFrames.length)];
```

Replace with:

```js
        // Spawn 2-4 trees per chunk
        const treesPerChunk = 2 + Math.floor(Math.random() * 3);
        const chunkStartX = chunkX * chunkSize;
        const chunkEndX = chunkStartX + chunkSize;
        const chunkCenterX = chunkStartX + chunkSize / 2;

        // Blend-weighted biome for this chunk's vegetation
        const chunkBlend = getBiomeBlend(chunkCenterX);
        const chunkBiome = Math.random() < chunkBlend.factor
            ? chunkBlend.toBiome
            : chunkBlend.fromBiome;

        for (let i = 0; i < treesPerChunk; i++) {
            // Random X position within chunk
            const treeX = chunkStartX + Math.random() * chunkSize;

            // Pick frame from biome-appropriate vegetation pool
            const frameIndex = getVegetationFrameIndex(chunkBiome);
            if (frameIndex === null) continue; // cave: no vegetation
```

- [ ] **Step 3: Remove the now-unused treeFrames/shrubFrames/allFrames locals**

The variables `treeFrames`, `shrubFrames`, and `allFrames` at lines ~2458-2460 are no longer used inside the chunk loop. Remove them:

```js
    // DELETE these three lines:
    const treeFrames = [smallTreeFrame, mediumTreeFrame, blossomTreeFrame];
    const shrubFrames = [shrub1Frame, shrub2Frame, shrub3Frame];
    const allFrames = [...treeFrames, ...shrubFrames];
```

Also remove the four individual frame constants (`smallTreeFrame`, `mediumTreeFrame`, `blossomTreeFrame`, `shrub1Frame`, `shrub2Frame`, `shrub3Frame`) since frame resolution is now handled inside `getVegetationFrameIndex()`.

- [ ] **Step 4: Verify in browser**

Walk the player rightward from X=0 toward X=2000. Near the boundary, chunks should start containing dead/stump trees mixed with normal trees. Past X=2000, chunks should be mostly dead/stump. Clear `game.spawnedTreeChunks` in the console first to force re-generation: `game.spawnedTreeChunks.clear(); game.trees = [];`

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: blend biome vegetation pools near boundaries"
```

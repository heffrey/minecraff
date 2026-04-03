# Biome Transitions — Design Spec

**Date:** 2026-04-02  
**Status:** Approved

## Problem

Biome transitions are hard cuts. The sky, ground, and grass colors snap instantly when the player crosses a fixed X coordinate. Trees are identical across all biomes. This feels jarring and breaks immersion.

## Goal

As the player approaches a biome boundary, colors fade gradually and biome-specific vegetation starts appearing — making the world feel like a continuous landscape rather than discrete zones.

## Approach: Blend Factor

Calculate a per-frame `blendFactor` (0.0–1.0) based on player distance to the nearest biome boundary. Use this factor to interpolate colors and weight vegetation spawning.

---

## 1. Transition Config Table

A `BIOME_TRANSITIONS` array defines each boundary's position and transition width. Widths vary per pair to reflect the character of each change:

```js
const BIOME_TRANSITIONS = [
  { x: -1000, left: 'cave',    right: 'default', width: 150 },  // abrupt darkness
  { x:  2000, left: 'default', right: 'sand',    width: 400 },  // gradual desert fade
  { x:  3000, left: 'sand',    right: 'swamp',   width: 250 },
  { x:  4000, left: 'swamp',   right: 'snow',    width: 500 },  // dramatic climate shift
];
```

## 2. Blend Factor Calculation

`getBiomeBlend(playerX)` returns `{ fromBiome, toBiome, factor }`:

- Scan all boundaries; find the one closest to `playerX`
- If `playerX` is within `width / 2` of that boundary, compute `factor = smoothstep(0, 1, distanceRatio)`
- Otherwise return `{ fromBiome: currentBiome, toBiome: currentBiome, factor: 0 }`

`smoothstep` (3t² - 2t³) gives a natural ease-in/ease-out feel vs. a linear ramp.

The blend is computed from the **player's X position**, not the camera center — so the player feels the change as they personally walk into it.

## 3. Color Blending

Replace `getBiomeColors(currentBiome)` call sites with `getBlendedBiomeColors(blend)`:

```js
function getBlendedBiomeColors(blend) {
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

`lerpColor()` already exists in the codebase. No new color math needed.

## 4. Biome Vegetation Pools

Each biome gets a named vegetation pool used during chunk generation. New tree/plant types needed:

| Biome   | Vegetation types |
|---------|-----------------|
| default | small tree, medium tree, blossom tree, shrub (existing) |
| sand    | cactus, palm tree, dry shrub |
| swamp   | twisted dark tree, swamp grass clump |
| snow    | pine tree, snow-shrub |
| cave    | mushroom cluster (no trees; low ceiling) |

## 5. Vegetation Blending in Chunk Generation

During chunk spawn, use `blendFactor` at the chunk's center X to weight tree type selection:

```
roll = Math.random()
if roll < (1 - factor): pick from fromBiome pool
else: pick from toBiome pool
```

Chunks are generated once and cached. Blending only affects newly-entered chunks near boundaries — no re-rendering of already-generated chunks.

---

## Out of Scope

- Sound/ambient audio transitions
- Biome-specific tile/block restrictions
- Procedural terrain height variation per biome
- Re-generating existing chunks when transition widths change

## Files Affected

- `game.js` — all changes; no new files needed
  - Add `BIOME_TRANSITIONS` config table
  - Add `getBiomeBlend()` function
  - Add `getBlendedBiomeColors()` function
  - Update sky/ground/grass render calls
  - Add per-biome vegetation pool tables
  - Update chunk tree-spawn logic to use blend-weighted pool

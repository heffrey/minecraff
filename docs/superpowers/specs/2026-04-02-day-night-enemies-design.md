# Day/Night Cycle & Night Enemies Design

## Overview

Add a 10-minute day/night cycle with phase-based sky colors and mob spawning. Hostile mobs only appear at night and burn at dawn.

## Cycle Phases

Full cycle duration: 10 minutes (600,000 ms). Phases as fractions of the cycle:

| Phase   | Range      | Duration  | Sky |
|---------|------------|-----------|-----|
| DAY     | 0.0 – 0.40 | ~4 min    | Biome sky color (current) |
| EVENING | 0.40 – 0.55| ~1.5 min  | Sunset gradient (purple → orange) |
| NIGHT   | 0.55 – 0.75| ~2 min    | Near-black (#0a0a2e) with stars & moon |
| DAWN    | 0.75 – 1.0 | ~1.5 min  | Sunrise gradient (orange → biome sky) |

## Time System

Add to `game`:
```js
game.dayNight = {
  phase: 'DAY',
  elapsed: 0,         // ms into current cycle
  cycleDuration: 600000,
  lastTimestamp: null // for delta time calculation
}
```

Each frame: `elapsed += deltaTime`. When `elapsed >= cycleDuration`, wrap to 0. Derive current phase from `elapsed / cycleDuration`. On phase change, fire transition logic.

## Sky Rendering

`getBiomeColors()` gains a `nightSky` field per biome. The game loop lerps `sky` toward `nightSky` based on phase progress using `lerpColor()`. During EVENING/DAWN, an intermediate sunset color (#e85d3a orange-red) is used as the midpoint.

Stars (20–30 random white pixels, seeded so they don't move) and a glowing moon (filled circle, top-right area) are drawn over the sky when phase is EVENING or NIGHT, fading in/out at transitions.

## Swamp Biome

Added between sand and snow: world x = 3000–4000.

```js
sky: '#4a6741',       // murky green
nightSky: '#0a1a0a',  // near-black green
ground: '#3d5c2a',
grass: '#2d4a1a'
```

Slimes spawn here during EVENING. No other biome-specific mob changes.

## Cave Biome

A dark rocky zone to the left of spawn: world x < -1000.

```js
sky: '#1a1a1a',       // near-black rock
nightSky: '#0a0a0a',  // absolute dark
ground: '#2a2a2a',
grass: '#3a3a3a'
```

Spiders are hostile here and active at all times (day and night). They spawn when the player enters the cave biome (biome transition detected). They do **not** burn at dawn — they live in the cave permanently.

## Mob Behavior

| Mob      | Day              | Evening         | Night  | Dawn          |
|----------|------------------|-----------------|--------|---------------|
| Zombie   | absent           | absent          | spawns | burns         |
| Skeleton | absent           | absent          | spawns | burns         |
| Creeper  | absent           | absent          | spawns | burns         |
| Slime    | absent           | spawns (swamp)  | active | burns         |
| Spider   | hostile (cave)   | hostile (cave)  | hostile (cave) | stays (no burn) |
| Pig      | passive          | passive         | passive| passive       |

**Spawning:** On transition to NIGHT, spawn 2–3 of each hostile type (zombie, skeleton, creeper) at camera edges (off-screen left/right). On transition to EVENING while camera is in swamp biome, spawn 2–3 slimes. On entering cave biome (biome change detected in game loop), spawn 3–4 spiders.

**Burning:** On transition to DAY (end of DAWN), all mobs with `hostile: true` AND `burnsAtDawn: true` get `burning = true`. They flash red for 1.5 seconds then are removed from `game.mobs`. Spiders have `burnsAtDawn: false` and are never removed by dawn.

**Cap:** Max 8 hostile mobs (excluding spiders) at once. Spider cap: 4 per cave entry.

## Passive Mobs at Startup

Only pigs spawn at game start. All other mob types are managed by the biome/phase system. Pigs are `hostile: false`, `burnsAtDawn: false`.

## No-Change Zones

- Character class, collision, inventory, tile placement, particle system — untouched.
- Save/load — time state is not persisted; cycle resets on page load.
- Existing biome boundaries (grass 0–2000, sand 2000–3000) unchanged; swamp inserted at 3000–4000, snow at 4000+; cave at x < -1000.

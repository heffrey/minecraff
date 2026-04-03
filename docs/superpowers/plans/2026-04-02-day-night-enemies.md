# Day/Night Cycle & Night Enemies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 10-minute day/night cycle with phase-based sky colors, stars/moon at night, swamp and cave biomes, and hostile mobs that spawn by biome/phase — burning at dawn except spiders (cave-only, permanent).

**Architecture:** A `dayNight` object on `game` tracks elapsed time and current phase (DAY/EVENING/NIGHT/DAWN). Sky color lerps between biome day/night keyframes each frame. Phase transitions trigger mob spawning/burning. A `prevBiome` tracker fires spider spawning when the player enters the cave biome. All changes are in `game.js`.

**Tech Stack:** Vanilla JS, HTML5 Canvas. No test framework — verification is via browser console + visual check.

---

## File Map

| File | Change |
|------|--------|
| `game.js:7-51` | Add `dayNight` and `prevBiome` to `game` state object |
| `game.js:1188-1228` | Add `hostile`, `burning`, `burnStart`, `burnsAtDawn` to `Mob` constructor |
| `game.js:1257-1310` | Add burn timer logic to `Mob.update()` |
| `game.js:1312-1349` | Add red flash to `Mob.draw()` |
| `game.js:2022-2067` | Keep only pigs in initial spawn; remove spiders |
| `game.js:2486-2520` | Add cave + swamp to `getBiome()`, add `nightSky` to all biomes in `getBiomeColors()` |
| `game.js:2578` | Add `lerpColor`, star positions, `spawnHostileMob` before `gameLoop` |
| `game.js:2582` | Add `timestamp` param to `gameLoop`, compute `deltaMs` |
| `game.js:2633-2639` | Replace sky fill with lerped color + draw stars/moon |
| `game.js` (inside loop) | Add phase transition + biome transition handlers |

---

### Task 1: Add `dayNight` state and delta time to the game loop

**Files:**
- Modify: `game.js:7-51` (game state object)
- Modify: `game.js:2582` (gameLoop signature)

- [ ] **Step 1: Add `dayNight` and `prevBiome` to game state**

In `game.js`, find the `game` object (starts at line 7). Add these as the last two properties before the closing `};`:

```js
    dayNight: {
        phase: 'DAY',          // 'DAY' | 'EVENING' | 'NIGHT' | 'DAWN'
        elapsed: 0,            // ms elapsed in current cycle
        cycleDuration: 600000, // 10 minutes
        lastTimestamp: null    // for delta time
    },
    prevBiome: null            // tracks biome changes for cave spider spawning
```

- [ ] **Step 2: Accept timestamp in gameLoop and compute delta**

Change the `gameLoop` function signature and add delta calculation as the very first thing in the body (before the auto-save block):

```js
function gameLoop(timestamp) {
    // Delta time
    if (game.dayNight.lastTimestamp === null) {
        game.dayNight.lastTimestamp = timestamp;
    }
    const deltaMs = timestamp - game.dayNight.lastTimestamp;
    game.dayNight.lastTimestamp = timestamp;
```

- [ ] **Step 3: Advance elapsed and compute phase**

Immediately after the delta block (still inside `gameLoop`, before the auto-save block), add:

```js
    // Advance day/night cycle
    game.dayNight.elapsed = (game.dayNight.elapsed + deltaMs) % game.dayNight.cycleDuration;
    const cyclePos = game.dayNight.elapsed / game.dayNight.cycleDuration; // 0.0 – 1.0

    const prevPhase = game.dayNight.phase;
    if (cyclePos < 0.40) {
        game.dayNight.phase = 'DAY';
    } else if (cyclePos < 0.55) {
        game.dayNight.phase = 'EVENING';
    } else if (cyclePos < 0.75) {
        game.dayNight.phase = 'NIGHT';
    } else {
        game.dayNight.phase = 'DAWN';
    }
    const phaseChanged = game.dayNight.phase !== prevPhase;
```

- [ ] **Step 4: Verify in browser console**

Open `http://localhost:8080`. Open DevTools console and run:
```js
setInterval(() => console.log(game.dayNight.phase, game.dayNight.elapsed.toFixed(0)), 2000);
```
Expected: phase prints as `DAY` and elapsed increases by ~2000ms each log. No errors.

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: add dayNight state and delta time to game loop"
```

---

### Task 2: Add cave and swamp biomes with night sky colors

**Files:**
- Modify: `game.js:2486-2520` (`getBiome` and `getBiomeColors`)

- [ ] **Step 1: Update `getBiome()` to include cave and swamp**

Replace the `getBiome` function (currently at ~line 2486) with:

```js
function getBiome(worldX) {
    if (worldX < -1000)        return 'cave';
    if (worldX >= 4000)        return 'snow';
    if (worldX >= 3000)        return 'swamp';
    if (worldX >= 2000)        return 'sand';
    return 'default';
}
```

- [ ] **Step 2: Update `getBiomeColors()` to add cave, swamp, and nightSky**

Replace the `getBiomeColors` function (currently at ~line 2500) with:

```js
function getBiomeColors(biome) {
    switch (biome) {
        case 'cave':
            return {
                sky: '#1a1a1a',
                nightSky: '#0a0a0a',
                ground: '#2a2a2a',
                grass: '#3a3a3a'
            };
        case 'sand':
            return {
                sky: '#FFE4B5',
                nightSky: '#0a0820',
                ground: '#D2B48C',
                grass: '#DEB887'
            };
        case 'swamp':
            return {
                sky: '#4a6741',
                nightSky: '#0a1a0a',
                ground: '#3d5c2a',
                grass: '#2d4a1a'
            };
        case 'snow':
            return {
                sky: '#E0E0E0',
                nightSky: '#1a1a2e',
                ground: '#F5F5F5',
                grass: '#E8E8E8'
            };
        default:
            return {
                sky: '#87CEEB',
                nightSky: '#0a0a2e',
                ground: '#8B4513',
                grass: '#228B22'
            };
    }
}
```

- [ ] **Step 3: Verify in browser**

Walk Steve left past x = -1000 (use debug mode `B` to see position, or watch sky turn near-black). Walk right to x = 3000 — sky should turn murky green. No console errors.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add cave and swamp biomes with nightSky colors"
```

---

### Task 3: Sky color lerp + stars + moon

**Files:**
- Modify: `game.js:2578` (before gameLoop — add helpers and star positions)
- Modify: `game.js:2633-2639` (sky draw section in gameLoop)

- [ ] **Step 1: Add `lerpColor` helper and star positions before `gameLoop`**

Find the line `let lastAutoSave = Date.now();` (~line 2578). Insert above it:

```js
// Lerp between two hex colors by t (0=a, 1=b)
function lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16);
    const bh = parseInt(b.slice(1), 16);
    const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
    const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, '0')}`;
}

// Pre-generate star positions (deterministic so they don't move frame-to-frame)
const STARS = Array.from({ length: 25 }, (_, i) => ({
    x: ((i * 137 + 53) % 97) / 97,
    y: ((i * 79  + 17) % 61) / 61 * 0.7,
    r: (i % 3 === 0) ? 1.5 : 1
}));
```

- [ ] **Step 2: Replace the sky fill in `gameLoop` with lerped color + stars + moon**

Find this block in `gameLoop` (~line 2633):

```js
    // Get current biome based on camera position
    const currentBiome = getBiome(game.camera.x + canvas.width / 2);
    const biomeColors = getBiomeColors(currentBiome);
    
    // Clear canvas with biome sky color
    ctx.fillStyle = biomeColors.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
```

Replace it with:

```js
    // Get current biome based on camera position
    const currentBiome = getBiome(game.camera.x + canvas.width / 2);
    const biomeColors = getBiomeColors(currentBiome);

    // Compute sky color based on day/night phase
    const SUNSET_COLOR = '#e85d3a';
    let skyColor;
    if (cyclePos < 0.40) {
        skyColor = biomeColors.sky;
    } else if (cyclePos < 0.55) {
        const t = (cyclePos - 0.40) / 0.15;
        skyColor = t < 0.5
            ? lerpColor(biomeColors.sky, SUNSET_COLOR, t * 2)
            : lerpColor(SUNSET_COLOR, biomeColors.nightSky, (t - 0.5) * 2);
    } else if (cyclePos < 0.75) {
        skyColor = biomeColors.nightSky;
    } else {
        const t = (cyclePos - 0.75) / 0.25;
        skyColor = t < 0.5
            ? lerpColor(biomeColors.nightSky, SUNSET_COLOR, t * 2)
            : lerpColor(SUNSET_COLOR, biomeColors.sky, (t - 0.5) * 2);
    }

    ctx.fillStyle = skyColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Stars and moon fade in during evening, stay through night, fade out at dawn
    const starAlpha = cyclePos >= 0.55 && cyclePos < 0.75 ? 1.0
        : cyclePos >= 0.40 && cyclePos < 0.55 ? (cyclePos - 0.40) / 0.15
        : cyclePos >= 0.75 && cyclePos < 0.875 ? 1.0 - (cyclePos - 0.75) / 0.125
        : 0;

    if (starAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = starAlpha;
        ctx.fillStyle = '#ffffff';
        for (const star of STARS) {
            ctx.beginPath();
            ctx.arc(star.x * canvas.width, star.y * canvas.height * 0.8, star.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Moon: glowing circle top-right
        ctx.shadowColor = '#fffde7';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fffde7';
        ctx.beginPath();
        ctx.arc(canvas.width - 60, 40, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
```

- [ ] **Step 3: Verify visually in browser**

Temporarily set `game.dayNight.cycleDuration = 60000` in the console. Watch the sky cycle through blue → orange → dark → orange → blue over 60 seconds. Stars and moon appear at night. Set back to `600000`. No console errors.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: lerp sky through day/night phases, draw stars and moon"
```

---

### Task 4: Add `hostile`/`burnsAtDawn` flags to Mob, slim down initial spawn

**Files:**
- Modify: `game.js:1188-1228` (Mob constructor)
- Modify: `game.js:2022-2067` (initial mob spawn)

- [ ] **Step 1: Add flags to Mob constructor**

In the `Mob` constructor (line ~1228, after `this.lastStateChange = Date.now();`), add:

```js
        // Day/night + cave system
        this.hostile = false;      // true = managed by spawn system
        this.burnsAtDawn = true;   // false = survives dawn (e.g. spiders)
        this.burning = false;
        this.burnStart = 0;
        this.burnedOut = false;
```

- [ ] **Step 2: Keep only pigs in initial world spawn**

Find the initial mob spawn block (~line 2022). Change `mobTypes` to only pigs:

```js
        // Create passive mobs in the world (all other mobs managed by biome/phase system)
        if (game.spriteSheets.mobs) {
            const worldGroundY = canvas.height - 50;
            const mobTypes = ['pig'];
            const mobs = [];
```

- [ ] **Step 3: Verify in browser**

Reload the game. Only pigs should be visible on startup. No zombies, skeletons, creepers, slimes, or spiders present. Console: `game.mobs.map(m => m.mobType)` → array of only `'pig'`.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add hostile/burnsAtDawn flags to Mob, initial spawn pigs only"
```

---

### Task 5: Spawn hostile mobs on phase and biome transitions

**Files:**
- Modify: `game.js:2578` (add `spawnHostileMob` before `gameLoop`)
- Modify: `game.js` (phase transition block inside `gameLoop`)

- [ ] **Step 1: Add `spawnHostileMob` helper before `gameLoop`**

Add just above the `let lastAutoSave` line:

```js
function spawnHostileMob(mobType, options = {}) {
    if (!game.spriteSheets.mobs) return;

    // Cap: spiders capped at 4, all other hostiles capped at 8
    const isSpider = mobType === 'spider';
    const hostileCount = game.mobs.filter(m => m.hostile && m.mobType !== 'spider').length;
    const spiderCount  = game.mobs.filter(m => m.mobType === 'spider').length;
    if (isSpider && spiderCount >= 4) return;
    if (!isSpider && hostileCount >= 8) return;

    const worldGroundY = canvas.height - 50;
    const side = Math.random() < 0.5 ? -1 : 1;
    const spawnX = options.spawnX !== undefined
        ? options.spawnX
        : game.camera.x + (side < 0 ? -80 : canvas.width + 80);
    const facing = side < 0 ? 'right' : 'left';

    const mob = new Mob(game.spriteSheets.mobs, spawnX, 0, mobType, facing);
    mob.hostile = true;
    mob.burnsAtDawn = isSpider ? false : true;

    const mobBaseFrame = mob.rowIndex * game.spriteSheets.mobs.cols;
    const mobFrameBounds = game.spriteSheets.mobs.frameBounds[mobBaseFrame];
    let groundOffset = 0;
    if (mob.mobType === 'slime')  groundOffset = 15;
    if (mob.mobType === 'spider' || mob.mobType === 'pig') groundOffset = 3;

    if (mobFrameBounds) {
        const spriteBottomInFrame = mobFrameBounds.offsetY + mobFrameBounds.height;
        mob.y = worldGroundY - (spriteBottomInFrame * mob.scale) + groundOffset;
    } else {
        mob.y = worldGroundY - mob.height + groundOffset;
    }

    game.mobs.push(mob);
}
```

- [ ] **Step 2: Add phase and biome transition handlers inside `gameLoop`**

Inside `gameLoop`, after the `const phaseChanged = ...` line, add:

```js
    // Detect biome change for cave spider spawning
    const biomeChanged = currentBiome !== game.prevBiome;
    game.prevBiome = currentBiome;

    // Phase transition: spawn night mobs
    if (phaseChanged && game.dayNight.phase === 'NIGHT') {
        ['zombie', 'skeleton', 'creeper'].forEach(type => {
            const count = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < count; i++) spawnHostileMob(type);
        });
    }

    // Phase transition: spawn swamp slimes at evening
    if (phaseChanged && game.dayNight.phase === 'EVENING' && currentBiome === 'swamp') {
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) spawnHostileMob('slime');
    }

    // Phase transition: mark dawn-burning mobs
    if (phaseChanged && game.dayNight.phase === 'DAY') {
        const now = Date.now();
        game.mobs.forEach(mob => {
            if (mob.hostile && mob.burnsAtDawn && !mob.burning) {
                mob.burning = true;
                mob.burnStart = now;
            }
        });
    }

    // Biome transition: entering cave spawns spiders
    if (biomeChanged && currentBiome === 'cave') {
        const count = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) spawnHostileMob('spider');
    }
```

Note: `currentBiome` is computed just before this block (Task 3 Step 2).

- [ ] **Step 3: Verify phase spawning in browser**

In console, set `game.dayNight.cycleDuration = 60000`. Wait ~33s for NIGHT. Then:
```js
game.mobs.filter(m => m.hostile).map(m => m.mobType)
```
Expected: array of `'zombie'`, `'skeleton'`, `'creeper'`. Walk Steve left past x=-1000 and check:
```js
game.mobs.filter(m => m.mobType === 'spider').length
```
Expected: 3 or 4. Restore `cycleDuration = 600000`.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: spawn night mobs on phase transitions, spiders on cave biome entry"
```

---

### Task 6: Burning animation and removal

**Files:**
- Modify: `game.js:1257-1310` (Mob.update)
- Modify: `game.js:1312-1349` (Mob.draw)
- Modify: `game.js:2737` (mob loop in gameLoop)

- [ ] **Step 1: Add burn self-removal to `Mob.update()`**

At the end of `Mob.update()`, just before the closing `}`, add:

```js
        // Burning: self-remove after 1500ms
        if (this.burning) {
            if (Date.now() - this.burnStart > 1500) {
                this.burnedOut = true;
            }
        }
```

- [ ] **Step 2: Add red flash to `Mob.draw()`**

Inside `Mob.draw()`, after `ctx.save();` and before the slime clip block, add:

```js
        // Flash red while burning (alternate every 100ms)
        if (this.burning && Math.floor(Date.now() / 100) % 2 === 0) {
            ctx.restore();
            ctx.fillStyle = 'rgba(255, 50, 0, 0.85)';
            ctx.fillRect(screenX, screenY, this.width, this.height);
            return;
        }
```

- [ ] **Step 3: Replace `game.mobs.forEach` in `gameLoop` with a splice-safe loop**

Find the mob update block in `gameLoop` (~line 2737):

```js
    // Update and draw mobs (before chickens, so they appear below)
    game.mobs.forEach(mob => {
        mob.update();
        const mobWorldBounds = mob.getWorldBounds();
        // Only draw if mob is in viewport
        if (mobWorldBounds.x + mobWorldBounds.width >= game.camera.x &&
            mobWorldBounds.x <= game.camera.x + canvas.width &&
            mobWorldBounds.y + mobWorldBounds.height >= game.camera.y &&
            mobWorldBounds.y <= game.camera.y + canvas.height) {
            mob.draw(ctx, game.camera.x, game.camera.y);
        }
        
        // Draw bounding boxes in debug mode
        if (game.debugMode) {
            const bounds = mob.getBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            
            // Draw mob type label
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(mob.mobType, bounds.x, bounds.y - 5);
        }
    });
```

Replace with:

```js
    // Update and draw mobs — iterate backwards to allow splice
    for (let i = game.mobs.length - 1; i >= 0; i--) {
        const mob = game.mobs[i];
        mob.update();
        if (mob.burnedOut) {
            game.mobs.splice(i, 1);
            continue;
        }
        const mobWorldBounds = mob.getWorldBounds();
        if (mobWorldBounds.x + mobWorldBounds.width >= game.camera.x &&
            mobWorldBounds.x <= game.camera.x + canvas.width &&
            mobWorldBounds.y + mobWorldBounds.height >= game.camera.y &&
            mobWorldBounds.y <= game.camera.y + canvas.height) {
            mob.draw(ctx, game.camera.x, game.camera.y);
        }
        if (game.debugMode) {
            const bounds = mob.getBounds(game.camera.x, game.camera.y);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(mob.mobType, bounds.x, bounds.y - 5);
        }
    }
```

- [ ] **Step 4: Verify burning in browser**

Set `game.dayNight.cycleDuration = 60000`. Wait through NIGHT (~13s). At dawn, hostile non-spider mobs should flash red then disappear. After burn:
```js
game.mobs.filter(m => m.hostile && m.burnsAtDawn).length
```
Expected: `0`. Restore `cycleDuration = 600000`.

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: hostile mobs flash red and despawn at dawn, cave spiders persist"
```

---

## Spec Coverage Check

| Spec requirement | Covered by |
|---|---|
| 10-minute cycle, 4 phases | Task 1 |
| Sky lerps day→sunset→night | Task 3 |
| Stars and moon at night | Task 3 |
| Swamp biome x=3000–4000 | Task 2 |
| Cave biome x < -1000 | Task 2 |
| `nightSky` per biome | Task 2 |
| `hostile` + `burnsAtDawn` flags on Mob | Task 4 |
| Only pigs in initial spawn | Task 4 |
| Spawn zombies/skeletons/creepers at NIGHT | Task 5 |
| Spawn slimes in swamp at EVENING | Task 5 |
| Spawn spiders on cave biome entry | Task 5 |
| Max 8 non-spider hostile mobs cap | Task 5 (`spawnHostileMob`) |
| Max 4 spiders cap | Task 5 (`spawnHostileMob`) |
| Hostile mobs burn (flash red) at dawn | Task 6 |
| Mobs removed after 1.5s burn | Task 6 |
| Spiders do not burn at dawn | Task 5 (`burnsAtDawn: false`) + Task 6 (condition) |
| Pigs always passive | Task 4 (stay in initial spawn, `hostile: false`) |
| Save/load unchanged | Not touched |

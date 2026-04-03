# Day/Night Cycle & Night Enemies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 10-minute day/night cycle with phase-based sky colors, stars/moon at night, a swamp biome, and hostile mobs that spawn at night and burn at dawn.

**Architecture:** A `dayNight` object on `game` tracks elapsed time and current phase (DAY/EVENING/NIGHT/DAWN). Sky color lerps between biome day/night keyframes each frame. Phase transitions trigger mob spawning (EVENING→NIGHT) and burning (DAWN→DAY). All changes are in `game.js`.

**Tech Stack:** Vanilla JS, HTML5 Canvas. No test framework — verification is via browser console + visual check.

---

## File Map

| File | Change |
|------|--------|
| `game.js:7-51` | Add `dayNight` to `game` state object |
| `game.js:1188-1228` | Add `hostile`, `burning`, `burnStart` to `Mob` constructor |
| `game.js:1257-1310` | Add burn timer logic to `Mob.update()` |
| `game.js:1312-1349` | Add red flash to `Mob.draw()` |
| `game.js:2022-2067` | Remove hostile mobs from initial spawn |
| `game.js:2486-2520` | Add swamp to `getBiome()` + `nightSky` to `getBiomeColors()` |
| `game.js:2578-2582` | Add star positions array before `gameLoop` |
| `game.js:2582` | Add `timestamp` param to `gameLoop`, compute `deltaMs` |
| `game.js:2633-2639` | Replace sky fill with lerped color + draw stars/moon |

---

### Task 1: Add `dayNight` state and delta time to the game loop

**Files:**
- Modify: `game.js:7-51` (game state object)
- Modify: `game.js:2582` (gameLoop signature)

- [ ] **Step 1: Add `dayNight` to game state**

In `game.js`, find the `game` object (starts at line 7). Add `dayNight` as the last property before the closing `};`:

```js
    dayNight: {
        phase: 'DAY',          // 'DAY' | 'EVENING' | 'NIGHT' | 'DAWN'
        elapsed: 0,            // ms elapsed in current cycle
        cycleDuration: 600000, // 10 minutes
        lastTimestamp: null    // for delta time
    }
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
Expected: phase prints as `DAY` and elapsed increases. No errors.

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: add dayNight state and delta time to game loop"
```

---

### Task 2: Add swamp biome and night sky colors

**Files:**
- Modify: `game.js:2486-2520` (`getBiome` and `getBiomeColors`)

- [ ] **Step 1: Update `getBiome()` to add swamp**

Replace the `getBiome` function (currently at ~line 2486) with:

```js
function getBiome(worldX) {
    const sandBiomeStart  = 2000;
    const swampBiomeStart = 3000;
    const snowBiomeStart  = 4000;

    if (worldX >= snowBiomeStart)  return 'snow';
    if (worldX >= swampBiomeStart) return 'swamp';
    if (worldX >= sandBiomeStart)  return 'sand';
    return 'default';
}
```

- [ ] **Step 2: Update `getBiomeColors()` to add nightSky and swamp**

Replace the `getBiomeColors` function (currently at ~line 2500) with:

```js
function getBiomeColors(biome) {
    switch (biome) {
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

Walk Steve right until the ground turns dark green (swamp, ~x=3000 world units). The sky should be murky green. No console errors.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add swamp biome and nightSky colors to all biomes"
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

// Pre-generate star positions (seeded so they don't move frame-to-frame)
const STARS = Array.from({ length: 25 }, (_, i) => ({
    x: ((i * 137 + 53) % 97) / 97,   // deterministic spread 0–1
    y: ((i * 79  + 17) % 61) / 61 * 0.7, // top 70% of sky
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
        // Full day
        skyColor = biomeColors.sky;
    } else if (cyclePos < 0.55) {
        // DAY → EVENING: lerp day→sunset first half, sunset→night second half
        const t = (cyclePos - 0.40) / 0.15; // 0→1 across evening
        if (t < 0.5) {
            skyColor = lerpColor(biomeColors.sky, SUNSET_COLOR, t * 2);
        } else {
            skyColor = lerpColor(SUNSET_COLOR, biomeColors.nightSky, (t - 0.5) * 2);
        }
    } else if (cyclePos < 0.75) {
        // Full night
        skyColor = biomeColors.nightSky;
    } else {
        // DAWN: lerp night→sunset first half, sunset→day second half
        const t = (cyclePos - 0.75) / 0.25; // 0→1 across dawn
        if (t < 0.5) {
            skyColor = lerpColor(biomeColors.nightSky, SUNSET_COLOR, t * 2);
        } else {
            skyColor = lerpColor(SUNSET_COLOR, biomeColors.sky, (t - 0.5) * 2);
        }
    }

    ctx.fillStyle = skyColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw stars and moon during evening and night
    const starAlpha = cyclePos >= 0.55 && cyclePos < 0.75 ? 1.0
        : cyclePos >= 0.40 && cyclePos < 0.55 ? (cyclePos - 0.40) / 0.15
        : cyclePos >= 0.75 && cyclePos < 0.875 ? 1.0 - (cyclePos - 0.75) / 0.125
        : 0;

    if (starAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = starAlpha;
        // Stars
        ctx.fillStyle = '#ffffff';
        for (const star of STARS) {
            ctx.beginPath();
            ctx.arc(star.x * canvas.width, star.y * canvas.height * 0.8, star.r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Moon: glowing circle top-right
        const moonX = canvas.width - 60;
        const moonY = 40;
        ctx.shadowColor = '#fffde7';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fffde7';
        ctx.beginPath();
        ctx.arc(moonX, moonY, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
```

- [ ] **Step 3: Verify in browser**

Wait ~40 seconds (or temporarily set `cycleDuration: 60000` for testing), then watch the sky fade to sunset orange then dark blue. Stars and moon should appear. Set it back to `600000` after testing.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: lerp sky color through day/night phases, draw stars and moon"
```

---

### Task 4: Add `hostile` flag to Mob, remove hostile mobs from initial spawn

**Files:**
- Modify: `game.js:1188-1228` (Mob constructor)
- Modify: `game.js:2022-2067` (initial mob spawn in init)

- [ ] **Step 1: Add `hostile` and burning flags to Mob constructor**

In the `Mob` constructor (line ~1228, after `this.lastStateChange = Date.now();`), add:

```js
        // Day/night system
        this.hostile = false;  // true = spawned by night system, burns at dawn
        this.burning = false;
        this.burnStart = 0;
```

- [ ] **Step 2: Remove hostile mob types from initial world spawn**

Find the initial mob spawn block (~line 2022). Change the `mobTypes` array to only passive mobs:

```js
        // Create passive mobs in the world (hostile mobs spawn via day/night system)
        if (game.spriteSheets.mobs) {
            const worldGroundY = canvas.height - 50;
            const mobTypes = ['spider', 'pig'];
            const mobs = [];
```

- [ ] **Step 3: Verify in browser**

Reload the game. Only spiders and pigs should be visible. No zombies, skeletons, creepers, or slimes on startup. Check DevTools console: no errors.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add hostile/burning flags to Mob, remove hostile mobs from initial spawn"
```

---

### Task 5: Spawn night mobs on phase transitions

**Files:**
- Modify: `game.js:2578` (add spawn helper functions before gameLoop)
- Modify: `game.js` (inside gameLoop, after phaseChanged is set — add transition handlers)

- [ ] **Step 1: Add `spawnHostileMob` helper before `gameLoop`**

Add this function just before the `let lastAutoSave` line:

```js
function spawnHostileMob(mobType) {
    if (!game.spriteSheets.mobs) return;
    if (game.mobs.filter(m => m.hostile).length >= 8) return; // cap

    const worldGroundY = canvas.height - 50;
    // Spawn off-screen left or right of camera
    const side = Math.random() < 0.5 ? -1 : 1;
    const spawnX = game.camera.x + (side < 0 ? -80 : canvas.width + 80);
    const facing = side < 0 ? 'right' : 'left';

    const mob = new Mob(game.spriteSheets.mobs, spawnX, 0, mobType, facing);
    mob.hostile = true;

    const mobBaseFrame = mob.rowIndex * game.spriteSheets.mobs.cols;
    const mobFrameBounds = game.spriteSheets.mobs.frameBounds[mobBaseFrame];
    let groundOffset = 0;
    if (mob.mobType === 'slime') groundOffset = 15;
    else if (mob.mobType === 'spider' || mob.mobType === 'pig') groundOffset = 3;

    if (mobFrameBounds) {
        const spriteBottomInFrame = mobFrameBounds.offsetY + mobFrameBounds.height;
        mob.y = worldGroundY - (spriteBottomInFrame * mob.scale) + groundOffset;
    } else {
        mob.y = worldGroundY - mob.height + groundOffset;
    }

    game.mobs.push(mob);
}
```

- [ ] **Step 2: Trigger spawning and burning on phase transitions inside `gameLoop`**

Inside `gameLoop`, after the `const phaseChanged = ...` line (end of Task 1 Step 3), add:

```js
    // Phase transition effects
    if (phaseChanged) {
        if (game.dayNight.phase === 'NIGHT') {
            // Spawn night mobs (2-3 of each hostile type)
            const nightMobTypes = ['zombie', 'skeleton', 'creeper'];
            nightMobTypes.forEach(type => {
                const count = 2 + Math.floor(Math.random() * 2);
                for (let i = 0; i < count; i++) spawnHostileMob(type);
            });
        }

        if (game.dayNight.phase === 'EVENING') {
            // Spawn slimes only if camera is in swamp biome
            if (currentBiome === 'swamp') {
                const count = 2 + Math.floor(Math.random() * 2);
                for (let i = 0; i < count; i++) spawnHostileMob('slime');
            }
        }

        if (game.dayNight.phase === 'DAY') {
            // Mark all hostile mobs as burning
            const now = Date.now();
            game.mobs.forEach(mob => {
                if (mob.hostile && !mob.burning) {
                    mob.burning = true;
                    mob.burnStart = now;
                }
            });
        }
    }
```

Note: `currentBiome` is computed earlier in `gameLoop` (Task 3 Step 2) — it's already available here.

- [ ] **Step 3: Verify spawning in browser (use short cycle)**

Temporarily set `cycleDuration: 60000`. Wait ~33 seconds for NIGHT. Open console:
```js
game.mobs.filter(m => m.hostile).map(m => m.mobType)
```
Expected: array containing `'zombie'`, `'skeleton'`, `'creeper'`. Restore `cycleDuration: 600000`.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: spawn hostile mobs at NIGHT transition, mark burning at DAY transition"
```

---

### Task 6: Burning animation and removal

**Files:**
- Modify: `game.js:1257-1310` (Mob.update)
- Modify: `game.js:1312-1349` (Mob.draw)

- [ ] **Step 1: Remove burned mobs in `Mob.update()`**

At the end of `Mob.update()`, just before the closing `}`, add:

```js
        // Burning: flash and self-remove after 1500ms
        if (this.burning) {
            const elapsed = Date.now() - this.burnStart;
            if (elapsed > 1500) {
                // Signal removal — game loop cleans up
                this.burnedOut = true;
            }
        }
```

- [ ] **Step 2: Add red flash in `Mob.draw()`**

Inside `Mob.draw()`, after `ctx.save();` and before the slime clip block (~line 1326), add:

```js
        // Red flash while burning (alternate every 100ms)
        if (this.burning) {
            const flashOn = Math.floor(Date.now() / 100) % 2 === 0;
            if (flashOn) {
                ctx.restore();
                // Draw a red overlay on this mob's area instead
                ctx.fillStyle = 'rgba(255, 50, 0, 0.85)';
                ctx.fillRect(screenX, screenY, this.width, this.height);
                return;
            }
        }
```

- [ ] **Step 3: Remove burned-out mobs in `gameLoop`**

In `gameLoop`, find the mob update loop (~line 2738):

```js
    game.mobs.forEach(mob => {
        mob.update();
```

Replace the `game.mobs.forEach` block with:

```js
    // Update mobs and remove burned-out ones
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

- [ ] **Step 4: Verify burning in browser (use short cycle)**

Temporarily set `cycleDuration: 60000`. Wait through NIGHT. At dawn, hostile mobs should flash red then disappear. Check console:
```js
game.mobs.filter(m => m.hostile).length
```
Expected: `0` after burn completes. Restore `cycleDuration: 600000`.

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: hostile mobs flash red and disappear at dawn"
```

---

## Spec Coverage Check

| Spec requirement | Covered by |
|---|---|
| 10-minute cycle, 4 phases | Task 1 |
| Sky lerps day→sunset→night | Task 3 |
| Stars and moon at night | Task 3 |
| Swamp biome x=3000–4000 | Task 2 |
| `nightSky` per biome | Task 2 |
| `hostile` flag on Mob | Task 4 |
| Zombies/skeletons/creepers absent on startup | Task 4 |
| Spawn night mobs at NIGHT transition | Task 5 |
| Slimes spawn in swamp at EVENING | Task 5 |
| Max 8 hostile mobs cap | Task 5 (`spawnHostileMob`) |
| Hostile mobs burn (flash red) at dawn | Task 6 |
| Mobs removed after 1.5s burn | Task 6 |
| Spiders and pigs always passive | Task 4 (stay in initial spawn, `hostile: false`) |
| Save/load unchanged | Not touched |

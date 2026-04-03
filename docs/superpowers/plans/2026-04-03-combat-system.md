# Combat System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement mob/player combat with health, attacks, knockback, and death mechanics.

**Architecture:** Combat is split into three layers: (1) mob attributes (health, damage, behavior flags) are initialized when mobs spawn, (2) player attacks on E key check for mobs in range and deal damage, trigger knockback & particles, (3) mobs detect nearby player and attack/chase based on type, dealing damage to player over time. Creepers explode on death; chickens burst with blood on death. Player HP displays as a bar and triggers death/respawn on 0 HP.

**Tech Stack:** Vanilla JS, Canvas 2D. No new dependencies.

---

## File Structure

**Modifications:**
- `game.js` (existing, ~3300 lines):
  - Add `Mob.prototype.health`, `damage`, `attackCooldown`, `lastAttackTime` properties
  - Add `Mob.prototype.takeDamage(amount)` method
  - Add attack behavior logic in `Mob.update()`
  - Add `Character.prototype.hp`, `maxHp`, `lastAttackTime` properties
  - Add `Character.prototype.attack()` method to check range and damage mobs
  - Add `createBloodParticles(x, y, count)` function
  - Add `createExplosion(x, y, radius, damage)` function
  - Add key listener for `E` key to trigger attack
  - Add HP bar rendering in `gameLoop()`
  - Add death/respawn logic
  - Add `mobs-config.json` to store mob attributes (health, damage, chase range, attack cooldown)

---

## Tasks

### Task 1: Add Mob Attributes Config File

**Files:**
- Create: `mobs-config.json`

**Mob attributes configuration with health, damage, and behavior per type.**

- [ ] **Step 1: Create mobs-config.json**

Create `/Users/heffrey/src/minecraf/mobs-config.json`:

```json
{
  "mobAttributes": {
    "zombie": {
      "health": 20,
      "damage": 2,
      "chaseRange": 150,
      "attackCooldown": 1000,
      "attackAnimationSpeed": 0
    },
    "skeleton": {
      "health": 10,
      "damage": 1.5,
      "chaseRange": 200,
      "attackCooldown": 800,
      "attackAnimationSpeed": 0
    },
    "creeper": {
      "health": 15,
      "damage": 0,
      "chaseRange": 180,
      "attackCooldown": 0,
      "explodeDamage": 5,
      "explodeRadius": 200,
      "explodeDelay": 1500
    },
    "spider": {
      "health": 12,
      "damage": 1.5,
      "chaseRange": 160,
      "attackCooldown": 900,
      "attackAnimationSpeed": 0
    },
    "slime": {
      "health": 8,
      "damage": 0.5,
      "chaseRange": 120,
      "attackCooldown": 1200,
      "attackAnimationSpeed": 0
    },
    "pig": {
      "health": 10,
      "damage": 1,
      "chaseRange": 0,
      "attackCooldown": 800,
      "passive": true
    },
    "chicken": {
      "health": 4,
      "damage": 0,
      "chaseRange": 0,
      "passive": true
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add mobs-config.json
git commit -m "feat: add mob attributes configuration"
```

---

### Task 2: Load Mob Config and Add Health Properties to Mob Class

**Files:**
- Modify: `game.js:2034-2050` (in `initGame()`)
- Modify: `game.js:1207-1253` (Mob constructor)

**Load mobs-config.json during init and add health/damage properties to Mob instances.**

- [ ] **Step 1: Load config in initGame()**

Find the line in `initGame()` where other configs are loaded (around line 2040). Add this code after the trees config loads:

```javascript
// Load mob attributes config
const mobsAttrResponse = await fetch('mobs-config.json');
const mobsAttrConfig = await mobsAttrResponse.json();
game.mobAttributes = mobsAttrConfig.mobAttributes || {};
```

(This goes right after the existing config loads, before the game state initialization.)

- [ ] **Step 2: Add health properties to Mob constructor**

In the `Mob` constructor (line 1207), add these properties after `this.rowIndex = mobRowMap[mobType] || 0;` (around line 1225):

```javascript
// Health and combat
const attrs = game.mobAttributes?.[mobType] || {};
this.maxHealth = attrs.health || 10;
this.health = this.maxHealth;
this.damage = attrs.damage || 1;
this.chaseRange = attrs.chaseRange || 0;
this.attackCooldown = attrs.attackCooldown || 500;
this.lastAttackTime = 0;
this.explodeDamage = attrs.explodeDamage || 0;
this.explodeRadius = attrs.explodeRadius || 0;
this.explodeDelay = attrs.explodeDelay || 0;
this.passive = attrs.passive || false;
this.isExploding = false;
this.explodeStartTime = 0;
```

- [ ] **Step 3: Test config loads**

Run the game and check the console:

```bash
python3 -m http.server 8000
```

Navigate to `http://localhost:8000`. Open DevTools console and run:

```javascript
console.log(game.mobAttributes);
```

Expected: Object with zombie, skeleton, creeper, spider, slime, pig, chicken properties showing health/damage values.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: load mob attributes and add health properties to Mob class"
```

---

### Task 3: Implement Mob.takeDamage() and Death Handler

**Files:**
- Modify: `game.js:1207-1435` (Mob class)

**Add takeDamage method and handle mob death (blood particles, explosions).**

- [ ] **Step 1: Add takeDamage method to Mob class**

Add this method after the `update()` method (after line 1342):

```javascript
takeDamage(amount) {
    this.health -= amount;
    
    // Creeper: start explode timer on first hit
    if (this.mobType === 'creeper' && !this.isExploding && this.health > 0) {
        this.isExploding = true;
        this.explodeStartTime = Date.now();
    }
    
    // Death: health <= 0
    if (this.health <= 0) {
        this.die();
    }
}

die() {
    if (this.mobType === 'chicken') {
        // Large blood burst
        createBloodParticles(this.x + this.width / 2, this.y + this.height / 2, 12);
    } else if (this.mobType === 'creeper') {
        // Explode with damage
        createExplosion(this.x + this.width / 2, this.y + this.height / 2, this.explodeRadius, this.explodeDamage);
        createBloodParticles(this.x + this.width / 2, this.y + this.height / 2, 8);
    } else {
        // Regular blood spray
        createBloodParticles(this.x + this.width / 2, this.y + this.height / 2, 5);
    }
    
    this.burnedOut = true; // Mark for removal
}
```

- [ ] **Step 2: Add creeper explosion check in update()**

In `Mob.update()` (around line 1341), add this before the burning check:

```javascript
// Creeper explosion logic
if (this.isExploding) {
    if (Date.now() - this.explodeStartTime > this.explodeDelay) {
        this.die();
    }
}
```

- [ ] **Step 3: Test takeDamage in console**

```bash
# Reload game
# In console:
const mob = game.mobs[0];
console.log("Before:", mob.health, mob.mobType);
mob.takeDamage(5);
console.log("After:", mob.health);
```

Expected: Health decreases. If health <= 0, mob should be marked `burnedOut = true`.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add Mob.takeDamage() and death handler"
```

---

### Task 4: Implement Blood and Explosion Particle Effects

**Files:**
- Modify: `game.js:14-58` (game object particle system)
- Modify: `game.js:2900-3000` (add particle functions before gameLoop)

**Create createBloodParticles and createExplosion functions.**

- [ ] **Step 1: Verify particle system exists**

Check that `game.particles` exists in the game state (line 14). It should already be there. Verify it's initialized as `[]`.

- [ ] **Step 2: Add createBloodParticles function**

Add this function before `gameLoop()` (around line 2877):

```javascript
function createBloodParticles(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const speed = 2 + Math.random() * 2;
        game.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.5, // Upward bias
            life: 0.8 + Math.random() * 0.4, // 0.8-1.2 seconds
            maxLife: 0.8 + Math.random() * 0.4,
            type: 'blood',
            size: 3 + Math.random() * 2
        });
    }
}

function createExplosion(x, y, radius, damage) {
    // Damage nearby mobs
    for (let i = game.mobs.length - 1; i >= 0; i--) {
        const mob = game.mobs[i];
        const dx = mob.x + mob.width / 2 - x;
        const dy = mob.y + mob.height / 2 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < radius && !mob.burnedOut) {
            mob.takeDamage(damage);
            // Knockback
            const knockbackDist = 30;
            const angle = Math.atan2(dy, dx);
            mob.x += Math.cos(angle) * knockbackDist;
        }
    }
    
    // Damage player
    const char = game.characters[0];
    if (char) {
        const dx = char.x + char.width / 2 - x;
        const dy = char.y + char.height / 2 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < radius) {
            char.takeDamage(Math.ceil(damage / 2));
        }
    }
    
    // Explosion particles
    for (let i = 0; i < 15; i++) {
        const angle = (Math.PI * 2 * Math.random());
        const speed = 3 + Math.random() * 2;
        game.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            life: 0.6 + Math.random() * 0.3,
            maxLife: 0.6 + Math.random() * 0.3,
            type: 'spark',
            size: 2 + Math.random() * 2
        });
    }
}
```

- [ ] **Step 3: Update particle rendering in gameLoop()**

Find the section in `gameLoop()` where particles are rendered (around line 3100+). Update it to handle blood and spark types:

Find this code block:
```javascript
// Update and draw particles
for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
```

Replace the particle drawing code within that loop with:

```javascript
// Update and draw particles
for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1; // gravity
    p.life -= deltaMs / 1000;
    
    if (p.life <= 0) {
        game.particles.splice(i, 1);
        continue;
    }
    
    // Draw particle
    const screenX = p.x - game.camera.x;
    const screenY = p.y - game.camera.y;
    
    if (p.type === 'blood') {
        ctx.fillStyle = `rgba(200, 30, 30, ${p.life / p.maxLife})`;
    } else if (p.type === 'spark') {
        ctx.fillStyle = `rgba(255, 150, 50, ${p.life / p.maxLife})`;
    }
    ctx.fillRect(screenX - p.size / 2, screenY - p.size / 2, p.size, p.size);
}
```

- [ ] **Step 4: Test particles in console**

```javascript
createBloodParticles(game.camera.x + 400, game.camera.y + 300, 8);
// Should see blood particles burst on screen
```

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: add blood and explosion particle effects"
```

---

### Task 5: Add Character Health and HP Bar

**Files:**
- Modify: `game.js:600-700` (Character constructor)
- Modify: `game.js:3200-3250` (gameLoop rendering section)

**Add HP property to Character and render HP bar at top of screen.**

- [ ] **Step 1: Add health properties to Character constructor**

Find the Character constructor (around line 600). Add these properties after the character is initialized:

```javascript
// Health
this.maxHp = 20;
this.hp = this.maxHp;
this.lastDamageTaken = 0;
```

- [ ] **Step 2: Add takeDamage method to Character class**

Find the Character class and add this method (around line 900-1000, after the update method):

```javascript
takeDamage(amount) {
    this.hp -= amount;
    this.lastDamageTaken = Date.now();
    
    if (this.hp <= 0) {
        this.die();
    }
}

die() {
    // Respawn at start position
    this.x = 100;
    this.y = 483;
    this.hp = this.maxHp;
    this.velocityY = 0;
    this.velocityX = 0;
}
```

- [ ] **Step 3: Render HP bar in gameLoop()**

In `gameLoop()`, find the section where the UI is drawn (around line 3300, after drawing mobs). Add this code to render the HP bar:

```javascript
// Draw HP bar for Steve
const char = game.characters[0];
if (char) {
    const barWidth = 200;
    const barHeight = 20;
    const barX = 10;
    const barY = 10;
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // Health bar
    const healthPercent = Math.max(0, char.hp / char.maxHp);
    const healthColor = healthPercent > 0.5 ? '#00dd00' : healthPercent > 0.25 ? '#ffff00' : '#ff0000';
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight);
    
    // Border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    
    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HP: ${Math.ceil(char.hp)}/${char.maxHp}`, barX + 5, barY + 16);
}
```

- [ ] **Step 4: Test HP bar**

Reload game. HP bar should display at top-left. In console:

```javascript
game.characters[0].takeDamage(5);
// HP bar should change
```

- [ ] **Step 5: Commit**

```bash
git add game.js
git commit -m "feat: add player health and HP bar UI"
```

---

### Task 6: Implement Player Attack (E Key)

**Files:**
- Modify: `game.js:2500-2700` (keyboard input handlers)
- Modify: `game.js:1000-1200` (Character class)

**Add attack method to Character and handle E key input.**

- [ ] **Step 1: Add attack properties and method to Character**

In the Character constructor, add:

```javascript
this.attackRange = 60; // pixels
this.attackCooldown = 400; // ms
this.lastAttackTime = 0;
this.attackDamage = 5; // damage per hit
```

Then add this method to the Character class (after `takeDamage`):

```javascript
attack() {
    const now = Date.now();
    if (now - this.lastAttackTime < this.attackCooldown) {
        return; // Still on cooldown
    }
    
    this.lastAttackTime = now;
    
    // Check for mobs in range
    const attackX = this.x + this.width / 2;
    const attackY = this.y + this.height / 2;
    
    for (let i = game.mobs.length - 1; i >= 0; i--) {
        const mob = game.mobs[i];
        if (mob.burnedOut) continue;
        
        const mobX = mob.x + mob.width / 2;
        const mobY = mob.y + mob.height / 2;
        const dx = mobX - attackX;
        const dy = mobY - attackY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < this.attackRange) {
            mob.takeDamage(this.attackDamage);
            
            // Knockback
            const knockbackDist = 15;
            const angle = Math.atan2(dy, dx);
            mob.x += Math.cos(angle) * knockbackDist;
            
            // Blood particles
            createBloodParticles(mobX, mobY, 3);
        }
    }
}
```

- [ ] **Step 2: Add E key input handler**

Find the keyboard input handlers (around line 2500). Look for the section with `if (e.key === 'i' || e.key === 'I')` etc. Add this:

```javascript
if (e.key === 'e' || e.key === 'E') {
    game.characters[0].attack();
}
```

- [ ] **Step 3: Test attack**

Reload game. Spawn a mob and press E when near it. Mob should take damage and get knocked back.

```javascript
spawnHostileMob('zombie', {spawnX: 200});
// Move near it and press E
```

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: implement player attack with E key and cooldown"
```

---

### Task 7: Implement Mob Attack/Chase Behavior

**Files:**
- Modify: `game.js:1282-1342` (Mob.update method)

**Add chase and attack logic to mobs based on mob type.**

- [ ] **Step 1: Add chase and attack logic in Mob.update()**

In the `Mob.update()` method, after the burning logic (around line 1341), add this code before the end of the method:

```javascript
// Attack behavior for hostile mobs
if (this.hostile && !this.passive && game.characters.length > 0) {
    const char = game.characters[0];
    const dx = char.x + char.width / 2 - (this.x + this.width / 2);
    const dy = char.y + char.height / 2 - (this.y + this.height / 2);
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    
    // Chase player if in range
    if (distToPlayer < this.chaseRange && this.chaseRange > 0) {
        // Move toward player
        if (Math.abs(dx) > 5) {
            this.facing = dx > 0 ? 'right' : 'left';
            this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
            this.state = 'walking';
        }
    }
    
    // Attack player if adjacent
    if (distToPlayer < 50 && this.attackCooldown > 0) {
        const now = Date.now();
        if (now - this.lastAttackTime > this.attackCooldown) {
            this.lastAttackTime = now;
            char.takeDamage(this.damage);
            createBloodParticles(char.x + char.width / 2, char.y + char.height / 2, 2);
        }
    }
}

// Pig passive aggression: attack back if damaged
if (this.mobType === 'pig' && this.health < this.maxHealth) {
    // Pig was hit, now it attacks
    this.passive = false;
    const char = game.characters[0];
    const dx = char.x + char.width / 2 - (this.x + this.width / 2);
    const dy = char.y + char.height / 2 - (this.y + this.height / 2);
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    
    if (distToPlayer < 80) {
        this.facing = dx > 0 ? 'right' : 'left';
        this.velocityX = this.facing === 'right' ? this.walkSpeed : -this.walkSpeed;
        this.state = 'walking';
    }
    
    if (distToPlayer < 50) {
        const now = Date.now();
        if (now - this.lastAttackTime > this.attackCooldown) {
            this.lastAttackTime = now;
            char.takeDamage(this.damage);
        }
    }
}
```

- [ ] **Step 2: Initialize lastAttackTime in Mob constructor**

In the Mob constructor (around line 1225), verify `this.lastAttackTime = 0;` is already added. If not, add it.

- [ ] **Step 3: Test mob attacks**

```javascript
// Spawn a zombie near player
spawnHostileMob('zombie', {spawnX: 150});
// Let it chase and attack, watch HP bar decrease
```

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: implement mob attack and chase behavior"
```

---

### Task 8: Test Full Combat Flow and Polish

**Files:**
- Verify: `game.js` (all changes integrated)

**End-to-end test of combat system.**

- [ ] **Step 1: Reload game and test basic combat**

```bash
python3 -m http.server 8000
# Navigate to localhost:8000
```

- Spawn a zombie: Press B for debug, spawn zombie with console
- Move character near zombie
- Press E to attack — zombie should take damage, knockback, show blood
- Wait for zombie to attack back — your HP bar should decrease
- Kill zombie — blood burst, removed from game

- [ ] **Step 2: Test creeper explosion**

```javascript
spawnHostileMob('creeper', {spawnX: 200});
// Attack it, wait ~1.5s, it should explode with sparks and damage nearby mobs
```

- [ ] **Step 3: Test chicken death**

```javascript
// Spawn a chicken (not directly, but they spawn at game start)
const chicken = game.chickens[0];
chicken.takeDamage(5); // Chickens have 4 HP
// Should burst with blood
```

- [ ] **Step 4: Test pig passive aggression**

```javascript
spawnHostileMob('pig', {spawnX: 200});
// Attack it once, it should start chasing and attacking back
```

- [ ] **Step 5: Test death and respawn**

```javascript
// Reduce player HP to 0
game.characters[0].takeDamage(100);
// Should respawn at start position with full HP
```

- [ ] **Step 6: Commit final version**

```bash
git add game.js
git commit -m "feat: complete combat system with attacks, knockback, and death"
```

---

## Self-Review

**Spec Coverage:**
- ✅ Different mobs have different attributes (health, damage, chase range)
- ✅ Attack cooldown required (400ms per attack)
- ✅ Mob behavior depends on type (zombies chase, pigs passive until hit, creepers explode)
- ✅ Damage depends on mob type (config-driven)
- ✅ Animated impact/sparks/blood (particle effects)
- ✅ Player can die (hp <= 0 triggers respawn)
- ✅ HP bar implemented (top-left of screen, color changes with health)
- ✅ Hostile mobs attack player when adjacent
- ✅ Creepers explode on death with damage and particles
- ✅ Chickens burst with blood on death
- ✅ Pigs passive but fight back if engaged

**Placeholders:** None. All code is complete with exact implementations.

**Type Consistency:** All mob attributes from config match property names in Mob constructor. Attack methods consistent (takeDamage, lastAttackTime, attackCooldown).

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-03-combat-system.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session sequentially with checkpoints

Which approach would you prefer?

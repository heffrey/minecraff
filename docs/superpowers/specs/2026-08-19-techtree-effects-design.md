# Tech Tree Effects — Design

Making all 17 research nodes and 13 workshop recipes do something the player can
feel. Written against `game.js` @ 2931a09, `techtree.js` (1280 lines).

---

## Part 1 — Audit: what the economy actually is today

### 1.1 The faucets

There are exactly **three** writes to `game.inventory` in the whole codebase:

| Site | Code | Rate |
|---|---|---|
| `game.js:3402` | `game.inventory.wood += 1` on felling a tree | see below |
| `game.js:3480` | `game.inventory[material] = (...) + 1` per dug block | 1 per 300 ms |
| `game.js:~5225` (right-click) | `game.inventory[tile.materialType]++` refunding a placed tile | refund only |

**Chopping.** `Tree.maxHealth = 3` (`game.js:2519`), `char.mining.hitInterval = 500`
(`game.js:471`). `startMining()` sets `lastHitTime = now`, so the first hit lands at
+500 ms → **1.5 s per tree, 1 wood**. `spawnTreesInArea()` puts 2–4 trees per 200 px
chunk with a 50 px minimum spacing, so the next tree is ~65 px away; at
`speed = 2` px/frame (120 px/s) that is 0.55 s of walking. Sustained rate:

> **1 wood per ~2.1 s = 0.48 wood/s = ~29 wood/minute.**

Regrowth is 10–30 s and is refused while any character is within 100 px, so you
cannot farm one spot — you walk a strip. Wood is the slowest faucet in the game
by a factor of 7.

**Digging.** `char.digging.hitInterval = 300` (`game.js:487`).

> **1 material per 300 ms = 3.33/s = 200 per minute.**

**Which material you get** is `getGroundMaterial(biome, depth)` (`game.js:3955`),
which is `list[Math.min(depth, list.length - 1)]` over `GROUND_MATERIALS`
(`game.js:3915`):

| biome | world X | depth 0 | depth 1 | depth >= 2 |
|---|---|---|---|---|
| `cave` | x <= -1000 | stone | **iron** | **silver** |
| `default` | -1000 < x < 2000 | dirt | dirt | stone |
| `sand` | 2000 <= x < 3000 | sand | sand | stone |
| `swamp` | 3000 <= x < 4000 | clay | dirt | stone |
| `snow` | x >= 4000 | snow | dirt | stone |

### 1.2 Finding: **gold does not exist**

`gold` appears in no row of `GROUND_MATERIALS`. It is in the inventory object
(`game.js:194`), the sprite frame table (`MATERIAL_FRAMES.gold = 6`), the HUD sort
order (`drawInventory`, value 9 — the most valuable thing in the game), and the
placement palette (key `7`). Nothing can ever put one in your pocket.

Consequences, both hard blocks:

- **`goldsmithing`** (tier 4, `cost: { gold: 8, clay: 10 }`) is **unresearchable**.
- **`gold_lamp`** (`cost: { gold: 4, iron: 2 }`) is **uncraftable**.

That is 1 of 17 nodes and 1 of 13 recipes permanently dead. Severity: high, and it
is a data bug, not a balance opinion.

### 1.3 Finding: sideways digging is a stand-still infinite conveyor

In `updatePlayerAction` (`game.js:3492-3497`) a left/right dig advances
`char.digging.targetTileX` by ±32 each tick **while the character never moves**,
and the abort test (`game.js:3472`) compares the character's tile to
`originTileX` — the tile they are standing on. So the tunnel extends arbitrarily
far from one held keypress, at a fixed depth, forever.

Because every material sits in a fixed depth band, that means one keypress is an
unlimited tap on any material:

| Stand in | Dig down N | then hold Act+Left | yields |
|---|---|---|---|
| default | 1 | depth 0 | dirt, 200/min |
| default | 3 | depth 2 | stone, 200/min |
| cave | 2 | depth 1 | **iron, 200/min** |
| cave | 3 | depth 2 | **silver, 200/min** |
| swamp | 1 | depth 0 | clay, 200/min |
| sand | 1 | depth 0 | sand, 200/min |
| snow | 1 | depth 0 | snow, 200/min |

(`beginDig` sets a sideways `targetDepth = max(0, currentDepth - 1)`, where
`currentDepth` is the count of contiguous dug layers in your own column — that is
the "dig down N" column above.)

**Every material except wood and gold is effectively free and infinite.**

### 1.4 Finding: research is the only sink, and it is strictly negative

Block placement (`game.js:5251`) spends 1 material — and right-click destruction
(`game.js:~5225`) refunds exactly 1. Placement is a **loan, not a sink**. So the
complete list of sinks in the game is: the tech tree, and the workshop. Both pay
out nothing (`hasTech` has zero call sites outside `techtree.js`; `inventory.items`
is written and never read; `game.tech.crafted` is written and only ever rendered
back into the same panel that wrote it).

Researching therefore has **strictly negative expected value**: it deletes
materials you could have placed as blocks and returns a green rectangle. The
developer's read is correct.

### 1.5 Cost of the entire tree, in seconds

Summing all 16 paid nodes:

| material | tree total | recipes total | grand total | gather time |
|---|---|---|---|---|
| wood | 86 | 22 | **108** | 108 / 0.48 = **225 s** |
| stone | 88 | 12 | 100 | 30 s |
| iron | 58 | 19 | 77 | 23 s |
| clay | 48 | 6 | 54 | 16 s |
| sand | 32 | 8 | 40 | 12 s |
| snow | 20 | 8 | 28 | 8 s |
| silver | 14 | 6 | 20 | 6 s |
| dirt | 12 | 6 | 18 | 5 s |
| gold | 8 | 4 | 12 | **infinite** |

Non-gold digging total: **100 s of held keypress.** Wood: **225 s.** Travel
between biomes at 120 px/s (spawn ~ x 100; cave at -1000, sand 2000, swamp 3000,
snow 4000) adds roughly 2–3 minutes of walking for a sensible route.

> **The whole tech tree plus every recipe is ~7–9 minutes of directed play for
> one player**, and 90 % of that is chopping wood and walking. For a 5-tier DAG
> that is a first-act-and-done curve.

### 1.6 Cost anomalies relative to tree position

- **`foraging` (tier 1) costs 4 sand.** Sand only exists at x >= 2000 — a 33 s
  round trip from spawn. It is the *only* travel gate in tier 1 and it is on the
  cheapest-sounding node in the tree. Worst pacing inversion in the file.
- **`deepshafts` (tier 3) costs only wood + stone**, both available at spawn — a
  tier-3 node with a weaker gate than a tier-1 node.
- **`minecarts` costs 30 wood** = 63 s of chopping, the single largest real cost
  in the tree, on a node whose theme (rails) is about *not* walking.
- **`dirt` is a dead material**: 18 units demanded across the whole tree and every
  recipe, against the most abundant block at spawn.
- **`earthworks` costs 12 dirt = 3.6 s of digging.** It is free.

### 1.7 What is working well

- The DAG is genuinely acyclic with every `requires` pointing at a strictly lower
  tier, and the column layout is derived from the data, so adding nodes is safe.
- `spend()` is atomic — affordability is confirmed for every material before a
  single counter moves. No half-eaten costs.
- Every rejected action writes a `say()` message. Silent no-ops are the classic
  failure of panels like this and this one avoids it.
- `tech()` and `inventory()` are defensive enough to survive a `loadGame()` that
  hands back an array instead of a Set.
- The tier *shape* (4/4/4/4 with a single root) is right. Nothing below needs the
  graph redrawn.

---

## Part 2 — Design principles for the fix

1. **The payoff rule.** Every node must repay the gather-time of its own cost, in
   the activity it improves, in **under two minutes**. If it cannot, it is not a
   node — it is a tax. Every number in Part 4 is checked against this.
2. **Pacing comes from gates, not from price inflation.** The faucet is 200
   materials/minute; tripling a cost just means holding a key longer, which is not
   gameplay. The real levers are *travel* (which biome), *depth* (how far down),
   and *darkness* (whether you can survive being down there).
3. **Derive, don't store — except where the HUD must show it.** The co-op
   contract already establishes derived getters (`char.controls`,
   `char.hemisphere`) precisely so a runtime change is visible on the next frame.
   Tech effects follow the same rule: read `hasTech()` at the call site. The one
   exception is `maxHp`, which the HP bar reads directly; that one gets applied.
4. **Unlocks are shared, effects apply to every character.** `game.tech.unlocked`
   is one Set spending from one inventory; making it per-player would need a
   second Set, a "who is researching" concept the panel has no room for, and a
   second inventory. Shared. Every per-character stat is therefore applied by
   looping `game.characters` — never `game.characters[0]`.
5. **No new subsystem unless it unblocks two or more nodes.** Darkness unblocks
   `torches` + `lanterns` + gives the cave its purpose: build it. Cold unblocks
   `frostgear` alone: don't build it (§5.2).

---

## Part 3 — The effect table (all 17 nodes)

Column *"reads"* names the exact call site the number is read from.

### Tier 0

| node | effect id | what it does |
|---|---|---|
| `survival` | `baseline` | Nothing. It is free, auto-unlocked, and honest about it. Leave the blurb. |

### Tier 1

**`woodcraft` — `wood_yield`**
- Trees take **2 hits instead of 3**, and yield **2 wood instead of 1**.
- Reads: `Tree.hit()` (`game.js:2605`) — decrement `this.health` by
  `hasTech('woodcraft') ? 2 : 1`. Do **not** change `this.maxHealth = 3` in the
  constructor: that is set at spawn, so already-standing trees would keep the old
  value and the unlock would appear not to work for 30 seconds.
- Reads: `game.js:3402`, `game.inventory.wood += woodPerTree()`.
- Felt: wood rate **0.48/s -> ~1.3/s** (1.0 s chop + 0.55 s walk for 2 wood).

**`stonework` — `stone_edge`**
- `attackDamage` **5 -> 8** for both characters; miss chance **0.25 -> 0.18**.
- Reads: `Character.attack()` — `nearestTarget.entity.takeDamage(this.attackDamage)`
  (`game.js:1343`) and `const missChance = 0.25` immediately above it.
- Felt: a zombie (20 hp) drops from 4 hits to 3; a skeleton (10 hp) from 3 to 2.

**`earthworks` — `soft_dig_speed`**
- Digging **dirt, sand, snow and clay** goes **300 ms -> 200 ms** (x0.67).
- Reads: the interval test at `game.js:3476`. This requires hoisting the two lines
  that compute `biome` / `material` (`game.js:3477-3478`) **above** the interval
  test, since the interval now depends on which material the next block is.
- Felt: surface tunneling visibly speeds up within three blocks.

**`foraging` — `surface_yield`**
- A dig at **depth 0** yields **2** of the material instead of 1.
- Reads: `game.js:3480`, `game.inventory[material] += digYield(material, targetDepth)`.
- Felt: doubles the snow, clay and sand faucets, which are all depth-0 bands.

### Tier 2

**`toolsmithing` — `tool_speed`**
- All digging x0.73 (**300 -> 220 ms**, stacking multiplicatively with earthworks:
  soft materials land at 300 x 0.67 x 0.73 = **147 ms**). All chopping
  **500 -> 350 ms** (x0.70).
- Reads: `char.digging.hitInterval` at `game.js:3476` and `char.mining.hitInterval`
  at `game.js:3360` — both through the helpers in §6.1, never by mutating the field.

**`kiln` — `clay_from_spoil`**
- Every dug block, in **any** biome at **any** depth, has a **20 % chance to yield
  1 extra clay** on top of its normal material.
- Reads: `game.js:3480`, in `digYield`.
- Felt: 0.67 clay/s while doing anything at all. This is deliberately the node
  that *removes* the swamp travel gate for tier 3 `pottery` — you pay the swamp
  trip once for `kiln` itself and never again.

**`torches` — `light_source`**
- Character light radius **90 -> 190 px**; global darkness cap **0.85 -> 0.75**.
  See §5.1.
- Also unlocks the `torch_bundle` recipe, which places *world* torches.

**`smelting` — `ore_yield`**
- Digging **iron or silver** yields **3** instead of 1.
- Reads: `digYield`, same site.
- Felt: cave tunneling goes 200 -> 600 ore/minute. This is what makes the tier-3/4
  metal costs in Part 4 land in seconds rather than minutes, and it is why it sits
  in front of `ironworking`.

### Tier 3

**`ironworking` — `iron_body`**
- `maxHp` **20 -> 30**, `attackDamage` **8 -> 12**, `regenRate` **0.5 -> 1.0** HP/s,
  for both characters.
- Reads: `Character` fields at `game.js:447-458`, applied by
  `applyTechToCharacters()` (§6.2) — this is the *stored* exception, because
  `drawPlayerHpBar` (`game.js:4778`) reads `char.maxHp` directly.
- Felt: the HP bar visibly lengthens the instant you press ENTER.

**`deepshafts` — `deeper_dig_limit`**
- `MAX_DIG_DEPTH` **50 -> 90**; `jumpPower` **-8 -> -10** for both characters
  (apex 64 px = 2 tiles -> 100 px = 3.1 tiles, so you can jump out of a shaft you
  could previously only fall into).
- Reads: `MAX_DIG_DEPTH` (`game.js:11`), consumed at `game.js:3245`, `3264`, `4027`,
  `4091` and `minimap.js:231`. **Implementation:** change `const MAX_DIG_DEPTH = 50`
  to `let MAX_DIG_DEPTH = 50` and assign 90 in `applyTechToCharacters()`. Do **not**
  convert it to a function: `minimap.js:231` guards with
  `typeof MAX_DIG_DEPTH === 'number'` and would silently fall back to its own
  `DEFAULT_MAX_DIG_DEPTH = 50`, drawing a minimap that disagrees with the world.
  A top-level `let` in a classic script is still in lexical scope for every script
  loaded after it, so `minimap.js` needs no change at all.
- **Required companion fix** — see §7 risk 1.

**`pottery` — `double_craft`**
- Every workshop craft produces **2 charges instead of 1**. Clay digs get **+1**
  (stacks with `foraging` and `kiln`).
- Reads: `attemptCraft` in `techtree.js:448` — `t.crafted[id] += craftYield()`.
- Felt: this is the node that makes the WORKSHOP tab worth opening twice, and it
  is the one that keeps the 200-materials/minute faucet meaningful after every
  node is researched (§5.3).

**`lanterns` — `lasting_light`**
- Character light radius **190 -> 300 px**, and the radius no longer shrinks with
  depth. See §5.1.

### Tier 4

**`minecarts` — `rail_travel` (re-themed: "you move like you're on rails")**
- `speed` **2 -> 2.8** px/frame (120 -> 168 px/s) for both characters.
- Reads: `Character.speed` (`game.js:427`), consumed at `game.js:1020`, `1039` and
  the look-ahead at `1143`. Applied by `applyTechToCharacters()`.
- **Why re-themed rather than built:** actual rails need a track entity, a
  rideable vehicle, a placement mode and a physics exemption. That is a
  subsystem, and principle 5 rules it out for one node. A flat +40 % speed
  attacks the *same* real cost (walking 5000 px between biomes: 42 s -> 30 s each
  way) at a fraction of the risk. Mob `walkSpeed` is 0.8–1.2 px/frame, so the
  player already outruns everything; 2.8 does not break chase balance.

**`goldsmithing` — `gold_ward`**
- **First, gold must exist.** Add a rare-drop rule, not a new `GROUND_MATERIALS`
  row (appending a 4th entry to `cave` would make silver a one-block-per-column
  material and gold infinite, exactly inverting the intended rarity):

  > In the `cave` biome at **depth >= 8**, a dug block has a **12 % chance to yield
  > 1 gold** in addition to its normal material.

  At 3.33 blocks/s that is 0.4 gold/s -> the 10-gold cost is **25 s of deep cave
  tunneling**. Gold becomes the only genuinely scarce dug material, gated behind
  depth + the darkest biome, which is what a tier-4 luxury should be. Reads:
  `digYield` at `game.js:3480`.
- **Effect:** hostile night spawns are suppressed within **640 px** of any placed
  gold tile. Reads: `spawnHostileMob` (`game.js:4317`) — after `spawnX` is
  computed, scan `game.placedTiles` for a `materialType === 'gold'` tile within
  640 px and `return` if one is found. Gold tiles also get a soft glow drawn at
  night (a light hole in the darkness pass, radius 160).
- Felt: build a gold post at your base and the night stops coming to it. It is
  also the only effect in the design that gives **block placement** a purpose
  beyond decoration, which converts placement from a loan into a real sink.

**`silverwork` — `silver_sight`**
- The minimap shows every **live hostile mob** as a red dot, and the iron/silver
  depth bands of the cave as coloured strata.
- Reads: `minimap.js` draw pass, gated on
  `typeof hasTech === 'function' && hasTech('silverwork')`. Skip
  `mob.isDying || mob.burnedOut` (risk 4).
- Deliberately the weakest tier-4 in raw power and correspondingly the cheapest;
  it is an *information* upgrade, and at night it is felt immediately.

**`frostgear` — `sure_footing` (re-themed; cold penalty rejected)**
- `maxHp` **30 -> 40**, `regenDelay` **3000 -> 1200 ms**, `regenRate` **1.0 -> 2.0**
  HP/s, for both characters.
- Reads: `game.js:447`, `456-457`, applied by `applyTechToCharacters()`.
- **Why re-themed:** see §5.2. The node keeps its name, its snow cost and its
  "lined boots keep you alive in the worst place on the map" blurb; only the
  mechanic changes, and it needs no new fields — `maxHp`, `regenDelay` and
  `regenRate` all already exist on `Character` and are already read every frame in
  `Character.update()` (`game.js:614-617`).

---

## Part 4 — Costs, before -> after

Only the node's *position* is being corrected, plus modest inflation on tier 3/4
metals to match `smelting`'s x3 ore yield. **Bold = changed.**

### Tier 1 — no biome travel; all four affordable from spawn

| node | before | after | why |
|---|---|---|---|
| `woodcraft` | wood 8 | **wood 6** | first node should land in ~2 min including learning the panel; 6 wood = 13 s |
| `stonework` | stone 8, wood 2 | **stone 10**, wood 2 | stone is depth-2 at spawn, 3 s of digging |
| `earthworks` | dirt 12 | **dirt 15** | still trivial by design; dirt has no other demand |
| `foraging` | wood 4, sand 4 | **wood 6, dirt 10** | **removes the 33 s sand round-trip from tier 1** — the single most important cost change in this table |

### Tier 2 — the travel gates start here

| node | before | after | why |
|---|---|---|---|
| `toolsmithing` | wood 12, stone 16 | **wood 14, stone 20** | ~35 s of gathering for the biggest passive in the game |
| `kiln` | clay 12, stone 8 | **clay 10, stone 15** | clay = swamp (x >= 3000): this is the tier-2 travel gate, and the node's own effect then makes clay farmable anywhere |
| `torches` | wood 10, sand 6 | **wood 12, sand 8** | sand = x >= 2000; sand-for-glass is the right node to carry that trip |
| `smelting` | stone 20, clay 6 | **stone 25, iron 4** | forces one cave trip before tier 3 — the cave is the darkest place on the map and `torches` gates it comfortably |

### Tier 3

| node | before | after | why |
|---|---|---|---|
| `ironworking` | iron 10, stone 12 | **iron 18, stone 20** | with `smelting` x3, 18 iron = 6 blocks = 2 s; the cost is the trip, not the time |
| `deepshafts` | wood 20, stone 24 | **wood 24, stone 30, iron 6** | a tier-3 node should not be payable entirely from spawn materials |
| `pottery` | clay 20, sand 10 | **clay 24, sand 12** | `kiln`'s spoil-clay makes this reachable without a second swamp trip |
| `lanterns` | iron 6, sand 12 | **iron 12, sand 16** | |

### Tier 4

| node | before | after | why |
|---|---|---|---|
| `minecarts` | iron 24, wood 30 | **iron 30, wood 24** | wood is still the slowest faucet even at x2.8; shift weight onto the metal |
| `goldsmithing` | gold 8, clay 10 | **gold 10, clay 16** | gold now exists at 0.4/s in the deep cave -> 25 s |
| `silverwork` | silver 10, iron 8 | **silver 20, iron 12** | silver is infinite at cave depth 6+; the cost is nominal by design |
| `frostgear` | snow 20, iron 10, silver 4 | **snow 24, iron 16, silver 8** | the x >= 4000 walk is the real cost and it is a good capstone gate |

### Recipe costs

| recipe | before | after | why |
|---|---|---|---|
| `iron_ingot` | iron 3, stone 2 | **iron 8, stone 6** | it is now a permanent +5 maxHp, capped at 3 uses |
| `iron_pick` | iron 6, wood 3 | **iron 10, wood 4** | 100 blocks of x0.6 digging is the strongest repeatable in the game |
| `gold_lamp` | gold 4, iron 2 | **gold 6, iron 4** | |
| all others | — | **unchanged** | |

### Pacing targets and the check against them

Assumes two players both gathering, so anything parallelisable roughly halves.

| milestone | target | derivation |
|---|---|---|
| first tier-1 node | **~2 min** | 6 wood = 13 s of chopping + finding and reading the panel |
| all of tier 1 | **~6 min** | 12 wood + 10 stone + 25 dirt ~ 40 s of gathering, plus play |
| first tier-2 node | **~8 min** | `toolsmithing` needs 14 wood + 20 stone, all at spawn |
| all of tier 2 | **~15 min** | gated by the sand trip (33 s r/t), the swamp trip (50 s r/t) and the first cave descent |
| tier 3 | **15–25 min** | gated by needing torches before deep cave work is tolerable |
| tier 4 | **25–45 min** | gated by the snow walk (66 s r/t) and 25 s of depth-8 cave tunneling for gold |

**Payoff-rule check** (principle 1) — cost expressed as gather-seconds, payback
expressed in seconds of the improved activity:

| node | cost (s) | payback | verdict |
|---|---|---|---|
| `woodcraft` | 13 | 6 more trees = **8 s** | pass |
| `earthworks` | 4.5 | 45 soft blocks = **9 s** | pass |
| `foraging` | 16 | 16 surface blocks = **5 s** | pass |
| `stonework` | 8 | first zombie | pass |
| `smelting` | 15 | 13 ore blocks = **4 s** | pass |
| `kiln` | 8 + swamp trip | 50 s of any digging | pass |
| `toolsmithing` | 35 | ~**2 min** of mixed play | pass (at the limit, by design — it is the biggest passive) |
| `minecarts` | 30 | ~15 min of walking per session -> saves ~4 min | pass |
| `deepshafts` | 40 | mobility, not materials | pass (accepted non-refunding) |
| `ironworking` / `frostgear` / `torches` / `lanterns` / `goldsmithing` / `silverwork` / `pottery` | — | survivability, light, safety, information | pass (accepted non-refunding) |

---

## Part 5 — The two new problems, and the one I am not building

### 5.1 Darkness — **build it**

This is not scope creep; it is a hole. Right now night changes the sky colour and
spawns mobs, and that is all. You can stand at depth 50 — 1600 px underground, in
a biome whose own sky colour is `#1a1a1a` — and see perfectly. The cave has no
downside, which is precisely why iron at cave depth 1 is free.

**Implementation — one composited pass, ~25 lines, one place.** In `drawWorld`
(`game.js:4495`), after particles/characters and **before** the interaction hints:

```
nightAlpha  = 0 by day, ramping to 0.72 across EVENING, 0.72 at NIGHT, ramping
              back down across DAWN   (reuse the existing cyclePos bands)
depthAlpha  = clamp((camY + viewH * 0.6 - worldGroundY) / (12 * 32), 0, 0.85)
alpha       = min(max(nightAlpha, depthAlpha), DARK_CAP)
```

Fill `rgba(0, 0, 10, alpha)` over `(0, 0, viewW, viewH)`, then
`globalCompositeOperation = 'destination-out'` and punch a radial-gradient hole at
each character's screen position with radius `lightRadius()`, plus one at each
placed torch and each placed gold tile. Restore the composite op in a `finally`.

Because `drawWorld` already takes the camera as arguments (contract §3), the PIP
inset gets darkness for free with no extra work.

| state | light radius | `DARK_CAP` |
|---|---|---|
| base | 90 px (~3 tiles) | 0.85 |
| `torches` | 190 px | 0.75 |
| `lanterns` | 300 px, no depth falloff | 0.75 |
| world torch tile (`torch_bundle`) | 160 px | — |
| gold ward tile (`gold_lamp` / placed gold) | 160 px | — |

**Two hard rules so the pre-tech game is not miserable:**
1. `alpha` never reaches 1.0 — capped at 0.85. Terrain silhouettes stay readable
   at every point in the game.
2. Darkness draws **under** the HUD, the world hints, the minimap and the tech
   panel. A player who is lost in the dark can always open the panel and read it.

At 90 px the surface at night is a dusk, not a blackout; underground it is
genuinely dark, which is the point, and the fix (`torches`, tier 2) arrives about
8 minutes in.

### 5.2 Cold — **do not build it. Re-theme `frostgear`.**

An honest cost estimate for a cold system: a damage-over-time tick in the snow
biome, a warmth meter in the HUD (without one, a kid just dies for no visible
reason), a per-character warmth value that has to persist and to interact with
respawn, and a tuning pass so the snow biome is not a wall to everyone below tier
4 — which it would be, since `frostgear` is the last node in the tree and the snow
biome is where you go to *pay* for it. That is a chicken-and-egg loop on top of
three subsystems, for one node.

`frostgear` keeps its name, its blurb and its snow cost — the 66 s round trip to
x >= 4000 is a perfectly good tier-4 gate on its own — and gets the
survivability capstone in Part 3 instead. Stated plainly: **the promise in the
node's name is honoured by keeping snow as its cost and survival as its effect;
the cold-damage mechanic is cut on cost/benefit.**

### 5.3 The workshop — **keep it, make items real**

**Decision: keep the workshop as a separate tab and turn `game.tech.crafted[id]`
into a charge count.** Not folded into the tech nodes.

Two reasons, in order:

1. **A tree of permanent passives has no repeatable sink.** Once all 17 nodes are
   researched, materials are worthless again and the game is back where it
   started — a 200/minute faucet into a bucket with no hole. Consumables are the
   only structure that keeps gathering meaningful for the rest of the session.
   This is the strongest economic argument in the document.
2. The tab, the 13 rows, the selection cursor, the affordability colouring and a
   `crafted` counter that already persists all work today. Deleting them throws
   away working UI to solve a problem they are not causing.

**Mechanics:**
- `game.tech.crafted[id]` **is** the charge count. It already increments
  (`techtree.js:448`) and already persists (`saveGame`).
- **Stop pushing strings into `game.inventory.items`** (`techtree.js:450`). Nothing
  reads them, `drawInventory` only walks the nine named counters, and `saveGame`
  serialises the array into localStorage forever — it grows without bound. Keep
  the `items: []` key in the inventory shape so old saves still load.
- **Use:** one key, **`C`**, consumes one charge of the currently selected
  workshop recipe, and works with the panel closed. `C` is in neither
  hemisphere (left owns A/D/W/S/F/E, right owns the arrows and `/` `.`), so it can
  never double as a movement key — the same reasoning that put the hemisphere swap
  on Backspace. Feedback via `FloatingText`.
- **Who does it affect:** consumables affect **both** characters. It is a shared
  stash bought with shared materials; a "which player drank it" concept would need
  a target picker the panel has no room for.
- **No recipe may yield a material.** Any recipe returning as much as its own cost
  in convertible materials is an infinite loop. All three placeables below cost
  more than the tiles they produce refund.

| recipe | cost | type | effect |
|---|---|---|---|
| `plank_bundle` | wood 4 | placeable | **Scaffold** — places 3 wood tiles as a column under your feet. Climb out of your own shaft. (4 in, 3 refundable out.) |
| `cut_stone` | stone 4 | placeable | **Bulwark** — places a 3-tall stone wall in your facing direction. Blocks mobs. |
| `dirt_ramp` | dirt 6 | placeable | **Ramp** — places 3 dirt tiles as a rising staircase ahead. The only real dirt sink in the game. |
| `berry_basket` | wood 2, sand 2 | consumable | heals **both** characters 8 HP instantly |
| `stone_pick` | wood 3, stone 6 | durability | dig interval **x0.8** for **100 blocks** |
| `iron_pick` | iron 10, wood 4 | durability | dig interval **x0.6** for **100 blocks** |
| `iron_ingot` | iron 8, stone 6 | permanent | **Iron Plating** — +5 maxHp to both characters, **capped at 3 uses** (+15 total) |
| `torch_bundle` | wood 4, sand 2 | placeable | places a **world torch** at your feet: permanent 160 px light |
| `snow_boots` | snow 8, silver 2 | consumable | **+40 % move speed for 45 s**, both characters (stacks with `minecarts`) |
| `clay_pot` | clay 6 | placeable | **Waypoint** — drops a marker at your position, shown on the minimap *(Phase 2)* |
| `rail_kit` | iron 8, wood 6 | consumable | teleports **both** characters to the most recent waypoint. Refuses with a message if no waypoint exists. *(Phase 2)* |
| `silver_mirror` | silver 4, sand 4 | consumable | reveals the full minimap — all mobs, all tunnels — for 60 s *(Phase 2)* |
| `gold_lamp` | gold 6, iron 4 | placeable | places a **gold ward** tile: 260 px light + the 640 px night-spawn suppression from `goldsmithing` *(Phase 2)* |

**Ship in two passes.** Phase 1 is the nine rows that need no new arrays: the three
placeables, the heal, the two picks, the plating, the torch, the boots. Phase 2 is
the four that need `game.waypoints` and minimap changes. Phase 1 alone makes the
workshop a real sink.

**Pick durability.** One shared counter, `game.tech.toolBlocks`, decremented once
per dug block in the same branch that credits the inventory (`game.js:3480`). At
zero, the next charge of the best available pick auto-engages (iron beats stone;
they do not stack). 100 blocks is about 30 s of continuous digging per charge,
against a stone pick costing ~8 s of gathering — net positive, repeatable, and it
eats stone and iron for the rest of the session.

---

## Part 6 — Implementation surface

### 6.1 New helpers in `game.js` (all read `hasTech` defensively)

Every one guards with `typeof hasTech === 'function' && hasTech(id)` so the game
still runs if `techtree.js` fails to load (contract section 7).

```
woodPerTree()                   -> 1 | 2
treeHitDamage()                 -> 1 | 2          (used in Tree.hit)
digIntervalFor(char, material)  -> ms             (replaces char.digging.hitInterval read)
miningIntervalFor(char)         -> ms             (replaces char.mining.hitInterval read)
digYield(material, depth, biome)-> {mat: n, ...}  (foraging / smelting / kiln / gold)
lightRadius()                   -> px
craftYield()                    -> 1 | 2
```

`digIntervalFor` and `miningIntervalFor` **return** a value; they must not write
`char.digging.hitInterval`. The field stays as the documented per-character base
(contract section 1) and remains what a save or a future per-player upgrade would
set.

### 6.2 `applyTechToCharacters()` — the one place stored state is correct

Sets the fields the HUD and physics read directly, for **every** entry in
`game.characters`: `maxHp`, `attackDamage`, `speed`, `jumpPower`, `regenRate`,
`regenDelay`, and the module-scope `MAX_DIG_DEPTH`.

Called from exactly three places:
1. the end of `initGame()`, after characters exist;
2. inside `loadGame()`, **immediately after the `gameState.tech` block and before
   the `gameState.players` block** — see risk 7;
3. `onTechUnlocked(id)`.

### 6.3 One new contract function — `onTechUnlocked(id)`

Defined by **`game.js`**, called from `techtree.js`'s `attemptResearch` right after
`tech().unlocked.add(id)`:

```js
if (typeof onTechUnlocked === 'function') onTechUnlocked(id);
```

This keeps the contract's ownership rules intact — `techtree.js` still owns the
panel, `game.js` still owns every game field — and gives `game.js` the one hook it
needs. **Add it to `docs/coop-contract.md` section 5's function table** as a
`game.js`-defined function called from `techtree.js`, alongside the four that go
the other way.

### 6.4 Save / load

```
version: 3                     (keep accepting 2)
game.tech.toolBlocks           int
game.tech.plating              int, 0..3
game.torches                   [{x, y}]  world coords
game.waypoints                 [{x, y}]  world coords   (Phase 2)
```

Each restored under its own independent guard, exactly as the co-op keys are —
a v2 save has none of them and must still load.

**Timed buffs (`snow_boots`, `silver_mirror`) are deliberately not persisted.**
Reloading should not hand you a free 45 s of speed, and a `Date.now()` deadline
written before a reload is meaningless afterwards — the same reasoning that
already keeps `dayNight` out of the save.

`game.tech.unlocked` and `crafted` need no save changes; both already round-trip.

---

## Part 7 — Risks and gotchas

**1. `MAX_DIG_DEPTH` is a rendering budget, not just a rule.** `CLAUDE.md` is
explicit about this. `drawGroundWithHoles` runs a
`for (depth = 0; depth < MAX_DIG_DEPTH; depth++)` loop **twice** — the fill at
`game.js:4027` and the grid lines at `game.js:4091` — across every visible column.
At ~25 visible columns, 50 to 90 takes it from 1250 to 2250 `fillRect` calls per
loop per frame, on a canvas-2D game loop.

**Required companion fix: break out of both loops once `screenY` exceeds `viewH`.**
They already draw layers far below the viewport. With the early-out, 90 layers is
*cheaper* than 50 is today. Do not ship `deepshafts` without it.

**2. The dig-abort gotcha (documented, and it has bitten before).** `CLAUDE.md`
records that comparing the digger's tile to `targetTileX` instead of `originTileX`
made tunneling silently impossible. If the 1.3 conveyor is fixed by walking the
digger along the tunnel, `originTileX` **must** advance in lockstep with
`targetTileX` in the same tick, or the abort at `game.js:3472` fires on the very
next frame — reintroducing exactly that bug. `rail_kit`'s teleport and
`snow_boots`' speed both move characters and must clear `char.digging.isDigging`
rather than relying on the abort.

**3. `null`, never a sign test.** Any new dig-side guard (the gold drop, the pick
counter, the material-dependent interval) must not introduce a `>= 0` test on a
tile X. **All the ore is at negative X** — the cave is entirely west of -1000.
This is the exact bug `CLAUDE.md` documents.

**4. `isDying` corpses live in `game.mobs` for 2.5 s.** `silverwork`'s minimap dots
must skip `mob.isDying || mob.burnedOut` — a red dot for a corpse is a lie, and
`CLAUDE.md` lists three places that already got this wrong. `goldsmithing`'s ward
suppresses *spawns* only and never iterates mobs, so it is safe by construction.

**5. Do not touch `Character.takeDamage`.** `createExplosion` (around
`game.js:4438-4450`) is the site of the documented `RangeError` recursion crash.
`ironworking` and `frostgear` change `maxHp`, `regenRate` and `regenDelay` — all
read in `Character.update()`, none in the damage path. Keep it that way.

**6. Co-op: every stat is per-character.** `maxHp`, `attackDamage`, `speed`,
`jumpPower`, `regenRate`, `regenDelay`, `mining.hitInterval` and
`digging.hitInterval` all live on the `Character`, and `game.characters` is
`[steve, alex]`. `applyTechToCharacters()` loops all of them. Note that
`celebrate()` in `techtree.js:463` only floats text over `chars[0]` — do **not**
copy that pattern for effects. Both players paid for it.

**7. Load order vs the HP clamp.** `loadGame` does
`char.hp = Math.max(0, Math.min(saved.hp, char.maxHp))` (`game.js:4285`). If
`applyTechToCharacters()` has not raised `maxHp` to 30 or 40 yet, a save with 28 HP
loads clamped to 20. Call it inside `loadGame()` between the `gameState.tech` block
and the `gameState.players` block.

**8. The attack/chop decision is duplicated.** `startPlayerAction` (keydown,
`game.js:3294`) and `updatePlayerAction` (every frame, `game.js:3334`) both decide
attack-vs-chop-vs-dig. **Every inventory and yield change goes in
`updatePlayerAction` only** — it is the one that actually credits materials. A
second write in the keydown path would double-credit on the first tick.

**9. Pre-existing, and this design aggravates it: `saveGame()` fires on every dug
block** (`game.js:3502`) — a full `JSON.stringify` of the inventory, every placed
tile, every ground hole and every dug material, 3.3 times a second while digging.
Adding `torches` and `waypoints` to the payload makes it worse, and `deepshafts`
makes `groundHoles` bigger. `AUTO_SAVE_INTERVAL = 30000` already exists; recommend
the dig tick set a dirty flag instead of calling `saveGame()` directly. Not
strictly in scope, but it should be fixed in the same pass.

**10. Stop the `inventory.items` leak.** `techtree.js:450` pushes a string per
craft into an array nothing reads, which `saveGame` then serialises forever. Drop
the push; keep the key.

**11. `earthworks` needs two lines moved.** The material-dependent dig interval
means `biome` and `material` (`game.js:3477-3478`) must be computed **above** the
`now - lastHitTime >= hitInterval` test at `game.js:3476`. It is the only effect in
this design that reorders existing code rather than adding at a call site.


---

## Part 8 — Implementation notes (added during the build)

Where the shipped code departs from the design above, and why.

**`silverwork` was re-scoped.** The design gave it "minimap shows every live
hostile mob as a red dot". `minimap.js` already drew exactly that for everyone,
and already skipped `isDying || burnedOut` correctly — so the node's payoff was
something the player had for free. Gating it behind tech would have been a
*takeaway*, making the pre-tech game worse to justify a node, which violates the
whole point of this pass. Shipped instead as **minimap span x2.5** (see threats
coming much earlier), plus torch and waypoint markers on the strip. `Silver
Mirror` stacks on top, widening to x5 for 60 s. Both only ever widen; nothing is
hidden that was previously visible.

**All 13 recipes shipped, not the 9 of "Phase 1".** `game.waypoints` turned out
to be a two-line addition, so `clay_pot` (drop waypoint), `rail_kit` (ride both
players back) and `silver_mirror` (temporary reveal) went in with the rest
rather than waiting for a second pass.

**Two bugs found while wiring, both pre-existing:**

1. **`Tile` stores `materialName`, but the right-click refund read
   `materialType`** — a field that does not exist on `Tile`. Destroying a placed
   tile had therefore always refunded nothing, which quietly made block placement
   a real sink rather than the "loan" §1.4 assumed. Fixed. The gold ward needed
   the same field to match at all.
2. **`drawDarkness` cannot punch its light holes onto the main canvas.**
   `destination-out` erases whatever is already drawn — the world — so the first
   working version rendered a hole straight through the game to the web page
   behind it. The darkness now composites on its own scratch canvas and is
   stamped down with a single `drawImage`.

**Verified in-browser**, not just by inspection: dirt dig 300 -> 146.7 ms with
earthworks + toolsmithing (design predicted 147), chop 500 -> 350, both
characters upgraded identically, `MAX_DIG_DEPTH` 50 -> 90, gold dropping at 13%
in deep cave and 0% everywhere else, kiln spoil clay at 19.6%, a full
research transaction through the panel (6 wood spent, effect live on the next
call), craft -> C -> effect, and a save/load round trip preserving 40 HP (which
would have clamped to 20 had `applyTechToCharacters()` run after the players
block, per risk 7). The render early-out was measured: 90 layers costs 0.2
ms/frame, the same as 50 did.

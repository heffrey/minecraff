// techtree.js — Tech tree + crafting workshop overlay.
//
// Loaded after game.js (see docs/coop-contract.md §5). Everything here is
// file-local except the four contract globals at the bottom:
//   drawTechPanel(ctx), techPanelKey(key), techPanelClick(mx, my), hasTech(id)
//
// The whole file is wrapped in an IIFE so the node tables, layout maths and
// feedback state cannot collide with game.js's globals — this project has no
// module system, so one flat scope is shared by every script.

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Data — the tech tree
    // ---------------------------------------------------------------------
    //
    // A real DAG: every `requires` id points at a node in a *strictly lower*
    // tier, which is what keeps the graph acyclic and also what makes the
    // column layout readable (every edge points rightwards, never backwards).
    //
    // Costs assume the real gather rate: 1 wood per felled tree, 1 material
    // per dug block. Tier 1 is a few minutes of play; tier 4 is a project.
    // `effect` is a placeholder flag today — unlocking sets it, nothing reads
    // it yet — but the dependency graph, the costs and the spend are real.

    const TECH_NODES = [
        {
            id: 'survival', name: 'Survival', tier: 0, requires: [], cost: {},
            blurb: 'You woke up in a blocky world with empty pockets. Everything starts here.',
            effect: 'baseline'
        },

        // Tier 1 — turning raw stuff into usable stuff.
        {
            id: 'woodcraft', name: 'Woodcraft', tier: 1, requires: ['survival'],
            cost: { wood: 8 },
            blurb: 'Split logs into planks so they stop being logs.',
            effect: 'plank_recipes'
        },
        {
            id: 'stonework', name: 'Stonework', tier: 1, requires: ['survival'],
            cost: { stone: 8, wood: 2 },
            blurb: 'Knap stone into shapes that hold an edge.',
            effect: 'stone_recipes'
        },
        {
            id: 'earthworks', name: 'Earthworks', tier: 1, requires: ['survival'],
            cost: { dirt: 12 },
            blurb: 'Move dirt on purpose instead of by accident.',
            effect: 'faster_dirt_digging'
        },
        {
            id: 'foraging', name: 'Foraging', tier: 1, requires: ['survival'],
            cost: { wood: 4, sand: 4 },
            blurb: 'Spot what the surface gives away for free.',
            effect: 'surface_yield_bonus'
        },

        // Tier 2 — heat, tools and light.
        {
            id: 'toolsmithing', name: 'Tool Smithing', tier: 2,
            requires: ['woodcraft', 'stonework'], cost: { wood: 12, stone: 16 },
            blurb: 'Haft a stone head to a wooden handle. Digging gets serious.',
            effect: 'tool_recipes'
        },
        {
            id: 'kiln', name: 'Clay Kiln', tier: 2, requires: ['earthworks'],
            cost: { clay: 12, stone: 8 },
            blurb: 'A stone box hot enough to turn mud into pottery.',
            effect: 'fired_clay'
        },
        {
            id: 'torches', name: 'Torches', tier: 2,
            requires: ['woodcraft', 'foraging'], cost: { wood: 10, sand: 6 },
            blurb: 'Carry your own daylight down the shaft.',
            effect: 'light_source'
        },
        {
            id: 'smelting', name: 'Smelting', tier: 2, requires: ['stonework'],
            cost: { stone: 20, clay: 6 },
            blurb: 'Cook ore until the metal runs out of the rock.',
            effect: 'ore_to_ingot'
        },

        // Tier 3 — iron, depth and craftsmanship.
        {
            id: 'ironworking', name: 'Iron Working', tier: 3,
            requires: ['smelting'], cost: { iron: 10, stone: 12 },
            blurb: 'Beat hot iron flat. Everything after this is made of it.',
            effect: 'iron_recipes'
        },
        {
            id: 'deepshafts', name: 'Deep Shafts', tier: 3,
            requires: ['toolsmithing', 'torches'], cost: { wood: 20, stone: 24 },
            blurb: 'Timbered tunnels that do not fall in on you.',
            effect: 'deeper_dig_limit'
        },
        {
            id: 'pottery', name: 'Pottery', tier: 3, requires: ['kiln'],
            cost: { clay: 20, sand: 10 },
            blurb: 'Pots, jars and tiles. Storage that does not leak.',
            effect: 'storage_recipes'
        },
        {
            id: 'lanterns', name: 'Lanterns', tier: 3,
            requires: ['torches', 'smelting'], cost: { iron: 6, sand: 12 },
            blurb: 'Glass and metal beat a stick that burns out.',
            effect: 'lasting_light'
        },

        // Tier 4 — the luxuries you dig a very long way for.
        {
            id: 'minecarts', name: 'Mine Carts', tier: 4,
            requires: ['ironworking', 'deepshafts'], cost: { iron: 24, wood: 30 },
            blurb: 'Rails down the shaft so the ore rides home instead of you.',
            effect: 'rail_travel'
        },
        {
            id: 'goldsmithing', name: 'Gold Smithing', tier: 4,
            requires: ['ironworking', 'pottery'], cost: { gold: 8, clay: 10 },
            blurb: 'Soft, useless, gorgeous. Worth every block you dug.',
            effect: 'gold_recipes'
        },
        {
            id: 'silverwork', name: 'Silver Work', tier: 4,
            requires: ['ironworking', 'lanterns'], cost: { silver: 10, iron: 8 },
            blurb: 'Bright metal for mirrors, wire and show-off gear.',
            effect: 'silver_recipes'
        },
        {
            id: 'frostgear', name: 'Frost Gear', tier: 4,
            requires: ['deepshafts', 'lanterns'], cost: { snow: 20, iron: 10, silver: 4 },
            blurb: 'Lined boots and lamps that keep burning in the snow biome.',
            effect: 'cold_resistance'
        }
    ];

    // ---------------------------------------------------------------------
    // Data — the workshop
    // ---------------------------------------------------------------------
    //
    // A recipe is craftable when its `requiresTech` node is unlocked AND the
    // shared inventory covers the cost. `yields` is a placeholder item name:
    // crafting pushes it into `game.inventory.items` and bumps
    // `game.tech.crafted[id]`. drawInventory() in game.js only ever walks the
    // nine named material counters and never touches `items`, so adding
    // strings there cannot break the HUD, and saveGame() JSON-serialises the
    // whole inventory object without special-casing, so strings persist.

    const WORKSHOP_RECIPES = [
        {
            id: 'plank_bundle', name: 'Plank Bundle', requiresTech: 'woodcraft',
            cost: { wood: 4 }, yields: 'Plank Bundle',
            blurb: 'Four logs, one tidy stack of planks.'
        },
        {
            id: 'cut_stone', name: 'Cut Stone', requiresTech: 'stonework',
            cost: { stone: 4 }, yields: 'Cut Stone',
            blurb: 'Squared-off blocks that stack without wobbling.'
        },
        {
            id: 'dirt_ramp', name: 'Dirt Ramp', requiresTech: 'earthworks',
            cost: { dirt: 6 }, yields: 'Dirt Ramp',
            blurb: 'A packed slope for walking out of your own hole.'
        },
        {
            id: 'berry_basket', name: 'Berry Basket', requiresTech: 'foraging',
            cost: { wood: 2, sand: 2 }, yields: 'Berry Basket',
            blurb: 'Woven basket. Holds more than your hands do.'
        },
        {
            id: 'stone_pick', name: 'Stone Pickaxe', requiresTech: 'toolsmithing',
            cost: { wood: 3, stone: 6 }, yields: 'Stone Pickaxe',
            blurb: 'The first tool that beats punching rock.'
        },
        {
            id: 'clay_pot', name: 'Clay Pot', requiresTech: 'kiln',
            cost: { clay: 6 }, yields: 'Clay Pot',
            blurb: 'Fired until it rings when you tap it.'
        },
        {
            id: 'torch_bundle', name: 'Torch Bundle', requiresTech: 'torches',
            cost: { wood: 4, sand: 2 }, yields: 'Torch Bundle',
            blurb: 'Six torches. Take them all; the dark is long.'
        },
        {
            id: 'iron_ingot', name: 'Iron Ingot', requiresTech: 'smelting',
            cost: { iron: 3, stone: 2 }, yields: 'Iron Ingot',
            blurb: 'Raw ore cooked down into one honest bar.'
        },
        {
            id: 'iron_pick', name: 'Iron Pickaxe', requiresTech: 'ironworking',
            cost: { iron: 6, wood: 3 }, yields: 'Iron Pickaxe',
            blurb: 'Bites stone like the stone owes it money.'
        },
        {
            id: 'rail_kit', name: 'Rail Kit', requiresTech: 'minecarts',
            cost: { iron: 8, wood: 6 }, yields: 'Rail Kit',
            blurb: 'Sixteen lengths of track and the spikes to lay them.'
        },
        {
            id: 'gold_lamp', name: 'Gold Lamp', requiresTech: 'goldsmithing',
            cost: { gold: 4, iron: 2 }, yields: 'Gold Lamp',
            blurb: 'Entirely unnecessary. Absolutely worth it.'
        },
        {
            id: 'silver_mirror', name: 'Silver Mirror', requiresTech: 'silverwork',
            cost: { silver: 4, sand: 4 }, yields: 'Silver Mirror',
            blurb: 'Polished silver on glass. See who is behind you.'
        },
        {
            id: 'snow_boots', name: 'Snow Boots', requiresTech: 'frostgear',
            cost: { snow: 8, silver: 2 }, yields: 'Snow Boots',
            blurb: 'Lined, buckled and immune to the snow biome.'
        }
    ];

    const NODES_BY_ID = {};
    TECH_NODES.forEach(function (n) { NODES_BY_ID[n.id] = n; });

    const RECIPES_BY_ID = {};
    WORKSHOP_RECIPES.forEach(function (r) { RECIPES_BY_ID[r.id] = r; });

    // Tier columns, ascending. Derived from the data so adding a node never
    // needs a layout edit.
    const TIERS = TECH_NODES
        .map(function (n) { return n.tier; })
        .filter(function (t, i, a) { return a.indexOf(t) === i; })
        .sort(function (a, b) { return a - b; });

    const NODES_BY_TIER = TIERS.map(function (tier) {
        return TECH_NODES.filter(function (n) { return n.tier === tier; });
    });

    // ---------------------------------------------------------------------
    // Style — matched to drawInventory() / drawMaterialPalette()
    // ---------------------------------------------------------------------

    const COL = {
        backdrop: 'rgba(0, 0, 0, 0.55)',
        panelBg: 'rgba(0, 0, 0, 0.88)',
        panelBorder: '#ffffff',
        tabActiveBg: 'rgba(255, 213, 74, 0.85)',
        tabIdleBg: 'rgba(100, 100, 100, 0.5)',
        tabActiveText: '#000000',
        tabIdleText: '#dddddd',
        accent: '#FFD54A',          // affordable + available
        unlockedFill: 'rgba(58, 125, 58, 0.95)',
        unlockedBorder: '#8CE08C',
        poorFill: 'rgba(40, 40, 40, 0.85)',   // unaffordable
        poorBorder: '#8a6a2a',
        poorText: '#b8904a',
        blockedFill: 'rgba(22, 22, 22, 0.85)',
        blockedBorder: '#444444',
        blockedText: '#6a6a6a',
        availFill: 'rgba(60, 60, 60, 0.9)',
        selection: '#ffffff',
        edge: 'rgba(140, 224, 140, 0.75)',
        edgeDim: 'rgba(120, 120, 120, 0.35)',
        text: '#ffffff',
        dimText: '#aaaaaa',
        good: '#8CE08C',
        bad: '#FF7777'
    };

    const PAD = 12;
    const TAB_H = 24;
    const DETAIL_H = 78;
    const CONTROLS_H = 48;   // persistent footer, drawn on both tabs
    const MIN_NODE_H = 22;
    const RECIPE_ROW_MAX_H = 26;
    const RECIPE_ROW_MIN_H = 18;
    const SWAP_BTN_W = 92;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    // Per-tab selection. game.tech.selected mirrors whichever tab is active,
    // as the contract describes, but keeping them apart means switching tabs
    // does not scramble the other tab's cursor.
    let techSelected = 'survival';
    let recipeSelected = WORKSHOP_RECIPES[0].id;

    // Transient feedback ("Need 12 more stone"). A silent no-op is the worst
    // possible outcome for someone poking at the panel, so every rejected
    // action writes one of these.
    let message = '';
    let messageTone = 'bad';
    let messageAt = 0;
    const MESSAGE_MS = 3000;

    function say(text, tone) {
        message = text;
        messageTone = tone || 'bad';
        messageAt = Date.now();
    }

    // game.js owns game.tech, but this module must work even if it loads
    // against an older/mid-refactor game.js — and hasTech() has to answer
    // before any panel has been opened.
    function tech() {
        if (typeof game === 'undefined' || !game) return null;
        if (!game.tech) {
            game.tech = {
                unlocked: new Set(['survival']),
                open: false,
                tab: 'tech',
                selected: null,
                crafted: {}
            };
        }
        const t = game.tech;
        // loadGame() restores `unlocked` from a JSON array; be forgiving.
        if (!(t.unlocked instanceof Set)) {
            t.unlocked = new Set(Array.isArray(t.unlocked) ? t.unlocked : ['survival']);
        }
        if (!t.unlocked.has('survival')) t.unlocked.add('survival');
        if (!t.crafted || typeof t.crafted !== 'object') t.crafted = {};
        if (t.tab !== 'tech' && t.tab !== 'workshop') t.tab = 'tech';
        return t;
    }

    function inventory() {
        if (typeof game === 'undefined' || !game || !game.inventory) return null;
        if (!Array.isArray(game.inventory.items)) game.inventory.items = [];
        return game.inventory;
    }

    // ---------------------------------------------------------------------
    // Rules
    // ---------------------------------------------------------------------

    function isUnlocked(id) {
        const t = tech();
        return !!(t && t.unlocked.has(id));
    }

    function prereqsMet(node) {
        return node.requires.every(isUnlocked);
    }

    function missingPrereqs(node) {
        return node.requires.filter(function (id) { return !isUnlocked(id); });
    }

    // Returns [] when affordable, else [{material, short}] for every shortfall.
    function shortfalls(cost) {
        const inv = inventory();
        const out = [];
        Object.keys(cost || {}).forEach(function (mat) {
            const have = (inv && typeof inv[mat] === 'number') ? inv[mat] : 0;
            if (have < cost[mat]) out.push({ material: mat, short: cost[mat] - have });
        });
        return out;
    }

    function canAfford(cost) {
        return shortfalls(cost).length === 0;
    }

    // Atomic spend: affordability for EVERY material is confirmed above before
    // a single counter moves, so a failed craft can never half-eat the players'
    // materials.
    function spend(cost) {
        const inv = inventory();
        if (!inv) return false;
        if (!canAfford(cost)) return false;
        Object.keys(cost || {}).forEach(function (mat) {
            inv[mat] = (inv[mat] || 0) - cost[mat];
        });
        return true;
    }

    function costText(cost) {
        const keys = Object.keys(cost || {});
        if (keys.length === 0) return 'free';
        return keys.map(function (m) { return cost[m] + ' ' + m; }).join(', ');
    }

    function shortfallText(list) {
        return 'Need ' + list.map(function (s) {
            return s.short + ' more ' + s.material;
        }).join(' and ');
    }

    function nodeState(node) {
        if (isUnlocked(node.id)) return 'unlocked';
        if (!prereqsMet(node)) return 'blocked';
        if (!canAfford(node.cost)) return 'poor';
        return 'ready';
    }

    function recipeState(recipe) {
        if (!isUnlocked(recipe.requiresTech)) return 'blocked';
        if (!canAfford(recipe.cost)) return 'poor';
        return 'ready';
    }

    function attemptResearch(id) {
        const node = NODES_BY_ID[id];
        if (!node) return false;
        if (isUnlocked(id)) {
            say(node.name + ' is already researched', 'good');
            return false;
        }
        const missing = missingPrereqs(node);
        if (missing.length > 0) {
            say('Requires ' + missing.map(function (m) {
                return NODES_BY_ID[m] ? NODES_BY_ID[m].name : m;
            }).join(' + '), 'bad');
            return false;
        }
        const lacking = shortfalls(node.cost);
        if (lacking.length > 0) {
            say(shortfallText(lacking), 'bad');
            return false;
        }
        if (!spend(node.cost)) {
            say('Could not pay for ' + node.name, 'bad');
            return false;
        }
        tech().unlocked.add(id);
        say('Researched ' + node.name + '!', 'good');
        celebrate(node.name + '!');
        return true;
    }

    function attemptCraft(id) {
        const recipe = RECIPES_BY_ID[id];
        if (!recipe) return false;
        if (!isUnlocked(recipe.requiresTech)) {
            const req = NODES_BY_ID[recipe.requiresTech];
            say('Requires ' + (req ? req.name : recipe.requiresTech), 'bad');
            return false;
        }
        const lacking = shortfalls(recipe.cost);
        if (lacking.length > 0) {
            say(shortfallText(lacking), 'bad');
            return false;
        }
        if (!spend(recipe.cost)) {
            say('Could not pay for ' + recipe.name, 'bad');
            return false;
        }
        const t = tech();
        t.crafted[id] = (t.crafted[id] || 0) + 1;
        const inv = inventory();
        if (inv) inv.items.push(recipe.yields);
        say('Crafted ' + recipe.name + '!', 'good');
        celebrate(recipe.name + '!');
        return true;
    }

    // Optional flourish — game.js may not have loaded, and in the test harness
    // neither FloatingText nor the characters exist.
    function celebrate(text) {
        if (typeof FloatingText !== 'function') return;
        if (typeof game === 'undefined' || !game || !Array.isArray(game.floatingTexts)) return;
        const chars = Array.isArray(game.characters) ? game.characters : [];
        const who = chars[0];
        if (!who) return;
        game.floatingTexts.push(new FloatingText(
            who.x + (who.width || 0) / 2,
            who.y - 10,
            text
        ));
    }

    // ---------------------------------------------------------------------
    // Layout — computed from the data, never hand-placed
    // ---------------------------------------------------------------------

    function canvasSize() {
        // Read the live canvas; the panel is a fraction of it, never a constant.
        if (typeof canvas !== 'undefined' && canvas && canvas.width) {
            return { w: canvas.width, h: canvas.height };
        }
        return { w: 800, h: 600 };
    }

    function layout() {
        const size = canvasSize();
        const pw = Math.round(size.w * 0.8);
        const ph = Math.round(size.h * 0.8);
        const px = Math.round((size.w - pw) / 2);
        const py = Math.round((size.h - ph) / 2);
        const panel = { x: px, y: py, w: pw, h: ph };

        const tabW = Math.min(120, Math.floor((pw - PAD * 3) / 2));
        const tabs = [
            { id: 'tech', label: 'TECH', x: px + PAD, y: py + PAD / 2, w: tabW, h: TAB_H },
            { id: 'workshop', label: 'WORKSHOP', x: px + PAD + tabW + 6, y: py + PAD / 2, w: tabW, h: TAB_H }
        ];

        const bodyY = py + PAD / 2 + TAB_H + 6;
        // Bottom-up: the CONTROLS footer is pinned to the panel floor, the
        // detail strip sits on top of it, and the body gets whatever is left.
        const controls = {
            x: px + PAD,
            y: py + ph - PAD - CONTROLS_H,
            w: pw - PAD * 2,
            h: CONTROLS_H
        };
        const swapBtn = {
            x: controls.x + controls.w - (SWAP_BTN_W + 8),
            y: controls.y + 6,
            w: SWAP_BTN_W,
            h: 26
        };
        const detail = {
            x: px + PAD,
            y: controls.y - 4 - DETAIL_H,
            w: pw - PAD * 2,
            h: DETAIL_H
        };
        const body = {
            x: px + PAD,
            y: bodyY,
            w: pw - PAD * 2,
            h: Math.max(0, detail.y - 6 - bodyY)
        };

        return {
            panel: panel, tabs: tabs, body: body, detail: detail,
            controls: controls, swapBtn: swapBtn
        };
    }

    // Node boxes for the TECH tab: one column per tier, rows centred in the
    // column. Everything is derived from NODES_BY_TIER, so the layout survives
    // adding nodes — it shrinks the boxes, and once they hit MIN_NODE_H it
    // scrolls the column instead of spilling out of the panel.
    function techLayout() {
        const L = layout();
        const body = L.body;
        const cols = NODES_BY_TIER.length;
        const colW = body.w / cols;
        const nodeW = Math.max(56, Math.floor(colW - 12));

        const maxRows = NODES_BY_TIER.reduce(function (m, list) {
            return Math.max(m, list.length);
        }, 1);

        const rowGap = 8;
        let nodeH = Math.floor((body.h - rowGap * (maxRows - 1)) / maxRows);
        nodeH = Math.min(nodeH, 46);

        let scrollRows = maxRows;   // how many rows actually fit
        if (nodeH < MIN_NODE_H) {
            nodeH = MIN_NODE_H;
            scrollRows = Math.max(1, Math.floor((body.h + rowGap) / (nodeH + rowGap)));
        }

        // Scroll only kicks in when a column is taller than the body. Keep the
        // selected node on screen so arrowing down never walks off the panel.
        let firstRow = 0;
        if (scrollRows < maxRows) {
            let selRow = 0;
            NODES_BY_TIER.forEach(function (list) {
                const i = list.findIndex(function (n) { return n.id === techSelected; });
                if (i >= 0) selRow = i;
            });
            firstRow = Math.min(
                Math.max(0, maxRows - scrollRows),
                Math.max(0, selRow - Math.floor(scrollRows / 2))
            );
        }

        const boxes = [];
        const byId = {};
        NODES_BY_TIER.forEach(function (list, tierIdx) {
            const colX = body.x + tierIdx * colW;
            const x = Math.round(colX + (colW - nodeW) / 2);
            // Centre this tier's rows vertically within the visible band.
            const shown = Math.min(list.length, scrollRows);
            const stackH = shown * nodeH + Math.max(0, shown - 1) * rowGap;
            const top = Math.round(body.y + Math.max(0, (body.h - stackH) / 2));
            list.forEach(function (node, rowIdx) {
                const visIdx = rowIdx - firstRow;
                if (visIdx < 0 || visIdx >= scrollRows) return; // scrolled away
                const box = {
                    id: node.id,
                    node: node,
                    tierIdx: tierIdx,
                    rowIdx: rowIdx,
                    x: x,
                    y: Math.round(top + visIdx * (nodeH + rowGap)),
                    w: nodeW,
                    h: nodeH
                };
                boxes.push(box);
                byId[node.id] = box;
            });
        });

        return { L: L, boxes: boxes, byId: byId, nodeW: nodeW, nodeH: nodeH };
    }

    function workshopLayout() {
        const L = layout();
        const body = L.body;
        // Shrink the rows to fit the whole list before falling back to
        // scrolling — a kid scanning for a recipe should see them all.
        const rowH = Math.max(RECIPE_ROW_MIN_H, Math.min(RECIPE_ROW_MAX_H,
            Math.floor(body.h / Math.max(1, WORKSHOP_RECIPES.length))));
        const visible = Math.max(1, Math.floor(body.h / rowH));
        const selIdx = Math.max(0, WORKSHOP_RECIPES.findIndex(function (r) {
            return r.id === recipeSelected;
        }));
        let first = 0;
        if (WORKSHOP_RECIPES.length > visible) {
            first = Math.min(
                WORKSHOP_RECIPES.length - visible,
                Math.max(0, selIdx - Math.floor(visible / 2))
            );
        }
        const rows = [];
        for (let i = first; i < Math.min(WORKSHOP_RECIPES.length, first + visible); i++) {
            rows.push({
                recipe: WORKSHOP_RECIPES[i],
                index: i,
                x: body.x,
                y: body.y + (i - first) * rowH,
                w: body.w,
                h: rowH - 3
            });
        }
        return { L: L, rows: rows, visible: visible, first: first };
    }

    // ---------------------------------------------------------------------
    // Drawing helpers
    // ---------------------------------------------------------------------

    function fitText(ctx, text, maxWidth) {
        if (!text) return '';
        let measure;
        if (typeof ctx.measureText === 'function') {
            measure = function (s) {
                const m = ctx.measureText(s);
                return (m && typeof m.width === 'number') ? m.width : s.length * 6;
            };
        } else {
            measure = function (s) { return s.length * 6; };
        }
        if (measure(text) <= maxWidth) return text;
        let out = text;
        while (out.length > 1 && measure(out + '…') > maxWidth) {
            out = out.slice(0, -1);
        }
        return out + '…';
    }

    function box(ctx, x, y, w, h, fill, stroke, lineWidth) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth || 1;
            ctx.strokeRect(x, y, w, h);
        }
    }

    // ---------------------------------------------------------------------
    // CONTROLS footer
    // ---------------------------------------------------------------------
    //
    // Every label below is derived from HEMISPHERES + char.hemisphere at draw
    // time. The players can swap keyboard sides at runtime, so a hardcoded
    // "W A S D" would start lying the moment they do — and a label that lies
    // is worse than no label. When the parity symbols are missing entirely the
    // strip says so rather than guessing.

    function keyLabel(k) {
        if (k === undefined || k === null) return '?';
        switch (k) {
            case 'ArrowUp': return '↑';
            case 'ArrowDown': return '↓';
            case 'ArrowLeft': return '←';
            case 'ArrowRight': return '→';
            case ' ': return 'SPACE';
            default:
                return String(k).length === 1 ? String(k).toUpperCase() : String(k);
        }
    }

    function firstKey(arr) {
        return (Array.isArray(arr) && arr.length > 0) ? arr[0] : null;
    }

    const ARROW_GLYPHS = ['↑', '↓', '←', '→'];

    // "W A S D" / "ARROWS" — read in up, left, down, right order so the
    // letters come out in the shape of the keys on the board.
    function movementLabel(binding) {
        if (!binding) return 'unset';
        const keys = [firstKey(binding.jump), firstKey(binding.left),
                      firstKey(binding.down), firstKey(binding.right)];
        // Fall back to the binding's own UI label rather than printing 'unset'
        // when a side declares a label but not every direction.
        if (keys.some(function (k) { return k === null; })) {
            return binding.label ? String(binding.label) : 'unset';
        }
        const labels = keys.map(keyLabel);
        const allArrows = labels.every(function (l) { return ARROW_GLYPHS.indexOf(l) >= 0; });
        return allArrows ? 'ARROWS' : labels.join(' ');
    }

    function actionLabel(binding) {
        if (!binding || !Array.isArray(binding.action) || binding.action.length === 0) return 'unset';
        return binding.action.map(keyLabel).join(' ');
    }

    // Returns one row per character, left hemisphere first, or null when the
    // assignment cannot be stated truthfully.
    function controlsInfo() {
        if (typeof game === 'undefined' || !game) return null;
        const chars = Array.isArray(game.characters) ? game.characters : null;
        if (!chars || chars.length === 0) return null;
        const table = (typeof HEMISPHERES !== 'undefined' && HEMISPHERES) ? HEMISPHERES : null;
        if (!table) return null;

        const assign = game.controlAssignment || null;
        const rows = [];
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (!ch) continue;
            // char.hemisphere is a getter that derives on every read (and may
            // be null); hemisphereFor() is the same lookup as a function; the
            // assignment map is the last resort. All three are read fresh here
            // so a swap shows up on the very next frame.
            let side = ch.hemisphere;
            if (side !== 'left' && side !== 'right' && typeof hemisphereFor === 'function') {
                side = hemisphereFor(ch);
            }
            if (side !== 'left' && side !== 'right' && assign) {
                const idx = (typeof ch.playerIndex === 'number') ? ch.playerIndex : i;
                if (assign.left === idx) side = 'left';
                else if (assign.right === idx) side = 'right';
            }
            if (side !== 'left' && side !== 'right') return null;
            const binding = table[side];
            if (!binding) return null;
            rows.push({
                name: String(ch.name || ('PLAYER ' + (i + 1))).toUpperCase(),
                side: side,
                // `marker` and `label` are UI fields the contract puts on the
                // binding; fall back to deriving them when they are absent.
                marker: binding.marker || (side === 'left' ? '◀' : '▶'),
                color: (typeof ch.color === 'string' && ch.color) ? ch.color : COL.text,
                movement: movementLabel(binding),
                action: actionLabel(binding)
            });
        }
        if (rows.length === 0) return null;
        // Left half of the keyboard listed first, so the strip reads like the
        // keyboard looks.
        rows.sort(function (a, b) {
            return (a.side === 'left' ? 0 : 1) - (b.side === 'left' ? 0 : 1);
        });
        return rows;
    }

    function drawControls(ctx, L) {
        const c = L.controls;
        const btn = L.swapBtn;
        box(ctx, c.x, c.y, c.w, c.h, 'rgba(255,255,255,0.05)', 'rgba(200,200,200,0.4)', 1);

        const rows = controlsInfo();
        const canSwap = typeof swapControlHemispheres === 'function';

        // SWAP button. Drawn even when unavailable, greyed — clicking it then
        // explains why instead of doing nothing.
        box(ctx, btn.x, btn.y, btn.w, btn.h,
            canSwap ? 'rgba(255, 213, 74, 0.85)' : 'rgba(60,60,60,0.6)',
            canSwap ? COL.accent : '#555555', canSwap ? 2 : 1);
        ctx.textAlign = 'center';
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = canSwap ? '#000000' : '#777777';
        ctx.fillText('SWAP SIDES', btn.x + btn.w / 2, btn.y + btn.h / 2 + 4);
        ctx.font = '9px monospace';
        ctx.fillStyle = canSwap ? COL.dimText : '#666666';
        ctx.fillText('or BACKSPACE', btn.x + btn.w / 2, c.y + c.h - 6);

        const textW = btn.x - c.x - 16;

        if (!rows) {
            ctx.textAlign = 'left';
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = '#777777';
            ctx.fillText('CONTROLS', c.x + 8, c.y + 18);
            ctx.font = '11px monospace';
            ctx.fillText(fitText(ctx, 'controls unavailable', textW), c.x + 8, c.y + 34);
            return;
        }

        const colName = c.x + 8;
        const colSide = c.x + 8 + Math.round(textW * 0.22);
        const colMove = c.x + 8 + Math.round(textW * 0.42);
        const colAct = c.x + 8 + Math.round(textW * 0.75);
        const lineH = Math.min(16, Math.floor((c.h - 14) / Math.max(1, rows.length)));

        ctx.textAlign = 'left';
        rows.forEach(function (row, i) {
            const y = c.y + 18 + i * lineH;
            ctx.font = 'bold 11px monospace';
            ctx.fillStyle = row.color;
            ctx.fillText(fitText(ctx, row.name, colSide - colName - 4), colName, y);

            ctx.font = '11px monospace';
            ctx.fillStyle = COL.dimText;
            ctx.fillText(row.marker + ' ' + row.side.toUpperCase(), colSide, y);

            ctx.fillStyle = COL.text;
            ctx.fillText(fitText(ctx, row.movement, colAct - colMove - 12), colMove, y);

            ctx.fillStyle = COL.dimText;
            ctx.fillText('·', colAct - 10, y);
            ctx.fillStyle = COL.text;
            ctx.fillText(fitText(ctx, row.action, btn.x - colAct - 8), colAct, y);
        });
    }

    function drawTabs(ctx, L, activeTab) {
        L.tabs.forEach(function (tab) {
            const active = tab.id === activeTab;
            box(ctx, tab.x, tab.y, tab.w, tab.h,
                active ? COL.tabActiveBg : COL.tabIdleBg,
                active ? COL.accent : 'rgba(200,200,200,0.6)',
                active ? 2 : 1);
            ctx.fillStyle = active ? COL.tabActiveText : COL.tabIdleText;
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(tab.label, tab.x + tab.w / 2, tab.y + tab.h / 2 + 4);
        });

        // Right-hand hint strip, same voice as the other HUD panels.
        ctx.fillStyle = COL.dimText;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('TAB switch  ARROWS move  ENTER confirm  T/ESC close',
            L.panel.x + L.panel.w - PAD, L.tabs[0].y + TAB_H / 2 + 4);
    }

    function drawDetail(ctx, L, title, blurb, cost, stateLine, prompt) {
        const d = L.detail;
        box(ctx, d.x, d.y, d.w, d.h, 'rgba(255,255,255,0.06)', 'rgba(200,200,200,0.5)', 1);

        ctx.textAlign = 'left';
        ctx.fillStyle = COL.accent;
        ctx.font = 'bold 13px monospace';
        ctx.fillText(fitText(ctx, title, d.w - 16), d.x + 8, d.y + 17);

        ctx.fillStyle = COL.text;
        ctx.font = '11px monospace';
        ctx.fillText(fitText(ctx, blurb, d.w - 16), d.x + 8, d.y + 34);

        ctx.fillStyle = COL.dimText;
        ctx.fillText(fitText(ctx, cost, d.w - 16), d.x + 8, d.y + 50);

        // A live feedback message outranks the static state line — it is the
        // answer to "why did nothing happen when I pressed enter?".
        const fresh = message && (Date.now() - messageAt) < MESSAGE_MS;
        if (fresh) {
            ctx.fillStyle = messageTone === 'good' ? COL.good : COL.bad;
            ctx.font = 'bold 11px monospace';
            ctx.fillText(fitText(ctx, message, d.w - 16), d.x + 8, d.y + 67);
        } else if (stateLine) {
            ctx.fillStyle = COL.dimText;
            ctx.font = '11px monospace';
            ctx.fillText(fitText(ctx, stateLine, d.w - 16), d.x + 8, d.y + 67);
        }

        if (prompt) {
            ctx.textAlign = 'right';
            ctx.fillStyle = COL.accent;
            ctx.font = 'bold 11px monospace';
            ctx.fillText(prompt, d.x + d.w - 8, d.y + 67);
        }
    }

    function drawTechTab(ctx, TL) {
        const L = TL.L;

        // Edges first so the node boxes sit on top of them.
        TECH_NODES.forEach(function (node) {
            const to = TL.byId[node.id];
            if (!to) return;
            node.requires.forEach(function (reqId) {
                const from = TL.byId[reqId];
                if (!from) return;
                ctx.strokeStyle = isUnlocked(reqId) ? COL.edge : COL.edgeDim;
                ctx.lineWidth = isUnlocked(reqId) && isUnlocked(node.id) ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(from.x + from.w, from.y + from.h / 2);
                ctx.lineTo(to.x, to.y + to.h / 2);
                ctx.stroke();
            });
        });

        TL.boxes.forEach(function (b) {
            const state = nodeState(b.node);
            let fill = COL.availFill;
            let border = COL.accent;
            let textCol = COL.accent;
            if (state === 'unlocked') {
                fill = COL.unlockedFill; border = COL.unlockedBorder; textCol = COL.text;
            } else if (state === 'poor') {
                fill = COL.poorFill; border = COL.poorBorder; textCol = COL.poorText;
            } else if (state === 'blocked') {
                fill = COL.blockedFill; border = COL.blockedBorder; textCol = COL.blockedText;
            }

            const selected = b.id === techSelected;
            box(ctx, b.x, b.y, b.w, b.h, fill, selected ? COL.selection : border, selected ? 2 : 1);

            ctx.textAlign = 'center';
            ctx.fillStyle = textCol;
            ctx.font = 'bold 10px monospace';
            ctx.fillText(fitText(ctx, b.node.name, b.w - 6), b.x + b.w / 2, b.y + 14);

            // Second line: a tick when done, the cost when it is buyable, the
            // shortfall when it is not. Never blank — a bare box tells a kid
            // nothing about why they cannot click it.
            ctx.font = '9px monospace';
            let sub;
            if (state === 'unlocked') {
                sub = '✓ done';
            } else if (state === 'blocked') {
                sub = 'locked';
            } else if (state === 'poor') {
                const lack = shortfalls(b.node.cost)[0];
                sub = 'need ' + lack.short + ' ' + lack.material;
            } else {
                sub = costText(b.node.cost);
            }
            ctx.fillStyle = state === 'ready' ? COL.text : textCol;
            ctx.fillText(fitText(ctx, sub, b.w - 6), b.x + b.w / 2, b.y + b.h - 6);
        });

        // Detail strip for the selected node.
        const node = NODES_BY_ID[techSelected] || TECH_NODES[0];
        const state = nodeState(node);
        let stateLine;
        if (state === 'unlocked') stateLine = 'Researched.';
        else if (state === 'blocked') stateLine = 'Requires ' + missingPrereqs(node).map(function (m) {
            return NODES_BY_ID[m] ? NODES_BY_ID[m].name : m;
        }).join(' + ');
        else if (state === 'poor') stateLine = shortfallText(shortfalls(node.cost));
        else stateLine = 'Ready to research.';

        drawDetail(ctx, L,
            'TIER ' + node.tier + '  —  ' + node.name,
            node.blurb,
            'Cost: ' + costText(node.cost) + '   Effect: ' + node.effect + ' (coming soon)',
            stateLine,
            state === 'unlocked' ? '' : 'ENTER to research');
    }

    function drawWorkshopTab(ctx, WL) {
        const L = WL.L;

        WL.rows.forEach(function (row) {
            const state = recipeState(row.recipe);
            const selected = row.recipe.id === recipeSelected;
            let fill = COL.availFill;
            let textCol = COL.accent;
            let border = 'rgba(200,200,200,0.35)';
            if (state === 'poor') { fill = COL.poorFill; textCol = COL.poorText; }
            else if (state === 'blocked') { fill = COL.blockedFill; textCol = COL.blockedText; }

            box(ctx, row.x, row.y, row.w, row.h, fill,
                selected ? COL.selection : border, selected ? 2 : 1);

            const madeCount = (tech() && tech().crafted[row.recipe.id]) || 0;

            ctx.textAlign = 'left';
            ctx.fillStyle = textCol;
            ctx.font = 'bold 11px monospace';
            ctx.fillText(fitText(ctx, row.recipe.name, row.w * 0.34),
                row.x + 6, row.y + row.h / 2 + 4);

            ctx.font = '10px monospace';
            ctx.fillStyle = state === 'poor' ? COL.bad : COL.dimText;
            ctx.fillText(fitText(ctx, costText(row.recipe.cost), row.w * 0.26),
                row.x + row.w * 0.36, row.y + row.h / 2 + 4);

            ctx.fillStyle = COL.dimText;
            ctx.fillText(fitText(ctx, '→ ' + row.recipe.yields, row.w * 0.24),
                row.x + row.w * 0.63, row.y + row.h / 2 + 4);

            ctx.textAlign = 'right';
            if (state === 'blocked') {
                ctx.fillStyle = COL.blockedText;
                ctx.fillText('locked', row.x + row.w - 6, row.y + row.h / 2 + 4);
            } else if (madeCount > 0) {
                ctx.fillStyle = COL.good;
                ctx.fillText('x' + madeCount, row.x + row.w - 6, row.y + row.h / 2 + 4);
            } else if (state === 'ready') {
                ctx.fillStyle = COL.good;
                ctx.fillText('ready', row.x + row.w - 6, row.y + row.h / 2 + 4);
            } else {
                ctx.fillStyle = COL.poorText;
                ctx.fillText('short', row.x + row.w - 6, row.y + row.h / 2 + 4);
            }
        });

        const recipe = RECIPES_BY_ID[recipeSelected] || WORKSHOP_RECIPES[0];
        const state = recipeState(recipe);
        const reqNode = NODES_BY_ID[recipe.requiresTech];
        let stateLine;
        if (state === 'blocked') stateLine = 'Requires ' + (reqNode ? reqNode.name : recipe.requiresTech);
        else if (state === 'poor') stateLine = shortfallText(shortfalls(recipe.cost));
        else stateLine = 'Ready to craft.';

        drawDetail(ctx, L,
            recipe.name + '  →  ' + recipe.yields,
            recipe.blurb,
            'Cost: ' + costText(recipe.cost) + '   Needs: ' +
                (reqNode ? reqNode.name : recipe.requiresTech),
            stateLine,
            state === 'blocked' ? '' : 'ENTER to craft');
    }

    // ---------------------------------------------------------------------
    // Navigation
    // ---------------------------------------------------------------------

    function moveTechSelection(dx, dy) {
        let tierIdx = 0;
        let rowIdx = 0;
        NODES_BY_TIER.forEach(function (list, ti) {
            const i = list.findIndex(function (n) { return n.id === techSelected; });
            if (i >= 0) { tierIdx = ti; rowIdx = i; }
        });

        if (dx !== 0) {
            const next = Math.max(0, Math.min(NODES_BY_TIER.length - 1, tierIdx + dx));
            tierIdx = next;
            rowIdx = Math.max(0, Math.min(NODES_BY_TIER[tierIdx].length - 1, rowIdx));
        }
        if (dy !== 0) {
            const list = NODES_BY_TIER[tierIdx];
            rowIdx = Math.max(0, Math.min(list.length - 1, rowIdx + dy));
        }
        techSelected = NODES_BY_TIER[tierIdx][rowIdx].id;
        syncSelected();
    }

    function moveRecipeSelection(dy) {
        let idx = WORKSHOP_RECIPES.findIndex(function (r) { return r.id === recipeSelected; });
        if (idx < 0) idx = 0;
        idx = Math.max(0, Math.min(WORKSHOP_RECIPES.length - 1, idx + dy));
        recipeSelected = WORKSHOP_RECIPES[idx].id;
        syncSelected();
    }

    function syncSelected() {
        const t = tech();
        if (!t) return;
        t.selected = t.tab === 'workshop' ? recipeSelected : techSelected;
    }

    function openPanel() {
        const t = tech();
        if (!t) return;
        t.open = true;
        message = '';
        syncSelected();
    }

    function closePanel() {
        const t = tech();
        if (!t) return;
        t.open = false;
        message = '';
    }

    function toggleTab() {
        const t = tech();
        if (!t) return;
        t.tab = t.tab === 'tech' ? 'workshop' : 'tech';
        message = '';
        syncSelected();
    }

    function confirm() {
        const t = tech();
        if (!t) return;
        if (t.tab === 'workshop') attemptCraft(recipeSelected);
        else attemptResearch(techSelected);
    }

    // parity-core owns the swap; this panel only asks for it. Backspace is
    // handled here as well as globally because the open panel swallows every
    // key — the shortcut printed on the button has to work while the button
    // is on screen.
    function attemptSwap() {
        if (typeof swapControlHemispheres !== 'function') {
            say('Swapping sides is not available yet', 'bad');
            return false;
        }
        swapControlHemispheres();
        say('Swapped keyboard sides', 'good');
        return true;
    }

    function hit(rect, mx, my) {
        return mx >= rect.x && mx <= rect.x + rect.w &&
               my >= rect.y && my <= rect.y + rect.h;
    }

    // ---------------------------------------------------------------------
    // Contract globals
    // ---------------------------------------------------------------------

    function drawTechPanelImpl(ctx) {
        const t = tech();
        if (!t || !t.open || !ctx) return;

        const size = canvasSize();
        ctx.save();
        try {
            // Dimmed backdrop — the world keeps running behind the panel, so
            // this is what tells the players the panel has focus.
            ctx.fillStyle = COL.backdrop;
            ctx.fillRect(0, 0, size.w, size.h);

            const isWorkshop = t.tab === 'workshop';
            const TL = isWorkshop ? workshopLayout() : techLayout();
            const lay = TL.L;

            box(ctx, lay.panel.x, lay.panel.y, lay.panel.w, lay.panel.h,
                COL.panelBg, COL.panelBorder, 2);

            drawTabs(ctx, lay, t.tab);

            if (isWorkshop) drawWorkshopTab(ctx, TL);
            else drawTechTab(ctx, TL);

            // Footer, not a tab: who drives which half of the keyboard is
            // something either player may need to check mid-argument.
            drawControls(ctx, lay);
        } finally {
            // finally, so an exception mid-draw cannot leave the canvas state
            // (fillStyle, lineWidth, alpha) trashed for the rest of the frame.
            ctx.restore();
        }
    }

    function techPanelKeyImpl(key) {
        const t = tech();
        if (!t) return false;

        if (!t.open) {
            // Closed: consume 't' and nothing else. Consuming anything more
            // would eat a player's movement key while they are just playing.
            if (key === 't') {
                openPanel();
                return true;
            }
            return false;
        }

        switch (key) {
            case 'Escape':
            case 't':
                closePanel();
                break;
            case 'Tab':
                toggleTab();
                break;
            case 'Enter':
            case ' ':
                confirm();
                break;
            case 'Backspace':
                attemptSwap();
                break;
            case 'ArrowUp':
                if (t.tab === 'workshop') moveRecipeSelection(-1); else moveTechSelection(0, -1);
                break;
            case 'ArrowDown':
                if (t.tab === 'workshop') moveRecipeSelection(1); else moveTechSelection(0, 1);
                break;
            case 'ArrowLeft':
                if (t.tab === 'workshop') toggleTab(); else moveTechSelection(-1, 0);
                break;
            case 'ArrowRight':
                if (t.tab === 'workshop') toggleTab(); else moveTechSelection(1, 0);
                break;
            default:
                break;
        }

        // Every other key is swallowed on purpose: with the panel open, one
        // player reading the tree must not have the other player's WASD/arrow
        // keys drive characters around underneath it.
        return true;
    }

    function techPanelClickImpl(mx, my) {
        const t = tech();
        if (!t || !t.open) return false;

        const isWorkshop = t.tab === 'workshop';
        const TL = isWorkshop ? workshopLayout() : techLayout();
        const lay = TL.L;

        if (!hit(lay.panel, mx, my)) {
            closePanel();
            return true;
        }

        if (hit(lay.swapBtn, mx, my)) {
            attemptSwap();
            return true;
        }

        for (let i = 0; i < lay.tabs.length; i++) {
            if (hit(lay.tabs[i], mx, my)) {
                if (t.tab !== lay.tabs[i].id) {
                    t.tab = lay.tabs[i].id;
                    message = '';
                    syncSelected();
                }
                return true;
            }
        }

        if (isWorkshop) {
            for (let i = 0; i < TL.rows.length; i++) {
                const row = TL.rows[i];
                if (hit(row, mx, my)) {
                    // Click to select, click again to act — the same gesture
                    // works with a trackpad and with the keyboard.
                    if (recipeSelected === row.recipe.id) attemptCraft(row.recipe.id);
                    else { recipeSelected = row.recipe.id; syncSelected(); message = ''; }
                    return true;
                }
            }
        } else {
            for (let i = 0; i < TL.boxes.length; i++) {
                const b = TL.boxes[i];
                if (hit(b, mx, my)) {
                    if (techSelected === b.id) attemptResearch(b.id);
                    else { techSelected = b.id; syncSelected(); message = ''; }
                    return true;
                }
            }
        }

        // Inside the panel but not on anything actionable: still consumed, so
        // the click cannot fall through to tile placement in the world.
        return true;
    }

    function hasTechImpl(id) {
        return isUnlocked(id);
    }

    // Exported to the shared global scope (no module system in this project).
    // `var` on globalThis keeps it working under both browser and node harness.
    const root = (typeof globalThis !== 'undefined') ? globalThis : this;
    root.drawTechPanel = drawTechPanelImpl;
    root.techPanelKey = techPanelKeyImpl;
    root.techPanelClick = techPanelClickImpl;
    root.hasTech = hasTechImpl;

    // Exposed for the test harness / console poking only; game.js never reads it.
    root.__TECHTREE__ = {
        TECH_NODES: TECH_NODES,
        WORKSHOP_RECIPES: WORKSHOP_RECIPES,
        techLayout: techLayout,
        workshopLayout: workshopLayout,
        layout: layout
    };
})();

// Minimap — owned by minimap.js (see docs/coop-contract.md §4).
//
// The world is effectively one-dimensional: biomes are a pure function of world
// X and the only vertical extent is the MAX_DIG_DEPTH layers the players can dig
// below the surface. So the map is a wide horizontal strip, not a square: the
// question two players on one laptop actually ask is "how far apart are we, and
// is anyone down a hole?".
//
// Defines exactly one global: drawMinimap(ctx). Everything else is file-local.

(function () {
    'use strict';

    // ---- Layout -------------------------------------------------------------
    // Bottom-centre. Every other HUD element lives along the top edge: the HP
    // bar and inventory at top-left (10,10), the material palette at
    // canvas.width-200, and the co-op picture-in-picture inset top-right. A
    // grep for `canvas.height - ` in game.js finds nothing but the ground line,
    // so the bottom strip is unclaimed — and centring it keeps the map equally
    // readable from either side of the laptop.
    const PANEL_W = 340;
    const PANEL_H = 86;
    const PANEL_MARGIN = 12;   // gap from the bottom edge
    const PANEL_PAD = 6;       // gap between the frame and the map area
    const HEADER_H = 13;       // "MAP" label / scale readout row
    const CORNER_R = 5;

    // ---- Span ---------------------------------------------------------------
    // The margin beyond the outermost player is a FRACTION of the span, not a
    // fixed world distance. A world-space pad looks fine at normal separations
    // and then silently fails when the players get far apart: at 50,000 px
    // apart a 420 px pad is under 3 screen px — less than the marker radius —
    // and the marker ends up pinned on the frame border. A fraction holds the
    // same visual gap at every zoom level.
    const MARGIN_FRAC = 0.06;  // ~20px of a 328px strip, comfortably clear of the 10px marker
    const MIN_SPAN = 1600;     // 50 blocks — stops the map zooming wildly when the players stand together
    const SPAN_QUANTUM = 640;  // 20 blocks — snap the span so the zoom steps instead of wobbling every frame

    const TILE = 32;
    const DEFAULT_MAX_DIG_DEPTH = 50;

    const PLAYER_FALLBACK_COLORS = ['#4fc3f7', '#ff9800']; // Steve, Alex

    // Keyboard-hemisphere arrow beside a player marker. Small enough not to
    // crowd the 10px disc, big enough for a kid to read at a glance.
    const ARROW_W = 4;
    const ARROW_H = 7;

    // ---- Dug-column index ---------------------------------------------------
    // game.groundHoles can hold thousands of "worldX,depth" keys and drawMinimap
    // runs every frame, so we never walk the Set in the draw path. We keep a
    // sorted column -> deepest-depth index here (file-local derived data, never
    // hung off `game`) and rebuild it only when the Set changes identity or
    // size. Digging only ever adds keys, so size is a sound invalidation signal;
    // loadGame() swaps in a brand new Set, which the identity check catches.
    let holeIndex = { columns: [], depths: [], size: -1, source: null };

    function refreshHoleIndex(holes) {
        if (holeIndex.source === holes && holeIndex.size === holes.size) return;

        const deepestByColumn = new Map();
        for (const key of holes) {
            const comma = typeof key === 'string' ? key.indexOf(',') : -1;
            if (comma < 0) continue;
            // Despite the name "worldGridX" in game.js, the key's first field is
            // a pixel-aligned world X (Math.floor(x / 32) * 32), not a grid index.
            const column = parseInt(key.slice(0, comma), 10);
            const depth = parseInt(key.slice(comma + 1), 10);
            if (!Number.isFinite(column) || !Number.isFinite(depth)) continue;
            const prev = deepestByColumn.get(column);
            if (prev === undefined || depth > prev) deepestByColumn.set(column, depth);
        }

        const columns = Array.from(deepestByColumn.keys()).sort((a, b) => a - b);
        const depths = new Array(columns.length);
        for (let i = 0; i < columns.length; i++) depths[i] = deepestByColumn.get(columns[i]);

        holeIndex = { columns, depths, size: holes.size, source: holes };
    }

    // First index into a sorted array whose value is >= target.
    function lowerBound(sorted, target) {
        let lo = 0;
        let hi = sorted.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // ---- Small helpers ------------------------------------------------------
    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    function roundedRectPath(ctx, x, y, w, h, r) {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + w - rad, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
        ctx.lineTo(x + w, y + h - rad);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        ctx.lineTo(x + rad, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.closePath();
    }

    // Centre of an entity in world coordinates. Characters expose
    // getWorldBounds() (contract §1) but mobs, chickens and trees only have
    // x/width, and a half-built game.js may hand us neither.
    function entityCenterX(e) {
        if (!e) return NaN;
        if (typeof e.getWorldBounds === 'function') {
            const b = e.getWorldBounds();
            if (b && Number.isFinite(b.x)) return b.x + (b.width || 0) / 2;
        }
        if (!Number.isFinite(e.x)) return NaN;
        return e.x + (Number.isFinite(e.width) ? e.width / 2 : 0);
    }

    // World Y of the entity's feet, so a player down a shaft plots below ground.
    function entityFeetY(e) {
        if (!e) return NaN;
        if (typeof e.getWorldBounds === 'function') {
            const b = e.getWorldBounds();
            if (b && Number.isFinite(b.y)) return b.y + (b.height || 0);
        }
        if (!Number.isFinite(e.y)) return NaN;
        return e.y + (Number.isFinite(e.height) ? e.height : 0);
    }

    function playerColor(char, index) {
        if (char && typeof char.color === 'string' && char.color) return char.color;
        const i = Number.isFinite(char && char.playerIndex) ? char.playerIndex : index;
        if (char && char.name === 'Alex') return PLAYER_FALLBACK_COLORS[1];
        if (char && char.name === 'Steve') return PLAYER_FALLBACK_COLORS[0];
        return PLAYER_FALLBACK_COLORS[i] || PLAYER_FALLBACK_COLORS[0];
    }

    function safeArray(v) {
        return Array.isArray(v) ? v : [];
    }

    // Which keyboard hemisphere is this player on right now? The sides can be
    // swapped at runtime (Backspace), so two kids sharing a laptop need the map
    // to say who currently owns which half. parity-core is still landing this,
    // so every read is optional and a null result just means "draw no arrow".
    function playerHemisphere(char) {
        if (!char) return null;
        if (char.hemisphere === 'left' || char.hemisphere === 'right') return char.hemisphere;
        const map = game && game.controlAssignment;
        if (!map) return null;
        // The map may hold the character itself, its playerIndex, or its name.
        for (const side of ['left', 'right']) {
            const v = map[side];
            if (v === undefined || v === null) continue;
            if (v === char) return side;
            if (Number.isFinite(char.playerIndex) && v === char.playerIndex) return side;
            if (char.name && v === char.name) return side;
        }
        return null;
    }

    // Biome lookups come from game.js; a module that loads before/without it
    // should degrade to a plain strip rather than throw inside the draw pass.
    function biomeAt(worldX) {
        if (typeof getBiome !== 'function') return 'default';
        return getBiome(worldX);
    }

    function biomeGround(biome) {
        if (typeof getBiomeColors !== 'function') return { ground: '#5a5a5a', sky: '#7aa7c7' };
        return getBiomeColors(biome) || { ground: '#5a5a5a', sky: '#7aa7c7' };
    }

    // ---- Span ---------------------------------------------------------------
    // Both player markers must ALWAYS be inside the frame: when the players
    // split up, the strip is the only thing telling them how far apart they are.
    // How much further than normal the map should see. silverwork is permanent;
    // a Silver Mirror stacks over it for 60 s. Both only ever widen the span.
    function spanBoost() {
        let m = 1;
        if (typeof hasTech === 'function' && hasTech('silverwork')) m = 2.5;
        if (typeof game !== 'undefined' && game && game.buffs &&
            Date.now() < game.buffs.revealUntil) {
            m = Math.max(m, 5);
        }
        return m;
    }

    function computeSpan(cv, chars) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < chars.length; i++) {
            const x = entityCenterX(chars[i]);
            if (!Number.isFinite(x)) continue;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
        }

        const camX = (game && game.camera && Number.isFinite(game.camera.x)) ? game.camera.x : 0;
        if (!Number.isFinite(lo)) {
            lo = hi = camX + cv.width / 2;
        }

        // Union in the main viewport so the viewport rectangle is on-map when it
        // can be. Players outrank it: if the camera is lagging far behind them,
        // the viewport rectangle gets clipped rather than a player marker.
        const mustLo = Math.min(lo, camX);
        const mustHi = Math.max(hi, camX + cv.width);

        // The player extent may occupy at most (1 - 2 * MARGIN_FRAC) of the span.
        const usable = 1 - 2 * MARGIN_FRAC;
        let span = Math.max((hi - lo) / usable, mustHi - mustLo, MIN_SPAN * spanBoost());
        span = Math.ceil(span / SPAN_QUANTUM) * SPAN_QUANTUM;

        // Start centred on everything that should be visible, then slide the
        // window until both players clear the margin. Because span is at least
        // (hi - lo) / usable, that window always exists.
        const margin = MARGIN_FRAC * span;
        let min = (mustLo + mustHi) / 2 - span / 2;
        min = Math.min(min, lo - margin);            // keep the left player off the left edge
        min = Math.max(min, hi + margin - span);     // keep the right player off the right edge
        return { min: min, span: span };
    }

    // ---- Draw ---------------------------------------------------------------
    function drawMinimap(ctx) {
        if (!ctx) return;
        // Absent (an older game.js, or a save loaded before the flag existed)
        // means "show it". Only an explicit false hides the map — and we never
        // write the default back, because drawMinimap is pure rendering.
        if (typeof game === 'undefined' || !game || game.showMinimap === false) return;

        const cv = (typeof canvas !== 'undefined' && canvas) ? canvas : ctx.canvas;
        if (!cv || !Number.isFinite(cv.width) || !Number.isFinite(cv.height)) return;

        const maxDepth = (typeof MAX_DIG_DEPTH === 'number' && MAX_DIG_DEPTH > 0)
            ? MAX_DIG_DEPTH : DEFAULT_MAX_DIG_DEPTH;

        const panelX = Math.round((cv.width - PANEL_W) / 2);
        const panelY = Math.round(cv.height - PANEL_H - PANEL_MARGIN);
        const mapX = panelX + PANEL_PAD;
        const mapY = panelY + HEADER_H + 2;
        const mapW = PANEL_W - PANEL_PAD * 2;
        const mapH = PANEL_H - HEADER_H - 2 - PANEL_PAD;

        // Canvas Y grows DOWNWARD: the surface line sits a third of the way
        // down the map area and everything BELOW it (larger Y) is underground.
        const surfaceY = mapY + Math.round(mapH / 3);
        const undergroundH = mapY + mapH - surfaceY;

        const chars = safeArray(game.characters);
        const { min: spanMin, span } = computeSpan(cv, chars);
        const pxPerWorld = mapW / span;
        const toStripX = (worldX) => mapX + (worldX - spanMin) * pxPerWorld;
        const worldGroundY = cv.height - 50;
        // World pixels of dig depth that fill the underground half of the strip.
        const maxDepthPx = maxDepth * TILE;
        const toStripY = (feetY) => surfaceY +
            clamp((feetY - worldGroundY) / maxDepthPx, 0, 1) * undergroundH;

        ctx.save();
        try {
            // 1. Frame ----------------------------------------------------------
            ctx.fillStyle = 'rgba(12, 14, 18, 0.78)';
            roundedRectPath(ctx, panelX, panelY, PANEL_W, PANEL_H, CORNER_R);
            ctx.fill();
            ctx.strokeStyle = 'rgba(230, 235, 240, 0.55)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = 'rgba(230, 235, 240, 0.85)';
            ctx.fillText('MAP', panelX + PANEL_PAD, panelY + 11);

            // 8. Scale readout — 32 world px is one block.
            ctx.font = '9px monospace';
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(200, 208, 216, 0.75)';
            ctx.fillText(Math.round(span / TILE) + ' blocks', panelX + PANEL_W - PANEL_PAD, panelY + 11);

            // Everything from here is confined to the map area.
            ctx.beginPath();
            ctx.rect(mapX, mapY, mapW, mapH);
            ctx.clip();

            // 2. Biome bands ----------------------------------------------------
            // Sampled, never hardcoded, so the map follows getBiome() if the
            // boundaries move. Consecutive identical samples collapse into runs.
            const bands = [];
            for (let px = 0; px < mapW; px++) {
                const biome = biomeAt(spanMin + (px + 0.5) / pxPerWorld);
                const last = bands[bands.length - 1];
                if (last && last.biome === biome) last.end = px + 1;
                else bands.push({ biome: biome, start: px, end: px + 1 });
            }

            for (const band of bands) {
                const colors = biomeGround(band.biome);
                const bx = mapX + band.start;
                const bw = band.end - band.start;
                // Sky tint above the surface line, solid ground below it.
                ctx.globalAlpha = 0.30;
                ctx.fillStyle = colors.sky || '#7aa7c7';
                ctx.fillRect(bx, mapY, bw, surfaceY - mapY);
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = colors.ground || '#5a5a5a';
                ctx.fillRect(bx, surfaceY, bw, mapY + mapH - surfaceY);
                ctx.globalAlpha = 1;
            }

            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            for (const band of bands) {
                const bw = band.end - band.start;
                const label = band.biome === 'default' ? 'plains' : band.biome;
                const textW = ctx.measureText(label).width;
                if (textW + 8 > bw) continue; // no room — leave the band unlabelled
                const cx = mapX + band.start + bw / 2;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
                ctx.fillText(label, cx + 1, mapY + 10);
                ctx.fillStyle = 'rgba(245, 248, 250, 0.9)';
                ctx.fillText(label, cx, mapY + 9);
            }

            // 4. Dug terrain ----------------------------------------------------
            const holes = (game.groundHoles instanceof Set) ? game.groundHoles : null;
            if (holes && holes.size > 0) {
                refreshHoleIndex(holes);
                const colW = Math.max(1, TILE * pxPerWorld);
                const spanMax = spanMin + span;
                ctx.fillStyle = 'rgba(8, 8, 12, 0.85)';
                for (let i = lowerBound(holeIndex.columns, spanMin - TILE);
                     i < holeIndex.columns.length && holeIndex.columns[i] <= spanMax;
                     i++) {
                    const colX = toStripX(holeIndex.columns[i]);
                    // depth d means layers 0..d are gone, so the shaft bottom is
                    // (d + 1) tiles below the surface.
                    const depthPx = (holeIndex.depths[i] + 1) * TILE;
                    const notchH = clamp(depthPx / maxDepthPx, 0, 1) * undergroundH;
                    ctx.fillRect(colX, surfaceY, colW, Math.max(1, notchH));
                }
            }

            // 3. Surface line ---------------------------------------------------
            ctx.strokeStyle = 'rgba(240, 244, 248, 0.75)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mapX, surfaceY + 0.5);
            ctx.lineTo(mapX + mapW, surfaceY + 0.5);
            ctx.stroke();

            // 5. Entities -------------------------------------------------------
            const spanMax = spanMin + span;
            const inSpan = (x) => Number.isFinite(x) && x >= spanMin && x <= spanMax;

            ctx.strokeStyle = 'rgba(24, 74, 30, 0.95)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const tree of safeArray(game.trees)) {
                const wx = entityCenterX(tree);
                if (!inSpan(wx)) continue;
                const sx = Math.round(toStripX(wx)) + 0.5;
                ctx.moveTo(sx, surfaceY);
                ctx.lineTo(sx, surfaceY - 4);
            }
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            for (const chicken of safeArray(game.chickens)) {
                const wx = entityCenterX(chicken);
                if (!inSpan(wx)) continue;
                ctx.fillRect(toStripX(wx) - 1, surfaceY - 3, 2, 2);
            }

            for (const mob of safeArray(game.mobs)) {
                // A dead mob lingers 2.5s while its death spin plays (CLAUDE.md),
                // so isDying has to be skipped alongside burnedOut.
                if (!mob || mob.burnedOut || mob.isDying) continue;
                const wx = entityCenterX(mob);
                if (!inSpan(wx)) continue;
                const hostile = mob.hostile && !mob.passive;
                ctx.fillStyle = hostile ? '#ff4d4d' : '#ff9db1';
                ctx.fillRect(toStripX(wx) - 1.5, surfaceY - 4, 3, 3);
            }

            // 6.5 Workshop markers ------------------------------------------------
            // Torches you planted and waypoints you dropped, so a long tunnel is
            // navigable from the map rather than from memory.
            ctx.fillStyle = '#ffd54a';
            for (const t of safeArray(game.torches)) {
                if (!t || !inSpan(t.x)) continue;
                ctx.fillRect(toStripX(t.x) - 1, surfaceY - 6, 2, 4);
            }
            ctx.fillStyle = '#8ce08c';
            for (const w of safeArray(game.waypoints)) {
                if (!w || !inSpan(w.x)) continue;
                const wx = toStripX(w.x);
                ctx.beginPath();
                ctx.moveTo(wx, surfaceY - 9);
                ctx.lineTo(wx + 3, surfaceY - 6);
                ctx.lineTo(wx - 3, surfaceY - 6);
                ctx.closePath();
                ctx.fill();
            }

            // 7. Viewport rectangle ---------------------------------------------
            const camX = (game.camera && Number.isFinite(game.camera.x)) ? game.camera.x : 0;
            const viewL = toStripX(camX);
            const viewR = toStripX(camX + cv.width);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.lineWidth = 1;
            ctx.strokeRect(
                Math.round(viewL) + 0.5,
                mapY + 0.5,
                Math.max(2, Math.round(viewR - viewL)),
                mapH - 1
            );

            // 6. Players on top ---------------------------------------------------
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < chars.length; i++) {
                const char = chars[i];
                const wx = entityCenterX(char);
                if (!Number.isFinite(wx)) continue;
                const r = 5;
                const hemi = playerHemisphere(char);
                // The hemisphere arrow hangs off one side of the disc, so it has
                // to be inside the clamp margin or it would be the thing that
                // clips instead of the marker.
                const halfW = hemi ? r + ARROW_W + 1 : r;
                // computeSpan() already guarantees both players fit; the clamp is
                // the belt-and-braces that keeps a marker from ever clipping out
                // of the frame if a character teleports mid-frame.
                const sx = clamp(toStripX(wx), mapX + halfW, mapX + mapW - halfW);
                const feetY = entityFeetY(char);
                const sy = Number.isFinite(feetY) ? clamp(toStripY(feetY), mapY + r, mapY + mapH - r)
                                                  : surfaceY;

                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fillStyle = playerColor(char, i);
                ctx.fill();
                // Thin dark outline so the marker reads over any biome band.
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
                ctx.lineWidth = 1;
                ctx.stroke();

                const initial = (char && typeof char.name === 'string' && char.name)
                    ? char.name.charAt(0).toUpperCase() : String(i + 1);
                ctx.fillStyle = '#0b0d10';
                ctx.fillText(initial, sx, sy + 0.5);

                // Keyboard-side arrow: a solid triangle on the matching side of
                // the disc, pointing outward. Drawn in the player's colour over a
                // dark outline so it reads on snow and on cave rock alike.
                if (hemi) {
                    const dir = hemi === 'left' ? -1 : 1;
                    const baseX = sx + dir * (r + 1);
                    const tipX = baseX + dir * ARROW_W;
                    ctx.beginPath();
                    ctx.moveTo(tipX, sy);
                    ctx.lineTo(baseX, sy - ARROW_H / 2);
                    ctx.lineTo(baseX, sy + ARROW_H / 2);
                    ctx.closePath();
                    ctx.fillStyle = playerColor(char, i);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        } finally {
            ctx.restore();
        }
    }

    const globalScope = (typeof window !== 'undefined') ? window : globalThis;
    globalScope.drawMinimap = drawMinimap;
})();

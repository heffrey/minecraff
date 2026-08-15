// Couch co-op camera, picture-in-picture and off-screen beacons.
//
// Owns game.camera and game.coop (see docs/coop-contract.md §3). Loaded after
// game.js as a plain script -- no modules, no build step -- and exports exactly
// two globals: updateCoopCamera(deltaMs) and drawCoopOverlay(ctx).
(function () {
    'use strict';

    // --- Tuning -----------------------------------------------------------

    // The split thresholds are deliberately different. With one threshold the
    // whole screen flips between "shared view" and "PIP" every time the gap
    // jitters across it -- a single jump at the boundary strobes the entire
    // frame. Enter split when the players no longer comfortably fit; only leave
    // once they are a further 120px closer than that.
    const COOP_SPLIT_ENTER_MARGIN = 220; // enter when gap > viewW - this
    const COOP_SPLIT_EXIT_MARGIN = 340;  // leave when gap < viewW - this

    // Belt and braces on top of the hysteresis: the condition has to hold for
    // this long before the mode actually flips, so a jump arc or a creeper
    // knockback that briefly crosses a threshold cannot pop the inset.
    const COOP_MODE_DWELL_MS = 250;

    // Inset grows/fades in over this window instead of popping into existence.
    const COOP_PIP_ANIM_MS = 250;

    const COOP_PIP_WIDTH_FRACTION = 0.30;
    const COOP_PIP_ASPECT = 10 / 16; // height = width * this
    const COOP_PIP_MARGIN = 12;
    const COOP_PIP_HUD_CLEARANCE = 32; // clears the HP bar (10px top + 20px tall)
    const COOP_PIP_RADIUS = 8;

    // Matches the feel of the old per-frame `camera += (target - camera) * 0.1`
    // follow, but resolved against real elapsed time so a 30fps frame moves the
    // camera as far as two 60fps frames would.
    const COOP_CAMERA_LERP = 0.1;
    const COOP_LERP_REFERENCE_MS = 1000 / 60;

    const COOP_PULSE_PERIOD_MS = 1100;
    const COOP_BEAM_WIDTH = 26;
    const COOP_BEAM_ALPHA = 0.18;
    const COOP_EDGE_PADDING = 18;
    const COOP_PIXELS_PER_BLOCK = 32;

    const COOP_FALLBACK_COLORS = ['#4aa3ff', '#ff7ac4'];
    const COOP_FALLBACK_NAMES = ['Steve', 'Alex'];

    // --- Module state -----------------------------------------------------

    // A clock accumulated from deltaMs rather than Date.now(). Everything that
    // animates (dwell timers, inset scale, beacon pulse) reads it, so the whole
    // module is deterministic and testable without stubbing wall-clock time.
    let coopClock = 0;

    // Mode change waiting out COOP_MODE_DWELL_MS. null when nothing is pending.
    let pendingSplit = null;
    let pendingSince = 0;

    // When the last split ended, so the inset can animate out after
    // game.coop.pip has already gone back to null (the contract requires pip to
    // be null the instant we are no longer split).
    let splitEndedAt = -COOP_PIP_ANIM_MS;

    // Last known inset geometry, kept alive through the outro animation.
    let pipShadow = null;

    // --- Small helpers ----------------------------------------------------

    function coopViewport() {
        const el = (typeof canvas !== 'undefined' && canvas) ? canvas : null;
        return {
            w: el && el.width ? el.width : 800,
            h: el && el.height ? el.height : 600
        };
    }

    function coopState() {
        if (!game.coop) {
            game.coop = { split: false, splitAt: 0, pip: null, beaconsEnabled: true };
        }
        return game.coop;
    }

    function centerOf(char) {
        if (typeof playerCenter === 'function') {
            const c = playerCenter(char);
            if (c) return c;
        }
        const b = char.getWorldBounds();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }

    function charIndex(char, fallback) {
        return typeof char.playerIndex === 'number' ? char.playerIndex : fallback;
    }

    function charColor(char, index) {
        return char.color || COOP_FALLBACK_COLORS[index] || COOP_FALLBACK_COLORS[0];
    }

    function charLabel(char, index) {
        return (char.name || COOP_FALLBACK_NAMES[index] || 'P' + (index + 1)).toUpperCase();
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    function easeOutCubic(t) {
        const u = 1 - clamp(t, 0, 1);
        return 1 - u * u * u;
    }

    // char.color is a hex string in the contract; the beam and glows need it
    // with an alpha channel.
    function withAlpha(hex, alpha) {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''));
        if (!m) return 'rgba(255, 255, 255, ' + alpha + ')';
        let h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const n = parseInt(h, 16);
        return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + alpha + ')';
    }

    function roundRectPath(ctx, x, y, w, h, r) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
    }

    // 0..1 triangle-free sine pulse. Derived from coopClock, never Math.random,
    // so it is smooth and identical on every replay of the same frame times.
    function pulse01() {
        return 0.5 + 0.5 * Math.sin((coopClock / COOP_PULSE_PERIOD_MS) * Math.PI * 2);
    }

    function livePlayers() {
        return (game && Array.isArray(game.characters)) ? game.characters.filter(Boolean) : [];
    }

    // --- Camera -----------------------------------------------------------

    function pipRect(view) {
        const w = Math.round(view.w * COOP_PIP_WIDTH_FRACTION);
        const h = Math.round(w * COOP_PIP_ASPECT);
        return {
            x: view.w - w - COOP_PIP_MARGIN,
            y: COOP_PIP_MARGIN + COOP_PIP_HUD_CLEARANCE,
            w: w,
            h: h
        };
    }

    function setMode(coop, split) {
        coop.split = split;
        if (split) {
            coop.splitAt = coopClock;
        } else {
            coop.splitAt = 0;
            splitEndedAt = coopClock;
        }
    }

    function moveCamera(targetX, targetY, deltaMs) {
        // Manual scroll (Shift) owns the camera while it is active.
        if (game.scrollingMode) return;
        const dt = clamp(deltaMs || 0, 0, 100);
        const frames = dt / COOP_LERP_REFERENCE_MS;
        const t = 1 - Math.pow(1 - COOP_CAMERA_LERP, frames);
        game.camera.x += (targetX - game.camera.x) * t;
        game.camera.y += (targetY - game.camera.y) * t;
    }

    function updateCoopCamera(deltaMs) {
        if (typeof game === 'undefined' || !game || !game.camera) return;

        coopClock += clamp(deltaMs || 0, 0, 100);

        const coop = coopState();
        const view = coopViewport();
        const players = livePlayers();

        if (players.length === 0) {
            setMode(coop, false);
            coop.pip = null;
            pipShadow = null;
            return;
        }

        // Solo play must behave exactly like the old follow-camera: never split,
        // never show an inset.
        if (players.length < 2) {
            const only = centerOf(players[0]);
            if (coop.split) setMode(coop, false);
            pendingSplit = null;
            coop.pip = null;
            pipShadow = null;
            moveCamera(only.x - view.w / 2, only.y - view.h / 2, deltaMs);
            return;
        }

        const a = centerOf(players[0]);
        const b = centerOf(players[1]);
        const gap = Math.abs(a.x - b.x);

        const enterGap = Math.max(120, view.w - COOP_SPLIT_ENTER_MARGIN);
        const exitGap = Math.max(80, view.w - COOP_SPLIT_EXIT_MARGIN);

        // Asymmetric test: once split we hold on until they are well inside the
        // narrower exit gap, so hovering around the enter threshold cannot flap.
        const wantSplit = coop.split ? (gap > exitGap) : (gap > enterGap);

        if (wantSplit !== coop.split) {
            if (pendingSplit !== wantSplit) {
                pendingSplit = wantSplit;
                pendingSince = coopClock;
            }
            if (coopClock - pendingSince >= COOP_MODE_DWELL_MS) {
                setMode(coop, wantSplit);
                pendingSplit = null;
            }
        } else {
            pendingSplit = null;
        }

        if (coop.split) {
            // Main view is player 0's; player 1 gets the inset.
            moveCamera(a.x - view.w / 2, a.y - view.h / 2, deltaMs);

            const rect = pipRect(view);
            pipShadow = {
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                // Centre player 1 in a rect.w x rect.h viewport. drawWorld puts
                // world point p at p - cam, so cam = centre - viewport/2.
                camX: b.x - rect.w / 2,
                camY: b.y - rect.h / 2,
                char: players[1]
            };
            coop.pip = pipShadow;
        } else {
            // Midpoint keeps the shared view fair -- neither player is favoured
            // and neither drifts to the edge on their own.
            moveCamera((a.x + b.x) / 2 - view.w / 2, (a.y + b.y) / 2 - view.h / 2, deltaMs);
            coop.pip = null;
            // pipShadow is kept so the inset can animate out; refresh its camera
            // so the outro does not freeze on a stale frame.
            if (pipShadow) {
                pipShadow.camX = b.x - pipShadow.w / 2;
                pipShadow.camY = b.y - pipShadow.h / 2;
                pipShadow.char = players[1];
                if (coopClock - splitEndedAt >= COOP_PIP_ANIM_MS) pipShadow = null;
            }
        }
    }

    // --- Drawing ----------------------------------------------------------

    // How visible the inset should be right now: 0 hidden, 1 fully open.
    function pipVisibility(coop) {
        if (coop.split) {
            return easeOutCubic((coopClock - coop.splitAt) / COOP_PIP_ANIM_MS);
        }
        return 1 - easeOutCubic((coopClock - splitEndedAt) / COOP_PIP_ANIM_MS);
    }

    // World-space column of light rising from each player. Drawn per-camera so
    // it lands correctly in both the main view and the inset; the inset calls it
    // with its own camera from inside the clip.
    function drawBeacons(ctx, camX, camY) {
        const coop = coopState();
        if (coop.beaconsEnabled === false) return;

        const players = livePlayers();
        if (players.length < 2) return;

        const view = coopViewport();
        const glow = 0.75 + 0.25 * pulse01();

        ctx.save();
        for (let i = 0; i < players.length; i++) {
            const char = players[i];
            const idx = charIndex(char, i);
            const bounds = char.getWorldBounds();
            const screenX = bounds.x + bounds.width / 2 - camX;

            // Canvas Y grows downward, so the beam runs from the player's feet
            // (larger Y) up past the top of the viewport (negative Y).
            const footY = bounds.y + bounds.height - camY;
            const topY = -40;
            if (footY <= topY) continue;
            if (screenX < -COOP_BEAM_WIDTH || screenX > view.w + COOP_BEAM_WIDTH) continue;

            const color = charColor(char, idx);
            const grad = ctx.createLinearGradient(0, topY, 0, footY);
            grad.addColorStop(0, withAlpha(color, 0));
            grad.addColorStop(1, withAlpha(color, COOP_BEAM_ALPHA * glow));

            ctx.fillStyle = grad;
            ctx.fillRect(screenX - COOP_BEAM_WIDTH / 2, topY, COOP_BEAM_WIDTH, footY - topY);

            // Brighter core so the column reads as a beam and not a smudge.
            const core = ctx.createLinearGradient(0, topY, 0, footY);
            core.addColorStop(0, withAlpha(color, 0));
            core.addColorStop(1, withAlpha(color, COOP_BEAM_ALPHA * glow * 1.6));
            ctx.fillStyle = core;
            ctx.fillRect(screenX - 3, topY, 6, footY - topY);
        }
        ctx.restore();
    }

    function drawEdgeBeacon(ctx, char, index, view) {
        const center = centerOf(char);
        const screenX = center.x - game.camera.x;
        const screenY = center.y - game.camera.y;

        // "Outside the viewport" is both axes, not just X. Players dig, so a
        // partner 20 blocks down is off the BOTTOM of a shared view while their
        // X is still dead centre -- an X-only test left them with no indicator
        // at all, which is exactly when you most need one.
        const offLeft = screenX < 0;
        const offRight = screenX > view.w;
        const offTop = screenY < 0;
        const offBottom = screenY > view.h;
        if (!offLeft && !offRight && !offTop && !offBottom) return;

        const color = charColor(char, index);
        const name = charLabel(char, index);
        const camCenterX = game.camera.x + view.w / 2;
        const camCenterY = game.camera.y + view.h / 2;
        const distance = Math.round(
            Math.hypot(center.x - camCenterX, center.y - camCenterY) / COOP_PIXELS_PER_BLOCK
        );

        // Pin to the edge they left. Horizontal wins when they are off both,
        // since that is the axis players actually separate along.
        let x, y, dirX, dirY, glyph, align, textX, textY;
        if (offLeft || offRight) {
            dirX = offLeft ? -1 : 1;
            dirY = 0;
            x = offLeft ? COOP_EDGE_PADDING : view.w - COOP_EDGE_PADDING;
            y = clamp(screenY, 40, view.h - 40);
            glyph = offLeft ? '◂' : '▸';
            align = offLeft ? 'left' : 'right';
            textX = offLeft ? x + 16 : x - 16;
            textY = y;
        } else {
            dirX = 0;
            dirY = offTop ? -1 : 1;
            x = clamp(screenX, 48, view.w - 48);
            y = offTop ? COOP_EDGE_PADDING : view.h - COOP_EDGE_PADDING;
            glyph = offTop ? '▴' : '▾';
            align = 'center';
            textX = x;
            textY = offTop ? y + 20 : y - 20;
        }

        // Pulse the whole marker rather than redrawing it in place, so it reads
        // as a live beacon instead of static HUD chrome.
        const beat = pulse01();
        const alpha = 0.65 + 0.35 * beat;
        const reach = 4 * beat;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Chevron, pointing off-screen toward the player. Built from the edge
        // normal (dirX, dirY) and its perpendicular so one path serves all four
        // edges.
        const tipX = x + dirX * (10 + reach);
        const tipY = y + dirY * (10 + reach);
        const baseX = x - dirX * 6;
        const baseY = y - dirY * 6;
        const perpX = -dirY * 11;
        const perpY = dirX * 11;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + perpX, baseY + perpY);
        ctx.lineTo(baseX - perpX, baseY - perpY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dark stroke under light fill, the same trick the "Press E to chop"
        // hint uses so the text survives both the noon sky and midnight.
        const label = name + '  ' + glyph + ' ' + distance + 'm';
        ctx.font = '12px monospace';
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';
        ctx.strokeText(label, textX, textY);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, textX, textY);

        ctx.restore();
    }

    function drawPip(ctx, pip, visibility, view) {
        const index = charIndex(pip.char, 1);
        const color = charColor(pip.char, index);
        const name = charLabel(pip.char, index);

        // Grow from the top-right corner it is anchored to, so the intro reads
        // as the inset sliding out of the HUD rather than inflating in space.
        //
        // The scale must never exceed 1. drawWorld is handed the UNSCALED
        // pip.w/pip.h, so it paints exactly the unscaled rect; at scale <= 1
        // that always covers the (smaller) clip region. An overshooting ease --
        // a bouncy 1.05, say -- would shrink the painted area relative to the
        // clip and leave an unpainted crescent along the inset's edge
        // mid-animation. Math.min pins the invariant rather than trusting the
        // easing curve to respect it.
        const anchorX = pip.x + pip.w;
        const anchorY = pip.y;
        const scale = Math.min(1, 0.86 + 0.14 * visibility);

        ctx.save();
        ctx.globalAlpha = visibility;
        ctx.translate(anchorX, anchorY);
        ctx.scale(scale, scale);
        ctx.translate(-anchorX, -anchorY);

        // Clip is built AFTER the scale above, in the same user space the border
        // is stroked in, so the two coincide exactly at every animation step and
        // world content can never spill past the visible frame.
        ctx.save();
        roundRectPath(ctx, pip.x, pip.y, pip.w, pip.h, COOP_PIP_RADIUS);
        ctx.clip();

        // Opaque backdrop first: if drawWorld is unavailable the inset still
        // reads as a deliberate panel instead of a hole in the HUD. Inflated a
        // pixel -- the clip contains it anyway -- so the non-integer scale
        // during the animation cannot leave an anti-aliased hairline where the
        // square fill meets the rounded clip edge.
        ctx.fillStyle = '#101820';
        ctx.fillRect(pip.x - 1, pip.y - 1, pip.w + 2, pip.h + 2);

        if (typeof drawWorld === 'function') {
            // drawWorld emits screen coordinates of `world - cam` starting at
            // (0, 0), so translating by the inset's origin drops that whole
            // viewport into the rectangle. camX/camY were chosen in
            // updateCoopCamera to centre this player in a pip.w x pip.h view.
            ctx.save();
            ctx.translate(pip.x, pip.y);
            drawWorld(ctx, pip.camX, pip.camY, pip.w, pip.h, { hud: false });
            drawBeacons(ctx, pip.camX, pip.camY);
            ctx.restore();
        }
        ctx.restore();

        // Border in the player's accent colour.
        roundRectPath(ctx, pip.x, pip.y, pip.w, pip.h, COOP_PIP_RADIUS);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Name tag in the corner.
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const tagX = pip.x + 6;
        const tagY = pip.y + pip.h - 7;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(pip.x + 2, pip.y + pip.h - 19, 52, 16);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';
        ctx.strokeText(name, tagX, tagY);
        ctx.fillStyle = color;
        ctx.fillText(name, tagX, tagY);

        ctx.restore();
    }

    function drawCoopOverlay(ctx) {
        if (typeof game === 'undefined' || !game || !ctx) return;

        const coop = coopState();
        const view = coopViewport();
        const players = livePlayers();

        if (coop.beaconsEnabled !== false && (coop.split || coop.pip)) {
            // Main camera's copy of the world-space light columns. drawWorld
            // already ran for the main view, so this layers on top of it.
            drawBeacons(ctx, game.camera.x, game.camera.y);
        }

        if (coop.beaconsEnabled !== false) {
            for (let i = 0; i < players.length; i++) {
                drawEdgeBeacon(ctx, players[i], charIndex(players[i], i), view);
            }
        }

        // Draw the inset last so nothing overlaps it. pipShadow outlives
        // coop.pip by COOP_PIP_ANIM_MS to carry the close animation.
        const pip = coop.pip || pipShadow;
        if (pip && pip.char) {
            const visibility = clamp(pipVisibility(coop), 0, 1);
            if (visibility > 0.01) drawPip(ctx, pip, visibility, view);
        }
    }

    // Only the two globals the contract names. drawBeacons rides along as a
    // property so drawWorld could call it per-camera without claiming a third
    // name in the global scope.
    drawCoopOverlay.drawBeacons = drawBeacons;

    window.updateCoopCamera = updateCoopCamera;
    window.drawCoopOverlay = drawCoopOverlay;
})();

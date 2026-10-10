/* ==========================================================
   rodfer's archive — ambient node network
   ----------------------------------------------------------
   Ported from the Delteris site's network canvas (same physics:
   drifting/twinkling nodes, distance-faded edges, travelling
   data pulses, and a cursor that REPELS nodes like a same-pole
   magnet), recoloured to orange edges/halos + white node cores.

   Colours are read from CSS custom properties on :root so the
   palette lives in style.css, not here:
     --net-edge   "r, g, b"  edges, halos, pulse tails   (orange)
     --net-core   "r, g, b"  node cores, pulse heads     (white)
     --net-hot    "r, g, b"  the ~1-in-4 "hot" orange nodes

   <body data-net="calm"> (used on long-read pages) thins the
   field and dims it so it never fights with body text.
   ========================================================== */
(function () {
    'use strict';

    const canvas = document.getElementById('net');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const CALM = document.body.dataset.net === 'calm';

    // ---- palette from CSS (falls back to sane defaults) ----
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    const EDGE = pick('--net-edge', '255, 149, 28');
    const CORE = pick('--net-core', '255, 246, 234');
    const HOT  = pick('--net-hot',  '255, 184, 92');

    // ---- tuning (Delteris values, scaled down a touch for calm pages) ----
    const CONNECTION_DISTANCE = 165;
    const MOUSE_RADIUS = 190;
    const DIM = CALM ? 0.55 : 1;   // global opacity multiplier

    let width = 0, height = 0;
    // The canvas box is inset below the fixed nav (see #net in style.css),
    // so its top-left isn't (0,0). These hold that offset in CSS px so
    // viewport-relative pointer coords can be translated into canvas space.
    let offsetX = 0, offsetY = 0;

    // Nodes live in the band that's actually visible: below the nav and above
    // the footer (once it scrolls into view), kept EDGE_MARGIN px clear of
    // both so halos never get sliced by either edge. fieldTop/fieldBottom are
    // in canvas px; fieldBottom is re-measured every frame (see updateField).
    const EDGE_MARGIN = 24;
    const topbar = document.querySelector('.topbar');
    const footer = document.querySelector('footer');
    let fieldTop = EDGE_MARGIN, fieldBottom = 0;
    let nodes = [];
    let pulses = [];
    let frame = 0;
    let rafId = null;

    // Cursor in canvas px; inactive until the pointer actually moves
    const mouse = { x: -9999, y: -9999, active: false };

    function nodeCount() {
        const base = window.innerWidth < 768 ? 40 : 90;
        return Math.round(base * (CALM ? 0.6 : 1));
    }

    // Same as Delteris: the field lives in the band between the nav and the
    // footer. Top is inset to the nav's bottom edge (CSS); the bottom runs to
    // the viewport edge and is painted over by the opaque footer when it
    // scrolls into view, so the nodes stop exactly where the footer starts.
    // Height is pinned in px to the TALLEST the band can be, so the mobile URL
    // bar showing/hiding never resizes (and re-rasters) the canvas mid-scroll.
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const prevW = width, prevH = height;
        // Pin the canvas to the nav's REAL bottom edge (handles zoom, a nav
        // that wraps, or a stale stylesheet), falling back to the CSS inset.
        const navH = topbar ? Math.round(topbar.getBoundingClientRect().bottom)
                            : (offsetY || canvas.getBoundingClientRect().top || 0);
        canvas.style.top = navH + 'px';
        const stableViewportH = Math.max(window.innerHeight, document.documentElement.clientHeight || 0);
        width = Math.max(1, Math.round(window.innerWidth));
        height = Math.max(1, Math.round(stableViewportH - navH));
        const r0 = canvas.getBoundingClientRect();
        offsetX = r0.left;
        offsetY = r0.top;
        canvas.style.height = height + 'px';   // overrides the CSS lvh fallback
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Re-fit existing nodes instead of regenerating (no visible "reset")
        if (prevW && prevH && nodes.length) {
            const sx = width / prevW, sy = height / prevH;
            for (const n of nodes) { n.x *= sx; n.y *= sy; }
        }
        updateField();
    }

    // Bottom of the usable field: whichever comes first, the canvas bottom or
    // the footer's top edge (converted to canvas space), minus the margin.
    // getBoundingClientRect is a pure read here (no layout writes in the
    // loop), so calling it once per frame is cheap.
    function updateField() {
        const footerTop = footer ? footer.getBoundingClientRect().top - offsetY : Infinity;
        fieldBottom = Math.max(fieldTop + EDGE_MARGIN, Math.min(height, footerTop) - EDGE_MARGIN);
    }

    function Node() {
        this.x = Math.random() * width;
        this.y = fieldTop + Math.random() * (fieldBottom - fieldTop);
        this.vx = (Math.random() - 0.5) * 0.55;
        this.vy = (Math.random() - 0.5) * 0.55;
        this.radius = Math.random() * 1.6 + 1.2;
        this.phase = Math.random() * Math.PI * 2;        // own twinkle phase
        this.pulseSpeed = 0.015 + Math.random() * 0.02;
        this.hot = Math.random() < 0.25;                 // orange-cored minority
    }

    Node.prototype.update = function () {
        // Same-polarity magnet: push away from the cursor, stronger when closer
        if (mouse.active) {
            const dx = this.x - mouse.x, dy = this.y - mouse.y;
            const dist = Math.hypot(dx, dy);
            if (dist < MOUSE_RADIUS && dist > 0.01) {
                const force = (1 - dist / MOUSE_RADIUS) * 0.6;
                this.vx += (dx / dist) * force;
                this.vy += (dy / dist) * force;
            }
        }
        // Friction bleeds off cursor energy; a floor keeps nodes drifting
        this.vx *= 0.98;
        this.vy *= 0.98;
        if (Math.hypot(this.vx, this.vy) < 0.18) {
            const a = Math.random() * Math.PI * 2;
            this.vx += Math.cos(a) * 0.06;
            this.vy += Math.sin(a) * 0.06;
        }
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > width) this.vx *= -1;
        // Top margin (under the nav): hard bounce.
        if (this.y < fieldTop) { this.y = fieldTop; this.vy = Math.abs(this.vy); }
        // Bottom margin (above the footer): when the footer scrolls up, nodes
        // caught below the new bound EASE back up instead of snapping into a
        // line along the footer edge; once inside, they bounce normally.
        if (this.y > fieldBottom) {
            const over = this.y - fieldBottom;
            this.y -= over > 4 ? Math.min(6, over * 0.08) : over;
            this.vy = -Math.abs(this.vy);
        }
        this.x = Math.max(0, Math.min(width, this.x));
        this.y = Math.max(0, Math.min(height, this.y));
        this.phase += this.pulseSpeed;
    };

    Node.prototype.draw = function () {
        const t = (Math.sin(this.phase) + 1) / 2;          // 0..1 breathe
        const r = this.radius * (0.85 + t * 0.5);
        let near = 0;
        if (mouse.active) {
            const d = Math.hypot(this.x - mouse.x, this.y - mouse.y);
            if (d < MOUSE_RADIUS) near = 1 - d / MOUSE_RADIUS;
        }
        // Slightly hotter than Delteris' blue — orange reads dimmer on dark gray
        const glowA = (0.06 + t * 0.06 + near * 0.26) * DIM;
        const coreA = (0.30 + t * 0.18 + near * 0.40) * DIM;

        // Orange halo (additive → neon)
        const halo = r * 5;
        const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, halo);
        g.addColorStop(0, 'rgba(' + EDGE + ', ' + glowA + ')');
        g.addColorStop(1, 'rgba(' + EDGE + ', 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.x, this.y, halo, 0, Math.PI * 2);
        ctx.fill();

        // White (or hot-orange) core
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + (this.hot ? HOT : CORE) + ', ' + Math.min(1, coreA) + ')';
        ctx.fill();
    };

    function drawEdges() {
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                const distance = Math.hypot(a.x - b.x, a.y - b.y);
                if (distance >= CONNECTION_DISTANCE) continue;
                let opacity = 1 - distance / CONNECTION_DISTANCE;
                // Edges near the cursor light up, tracing where you point
                if (mouse.active) {
                    const md = Math.hypot((a.x + b.x) / 2 - mouse.x, (a.y + b.y) / 2 - mouse.y);
                    if (md < MOUSE_RADIUS) opacity += (1 - md / MOUSE_RADIUS) * 0.9;
                }
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle = 'rgba(' + EDGE + ', ' + Math.min(0.5, opacity * 0.26) * DIM + ')';
                ctx.lineWidth = 1.1;
                ctx.stroke();
            }
        }
    }

    // ---- travelling packets: white head fading into an orange tail ----
    function Pulse(from, to) {
        this.from = from;
        this.to = to;
        this.t = 0;
        this.speed = 0.008 + Math.random() * 0.012;
    }
    Pulse.prototype.update = function () { this.t += this.speed; return this.t < 1; };
    Pulse.prototype.draw = function () {
        const a = this.from, b = this.to;
        if (Math.hypot(a.x - b.x, a.y - b.y) > CONNECTION_DISTANCE * 1.3) { this.t = 1; return; }
        const x = a.x + (b.x - a.x) * this.t;
        const y = a.y + (b.y - a.y) * this.t;
        const fade = Math.sin(this.t * Math.PI);            // brightest mid-trip
        const halo = (2.6 * fade + 0.6) * 4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
        g.addColorStop(0, 'rgba(' + CORE + ', ' + 0.5 * fade * DIM + ')');
        g.addColorStop(0.35, 'rgba(' + EDGE + ', ' + 0.22 * fade * DIM + ')');
        g.addColorStop(1, 'rgba(' + EDGE + ', 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, halo, 0, Math.PI * 2);
        ctx.fill();
    };

    function spawnPulse() {
        if (nodes.length < 2) return;
        const a = nodes[(Math.random() * nodes.length) | 0];
        let best = null, bestD = CONNECTION_DISTANCE;
        for (const b of nodes) {
            if (b === a) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < bestD && Math.random() < 0.5) { best = b; bestD = d; }
        }
        if (best) pulses.push(new Pulse(a, best));
    }

    function drawFrame() {
        updateField();   // footer may have scrolled in/out since last frame
        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';
        for (const n of nodes) n.update();
        drawEdges();
        for (const n of nodes) n.draw();
        if (!reduceMotion && frame % 26 === 0 && pulses.length < 14) spawnPulse();
        pulses = pulses.filter(p => { const alive = p.update(); if (alive) p.draw(); return alive; });
        ctx.globalCompositeOperation = 'source-over';
        frame++;
    }

    function animate() {
        drawFrame();
        rafId = requestAnimationFrame(animate);
    }

    // ---- pointer: mouse on desktop, finger on touch; released on scroll ----
    if (!reduceMotion) {
        if (CAN_HOVER) {
            window.addEventListener('mousemove', e => {
                // viewport coords → the canvas's inset box
                mouse.x = e.clientX - offsetX; mouse.y = e.clientY - offsetY; mouse.active = true;
            }, { passive: true });
            document.addEventListener('mouseleave', () => { mouse.active = false; });
        } else {
            const track = e => {
                if (!e.touches || !e.touches.length) return;
                mouse.x = e.touches[0].clientX - offsetX; mouse.y = e.touches[0].clientY - offsetY; mouse.active = true;
            };
            window.addEventListener('touchstart', track, { passive: true });
            window.addEventListener('touchmove', track, { passive: true });
            window.addEventListener('touchend', () => { mouse.active = false; }, { passive: true });
            window.addEventListener('touchcancel', () => { mouse.active = false; }, { passive: true });
        }
        // Scrolling drops the "magnet" so a scroll gesture never drags the field
        window.addEventListener('scroll', () => { mouse.active = false; }, { passive: true });
    }

    // Only re-fit on a REAL width change; mobile fires height-only resizes
    // constantly as the URL bar slides, and reacting to those causes judder.
    let lastWidth = window.innerWidth, resizeTimer = null;
    window.addEventListener('resize', () => {
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); if (reduceMotion) drawFrame(); }, 150);
    });

    // Pause while the tab is hidden (battery)
    document.addEventListener('visibilitychange', () => {
        if (reduceMotion) return;
        if (document.hidden) { cancelAnimationFrame(rafId); rafId = null; }
        else if (!rafId) animate();
    });

    resize();
    for (let i = 0, n = nodeCount(); i < n; i++) nodes.push(new Node());
    if (reduceMotion) drawFrame();   // one static frame, no motion
    else animate();
})();

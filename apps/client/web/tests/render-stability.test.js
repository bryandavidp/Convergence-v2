/* Regresión de estabilidad de render / presupuesto de capas del compositor
 * (docs/RENDER_STABILITY_PLAN.md). Fija las correcciones del parpadeo a negro en Android
 * hi-dpi: sin filter animado sobre el tablero (RS-1), sin mix-blend-mode en el patrón del
 * tablero (RS-2), sin will-change permanente en el pool de la tienda (RS-3), decoding async
 * en imágenes (RS-5) y arranque conservador del gobernador en táctil hi-dpi (RS-7). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeEl } = require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Perf, Render } = cv;

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const gamejs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('RS-1: la Fiebre no anima filter sobre todo el tablero (solo transform)', () => {
  const m = css.match(/@keyframes fever-burst \{[\s\S]*?\n\}/);
  assert.ok(m, 'debe existir @keyframes fever-burst');
  assert.ok(!/filter/.test(m[0]), 'fever-burst no debe animar filter (re-rasteriza full-board)');
  assert.ok(/transform:\s*scale/.test(m[0]), 'conserva el zoom del espectáculo');
  const out = css.match(/@keyframes fever-out \{[\s\S]*?\}/);
  assert.ok(out && !/filter/.test(out[0]), 'fever-out tampoco anima filter');
});

test('RS-2: el patrón del tablero ya no usa mix-blend-mode (grupo aislado + readback)', () => {
  const m = css.match(/\.board-wrap::before \{[\s\S]*?\n\}/);
  assert.ok(m, 'debe existir .board-wrap::before');
  // Ignorar comentarios (el texto explicativo menciona la propiedad a propósito).
  const body = m[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/mix-blend-mode\s*:/.test(body), '.board-wrap::before no debe declarar mix-blend-mode');
});

test('RS-3: el pool de la tienda no tiene will-change permanente', () => {
  const m = css.match(/\.shop-fx > span \{[^}]*\}/);
  assert.ok(m, 'debe existir .shop-fx > span');
  assert.ok(!/will-change/.test(m[0]), '.shop-fx > span no debe declarar will-change permanente');
});

test('RS-5: las imágenes decodifican en async (helper icon + index.html)', () => {
  assert.ok(/const icon =[^\n]*decoding="async"/.test(gamejs), 'el helper icon() emite decoding="async"');
  const imgs = html.match(/<img\b/g) || [];
  const withDecoding = html.match(/<img decoding="async"/g) || [];
  assert.ok(imgs.length > 0, 'hay imágenes en index.html');
  assert.equal(withDecoding.length, imgs.length, 'TODAS las <img> de index.html llevan decoding="async"');
});

test('RS-7: arranque conservador en táctil de alta densidad (dpr≥2)', () => {
  const dprBak = window.devicePixelRatio, mtpBak = navigator.maxTouchPoints;
  window.devicePixelRatio = 2; navigator.maxTouchPoints = 1;
  Perf.init();
  assert.equal(Perf.level, 1, 'táctil con dpr≥2 arranca en nivel 1 (antes solo dpr≥3)');
  // Escritorio sin táctil sigue arrancando en 0.
  navigator.maxTouchPoints = 0; window.devicePixelRatio = 1;
  Perf.init();
  assert.equal(Perf.level, 0, 'escritorio arranca en nivel 0');
  window.devicePixelRatio = dprBak; navigator.maxTouchPoints = mtpBak;
});

test('RS-4: los pulsos de celda concurrentes se acotan (tope por nivel del gobernador)', () => {
  Render.cells = Array.from({ length: 64 }, () => makeEl('div'));
  // Nivel 0: tope 28. Una "cascada" de 64 celdas no debe promover más de 28 capas a la vez.
  Perf.level = 0; Render._pulseActive = 0;
  for (let i = 0; i < 64; i++) Render.cellPulse(i, 'bomb-cleared', 700);
  assert.ok(Render._pulseActive <= 28, `nivel 0: ${Render._pulseActive} pulsos activos <= 28`);
  assert.ok(Render._pulseActive >= 20, 'sí llega a pulsar un lote grande (no se queda corto)');
  // Nivel 2 (gama baja / bajo presión): tope 10.
  Perf.level = 2; Render._pulseActive = 0;
  for (let i = 0; i < 64; i++) Render.cellPulse(i, 'bomb-cleared', 700);
  assert.ok(Render._pulseActive <= 10, `nivel 2: ${Render._pulseActive} pulsos activos <= 10`);
  Perf.level = 0; Render._pulseActive = 0;
});

test('RS-10: spawnAnim usa WAAPI (sin reflujo por celda ni clase .spawn)', () => {
  let animated = 0;
  const g = makeEl('span');
  g.getAnimations = () => [];
  g.animate = () => { animated++; return { cancel() { }, onfinish: null, oncancel: null }; };
  const cell = makeEl('button');
  Render.cells = [cell]; Render.glyphs = [g];
  Render.spawnAnim(0);
  assert.equal(animated, 1, 'anima el glifo por WAAPI (arranca sin reflujo)');
  assert.ok(!cell.classList.contains('spawn'), 'ya NO añade la clase .spawn que reiniciaba la animación CSS con void offsetWidth');
});

test('RS-7: dispositivo de poca RAM arranca conservador aunque el dpr sea bajo', () => {
  const dprBak = window.devicePixelRatio, mtpBak = navigator.maxTouchPoints, memBak = navigator.deviceMemory;
  window.devicePixelRatio = 1; navigator.maxTouchPoints = 1; navigator.deviceMemory = 2;
  Perf.init();
  assert.equal(Perf.level, 1, 'táctil con deviceMemory≤4 arranca en nivel 1');
  window.devicePixelRatio = dprBak; navigator.maxTouchPoints = mtpBak; navigator.deviceMemory = memBak;
});

/* ===== Grupo A (Supervivencia bajo estrés) — RS-11 / RS-12 ===== */

test('A1 (RS-11): el pulso de frenesí no anima filter sobre el tablero (solo transform)', () => {
  const m = css.match(/@keyframes surv-frenzy-pulse \{[^\n]*\}/);
  assert.ok(m, 'existe @keyframes surv-frenzy-pulse');
  assert.ok(!/filter/.test(m[0]), 'no anima filter (re-rasterizaba full-board a dpr× cada frame)');
  assert.ok(/transform/.test(m[0]), 'conserva el "latido" con transform (compositor)');
});

test('A2 (RS-11): el gobernador degrada las infinitas de estrés de Supervivencia (no solo reduced-fx)', () => {
  assert.ok(/body\.perf-1 \.board-wrap\.danger \{[^}]*animation:\s*none/.test(css),
    'perf-1 corta el borde de peligro (dangerBorder repinta border-color full-board)');
  assert.ok(/body\.perf-2\.surv-frenzy-active \.board-wrap \{[^}]*animation:\s*none/.test(css),
    'perf-2 corta el latido de frenesí (queda el glow estático + aura #fever)');
});

test('A3 (RS-12): aria-label memoizado — no reescribe el atributo si no cambia icono/pack/idioma', () => {
  const { Render, State } = cv;
  const cell = makeEl('button'), glyph = makeEl('span');
  let ariaWrites = 0;
  const origSet = cell.setAttribute.bind(cell);
  cell.setAttribute = (k, v) => { if (k === 'aria-label') ariaWrites++; return origSet(k, v); };
  Render.cells = [cell]; Render.glyphs = [glyph];
  State.board = [null]; State.tiles = [null];
  Render._cellId = []; Render._cellPack = []; Render._cellTile = []; Render._cellAria = [];
  Render.syncCell(0);
  assert.equal(ariaWrites, 1, 'el primer sync escribe el aria-label');
  Render.syncCell(0);
  assert.equal(ariaWrites, 1, 'un sync repetido SIN cambios no reescribe el atributo');
  Render._cellAria[0] = 'STALE';            // clave distinta = cambió icono/pack/idioma
  Render.syncCell(0);
  assert.equal(ariaWrites, 2, 'una clave distinta sí fuerza la reescritura');
});

test('A3 (RS-12): syncCells sincroniza SOLO las celdas dadas (no barre las 64)', () => {
  const { Render, State } = cv;
  Render.cells = Array.from({ length: 64 }, () => makeEl('button'));
  Render.glyphs = Array.from({ length: 64 }, () => makeEl('span'));
  State.board = Array(64).fill(null); State.tiles = Array(64).fill(null);
  Render._cellId = []; Render._cellPack = []; Render._cellTile = []; Render._cellAria = [];
  let synced = 0; const orig = Render.syncCell.bind(Render);
  Render.syncCell = (i) => { synced++; return orig(i); };
  Render.syncCells([3, 7, 40]);
  Render.syncCell = orig;
  assert.equal(synced, 3, 'solo sincroniza las 3 celdas indicadas, no las 64');
});

/* ===== Grupo B (gobernador proactivo/predictivo) — RS-13 ===== */

test('B1 (RS-13): perfStress — suelo predictivo por ocupación + evento de estrés', () => {
  const { Survival, State, Bosses } = cv;
  const bak = { status: State.status, mode: State.mode, size: State.size, iconCount: State.iconCount };
  const encBak = Bosses.enc, fuBak = Survival.frenzyUntil, luBak = Survival.lockUntil;
  State.status = 'playing'; State.mode = 'supervivencia'; State.size = 8;
  Bosses.enc = null; Survival.frenzyUntil = 0; Survival.lockUntil = 0;   // sin evento
  State.iconCount = 20; assert.equal(Survival.perfStress(), 0, 'tablero holgado (0.31) -> 0');
  State.iconCount = 42; assert.equal(Survival.perfStress(), 0, 'medio (0.66) sin evento -> 0');
  State.iconCount = 59; assert.equal(Survival.perfStress(), 1, 'casi lleno (0.92) sin evento -> 1');
  Survival.lockUntil = globalThis.performance.now() + 1000;               // evento activo (lock)
  State.iconCount = 45; assert.equal(Survival.perfStress(), 1, 'lleno (0.70) + evento -> 1');
  State.iconCount = 56; assert.equal(Survival.perfStress(), 2, 'lleno (0.875) + evento -> 2 (la ráfaga)');
  State.status = 'idle'; assert.equal(Survival.perfStress(), 0, 'fuera de partida -> 0');
  Object.assign(State, bak); Bosses.enc = encBak; Survival.frenzyUntil = fuBak; Survival.lockUntil = luBak;
});

test('B1 (RS-13): setFloor eleva el nivel EFECTIVO y acota FX.cap; resetFloor lo suelta', () => {
  const { Perf, FX } = cv;
  Perf.apply(0); Perf._floor = 0; Perf._floorHoldUntil = 0; Perf.applied = -1; Perf._render();
  assert.equal(Perf._effective(), 0, 'nivel efectivo = reactivo cuando no hay suelo');
  FX.cap = 50;
  Perf.setFloor(2);
  assert.equal(Perf._effective(), 2, 'el suelo predictivo eleva el efectivo a 2 sin tocar el reactivo');
  assert.equal(Perf.level, 0, 'el nivel REACTIVO no cambia (independiente del suelo)');
  assert.ok(FX.cap <= Perf.CAP[2], `FX.cap acotado al techo del nivel 2 (${FX.cap} <= ${Perf.CAP[2]})`);
  assert.ok(document.body.classList.contains('perf-2'), 'aplica la clase perf-2 en <body>');
  Perf.resetFloor();
  assert.equal(Perf._effective(), 0, 'resetFloor suelta el suelo de inmediato');
  assert.ok(!document.body.classList.contains('perf-2'), 'quita perf-2 al soltar');
});

test('B3 (RS-13): frames-pico sueltan partículas y escalan de nivel sin esperar al EMA', () => {
  const { Perf, FX, State } = cv;
  const bakStatus = State.status;
  State.status = 'playing';
  Perf.apply(0); Perf._floor = 0; Perf._floorHoldUntil = 0; Perf._spikeMs = 0; FX.cap = 40;
  // Frame-pico con EMA aún "bueno" (16ms): la histéresis por EMA no subiría; B3 sí reacciona.
  Perf.step(16, Perf.SPIKE_MS + 25);
  assert.ok(FX.cap < 40, 'un pico suelta partículas de inmediato');
  assert.ok(Perf._spikeMs > 0, 'acumula evidencia de pico pese al EMA bueno');
  assert.equal(Perf.level, 0, 'un pico aislado todavía no escala');
  // Segundo pico encadenado: supera SPIKE_UP -> sube el nivel reactivo.
  Perf.step(16, Perf.SPIKE_MS + 25);
  assert.equal(Perf.level, 1, 'dos picos encadenados escalan el nivel sin esperar 2s de EMA malo');
  // Un pico aislado se OLVIDA con frames buenos (no deja el nivel clavado por un GC puntual).
  Perf.apply(0); Perf._spikeMs = 0;
  Perf.step(16, Perf.SPIKE_MS + 25);      // un pico
  for (let k = 0; k < 6; k++) Perf.step(16, 16);   // frames buenos: decae
  assert.equal(Perf._spikeMs, 0, 'el pico aislado decae a 0 con frames buenos');
  State.status = bakStatus; Perf.apply(0); Perf._spikeMs = 0;
});

/* ===== Grupo C (estructural) — RS-14: canvas de partículas (experimental) + sonda ===== */

test('C1 (RS-14): el backend de canvas está OFF por defecto (no altera producción)', () => {
  const { FX } = cv;
  assert.equal(FX._wantCanvas(), false, 'sin ?canvasfx ni flag, el canvas de partículas está OFF');
});

test('C1 (RS-14): _particleAt reproduce la parábola y el fundido de _emit', () => {
  const { FX } = cv;
  const p = { x: 100, y: 50, vx: 10, vy: 20, g: 100, life: 1, spin: 90, size: 6, shape: 0, color: '#fff' };
  const s = FX._particleAt(p, 0.5);   // x=105; y=50+10+12.5=72.5; rot=45; frac .5 -> alpha 1
  assert.equal(s.x, 105);
  assert.ok(Math.abs(s.y - 72.5) < 1e-9, 'y sigue la parábola x + v·t + ½·g·t²');
  assert.equal(s.rot, 45, 'rotación = spin·t');
  assert.equal(s.alpha, 1);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(FX._particleAt(p, 0.7).alpha - 0.5) < 1e-9, 'fundido lineal 60%→80% de la vida');
  assert.equal(FX._particleAt(p, 1.0).dead, true, 't ≥ life -> muerta');
  const pre = FX._particleAt(p, -0.1);
  assert.equal(pre.alpha, 0, 'durante el delay es invisible');
  assert.equal(pre.dead, false, 'pero no está muerta (aún no ha nacido)');
});

test('C1 (RS-14): _emitCanvas respeta el tope (descarta al saturar, como el pool DOM)', () => {
  const { FX } = cv;
  const capBak = FX.cap, cpsBak = FX.cps, ucBak = FX.useCanvas;
  FX.useCanvas = true; FX.cps = []; FX.cap = 3;
  for (let k = 0; k < 10; k++) FX._emitCanvas(0, 0, 0, 0, 0, 1, 5, '#fff', 0, 0, 0, false);
  assert.equal(FX.cps.length, 3, 'no supera FX.cap (descarta el resto)');
  FX.cps = [];
  for (let k = 0; k < FX.ABS_MAX + 40; k++) FX._emitCanvas(0, 0, 0, 0, 0, 1, 5, '#fff', 0, 0, 0, true);
  assert.equal(FX.cps.length, FX.ABS_MAX, 'con force llega hasta ABS_MAX (backstop de celebración)');
  FX.cap = capBak; FX.cps = cpsBak; FX.useCanvas = ucBak;
});

test('C1 (RS-14): stepCanvas descarta las partículas muertas (compacta el array)', () => {
  const { FX } = cv;
  const bak = { uc: FX.useCanvas, c: FX.canvas, ctx: FX.cctx, cps: FX.cps, dpr: FX.cdpr };
  const noop = () => {};
  FX.useCanvas = true; FX.cdpr = 1; FX.canvas = { width: 200, height: 200 };
  FX.cctx = { globalAlpha: 1, fillStyle: '', clearRect: noop, save: noop, restore: noop, translate: noop, rotate: noop, fillRect: noop, beginPath: noop, arc: noop, fill: noop };
  FX.cps = [
    { x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 1, size: 5, shape: 0, color: '#fff', spin: 0, age: 0.9 }, // vive
    { x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 1, size: 5, shape: 1, color: '#0f0', spin: 30, age: 1.5 }, // muerta
  ];
  FX.stepCanvas(16);
  assert.equal(FX.cps.length, 1, 'la muerta (age ≥ life) se recolecta; la viva permanece');
  FX.useCanvas = bak.uc; FX.canvas = bak.c; FX.cctx = bak.ctx; FX.cps = bak.cps; FX.cdpr = bak.dpr;
});

test('C2 (RS-14/RS-9): la sonda soporta perfil Android hi-dpi y comparación de canvas', () => {
  const probe = fs.readFileSync(path.join(__dirname, '..', 'tools', 'perf-probe.js'), 'utf8');
  assert.ok(/--android/.test(probe), 'perf-probe acepta --android (tablet hi-dpi)');
  assert.ok(/deviceScaleFactor/.test(probe), 'emula el dpr real (coste de paint)');
  assert.ok(/--canvas/.test(probe) && /enableCanvas/.test(probe), 'perf-probe compara el backend de canvas');
  assert.ok(/tideSurge|meteorRain|frostSurge/.test(probe), 'la escena de estrés fuerza eventos de Supervivencia');
});

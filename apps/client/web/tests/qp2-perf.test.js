/* Regresión de QP-2 (rendimiento móvil, docs/QA_PERF_PLAN.md §3.4).
 * Fija: (1) el gobernador de FX v2 con histéresis y su clamp de tope (B-08),
 * (2) el arranque conservador en móvil de alta densidad (P1-g),
 * (3) que las animaciones ambientales/pulsos ya no repintan (P0-b/c) — vía guardarraíl
 *     de CSS, igual que el de backdrop-filter de QP-1. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Perf, FX, I18n, Settings } = cv;

// Alimenta al gobernador `ms` milisegundos de un EMA constante (dt fijo de 100ms/frame).
function feed(ema, ms) { for (let t = 0; t < ms; t += 100) Perf.step(ema, 100); }
// Estado limpio de nivel N sin depender del arranque.
function reset(level) { Perf._bootGuard = false; Perf.suggested = true; Perf.level = -1; Perf.apply(level); }

test('B-08 / P1-d: el gobernador SUBE de nivel con EMA malo sostenido (histéresis 2s)', () => {
  reset(0);
  assert.equal(Perf.level, 0);
  feed(25, 1900); // EMA 25ms (>20) pero aún <2s sostenido
  assert.equal(Perf.level, 0, 'no debe subir antes de 2s');
  feed(25, 200);  // completa los 2s
  assert.equal(Perf.level, 1, 'EMA>20 sostenido 2s -> nivel 1');
  assert.ok(document.body.classList.contains('perf-1'));
  assert.ok(!document.body.classList.contains('perf-2'));
  feed(30, 2000); // EMA 30ms (>26) sostenido -> nivel 2
  assert.equal(Perf.level, 2, 'EMA>26 sostenido 2s -> nivel 2');
  assert.ok(document.body.classList.contains('perf-2'));
});

test('P1-d: el gobernador BAJA de nivel solo tras 10s buenos (histéresis)', () => {
  reset(2);
  feed(10, 9900); // EMA bueno pero <10s
  assert.equal(Perf.level, 2, 'no debe bajar antes de 10s');
  feed(10, 200);
  assert.equal(Perf.level, 1, '10s buenos -> baja un nivel');
  feed(10, 10000);
  assert.equal(Perf.level, 0, 'otros 10s buenos -> nivel 0');
  assert.ok(!document.body.classList.contains('perf-1'));
});

test('P1-d: una zona intermedia (20<EMA<26 en nivel 1) no oscila', () => {
  reset(1);
  feed(23, 8000); // ni sube (no >26) ni baja (no <16)
  assert.equal(Perf.level, 1, 'la zona objetivo se mantiene estable');
});

test('B-08: el tope de partículas nunca supera el techo del nivel (bug del +3)', () => {
  reset(0);
  FX.cap = 40;
  feed(10, 6000); // EMA bueno: el tope sube de 3 en 3 pero clampa en 50
  assert.equal(FX.cap, 50, 'nivel 0: el tope llega a 50 y se queda (no lo rebasa)');
  assert.ok(FX.cap <= 50);
  reset(2);          // techo 18
  FX.cap = 40;       // arrancar por encima del techo del nivel
  feed(10, 3000);
  assert.ok(FX.cap <= 18, 'en nivel 2 el tope nunca supera 18');
  reset(0);
});

test('P1-g: arranque en nivel 1 en móvil de alta densidad (maxTouchPoints + dpr≥3)', () => {
  const dprBak = window.devicePixelRatio;
  window.devicePixelRatio = 3; navigator.maxTouchPoints = 1;
  Perf.init();
  assert.equal(Perf.level, 1, 'móvil hi-dpi arranca conservador');
  assert.ok(document.body.classList.contains('perf-1'));
  // En escritorio (sin táctil) arranca en 0.
  navigator.maxTouchPoints = 0; window.devicePixelRatio = dprBak || 1;
  Perf.init();
  assert.equal(Perf.level, 0);
  assert.ok(!document.body.classList.contains('perf-1'));
});

test('P0-b: ninguna ambiental de tablero anima background-position (repaint por frame)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const AMBIENT = ['board-drift', 'board-wood', 'board-ice', 'board-lava', 'board-prism', 'board-runes', 'board-scan', 'board-gold', 'board-leaf', 'board-stars'];
  for (const name of AMBIENT) {
    const m = css.match(new RegExp('@keyframes ' + name + ' \\{[^\\n]*'));
    assert.ok(m, 'debe existir @keyframes ' + name);
    assert.ok(!/background-position/.test(m[0]), name + ' no debe animar background-position');
    assert.ok(!/box-shadow|filter\s*:/.test(m[0]), name + ' no debe animar box-shadow/filter');
  }
  // El scan futurista conserva el movimiento vía transform (scroll compositado).
  assert.ok(/@keyframes board-scan \{[^\n]*translate3d/.test(css), 'board-scan debe desplazarse por transform');
  assert.ok(/\[data-board="futurista"\]::before[^{]*\{[^}]*inset:\s*-34px/.test(css), 'el pseudo futurista debe sobredimensionarse');
});

test('P0-c: special-pulse anima opacity (no box-shadow) y está en reduced-fx y perf-2', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const m = css.match(/@keyframes special-pulse \{[^\n]*/);
  assert.ok(m && /opacity/.test(m[0]), 'special-pulse debe animar opacity');
  assert.ok(!/box-shadow/.test(m[0]), 'special-pulse ya no anima box-shadow');
  assert.ok(/body\.reduced-fx \.cell\.tile-bonus::before/.test(css), 'los pulsos deben apagarse bajo reduced-fx');
  assert.ok(/body\.perf-2 \.cell\.tile-bonus::before/.test(css), 'los pulsos deben apagarse en perf-2');
  assert.ok(/body\.perf-1 \.board-wrap::before/.test(css), 'las ambientales deben apagarse en perf-1');
});

test('P1-e: existen las claves i18n de la auto-sugerencia en ES y EN', () => {
  const langBak = Settings.lang;
  for (const lang of ['es', 'en']) {
    Settings.lang = lang;
    assert.ok(I18n.t('perf_suggest').length > 5 && I18n.t('perf_suggest') !== 'perf_suggest', 'perf_suggest ' + lang);
    assert.ok(I18n.t('perf_light_on').length > 3 && I18n.t('perf_light_on') !== 'perf_light_on', 'perf_light_on ' + lang);
  }
  Settings.lang = langBak;
});

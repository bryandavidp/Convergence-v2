/* Regresión de los bugs confirmados de QP-1 (docs/QA_PERF_PLAN.md §2.1).
 * Cada test fija el comportamiento corregido de B-01..B-06; si alguien lo
 * rompe, este archivo lo grita con el identificador del bug. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Game, RunSave, Adventure, Survival, Picker, Meta } = cv;
cv.Render.buildBoard();
for (let c = 0; c < 40; c++) Meta.markAdvChapterSeen(c); // sin intros que pausen

const $q = (s) => document.querySelector(s); // mismo memo del stub que usa el juego

test('B-01: RunSave excluye Contrarreloj/Reto (guardar y cargar)', () => {
  Game.start('contrarreloj', 'normal', undefined, 123);
  RunSave.save();
  assert.equal(RunSave.load(), null, 'una run de Contrarreloj no debe guardarse');
  // Guardado RANCIO (pre-fix) de contrarreloj en disco: load() lo rechaza.
  localStorage.setItem(RunSave.KEY, JSON.stringify({
    v: 1, t: Date.now(), mode: 'contrarreloj', diff: 'normal', level: 1, seed: 1, score: 10,
    board: new Array(64).fill(null), tiles: new Array(64).fill(null), iconCount: 0,
    spawnRate: 3000, elapsed: 5, timeLeft: 40, hintsLeft: 3, mistakes: 0,
    maxCombo: 0, removedTotal: 0, emptyBoards: 0, coinsRun: 0,
  }));
  assert.equal(RunSave.load(), null, 'un guardado antiguo de Contrarreloj debe rechazarse');
  localStorage.removeItem(RunSave.KEY);
  // Control: Clásico SÍ se guarda.
  State.world = 'bosque'; State.worldLevel = 1;
  Game.start('clasico', 'normal', 1, 42);
  RunSave.save();
  assert.ok(RunSave.load(), 'Clásico debe seguir guardándose');
  RunSave.clear();
});

test('QP: Contrarreloj termina al llenarse el tablero aunque quede tiempo', () => {
  Game.start('contrarreloj', 'normal', undefined, 321);
  State.board = new Array(64).fill(State.pool[0]);
  State.tiles = new Array(64).fill(null);
  State.iconCount = 64;
  State.timeLeft = 45;
  State.status = 'playing';
  Game.doSpawn();
  assert.equal(State.status, 'over');
  assert.equal($q('#over-reason').textContent, cv.I18n.t('reason_full'));
});

test('QP: Contrarreloj termina cuando el spawn ocupa la ultima celda libre', () => {
  Game.start('contrarreloj', 'normal', undefined, 322);
  State.board = new Array(64).fill(State.pool[0]);
  State.tiles = new Array(64).fill(null);
  State.board[12] = null;
  State.iconCount = 63;
  State.timeLeft = 45;
  State.status = 'playing';
  Game.doSpawn();
  assert.equal(State.iconCount, 64);
  assert.equal(State.status, 'over');
  assert.equal($q('#over-reason').textContent, cv.I18n.t('reason_full'));
});

test('B-02: reanudar Aventura no regala los niveles de objetivo score', () => {
  Meta.advReach(3); // el nivel guardado es el máximo alcanzado (caso real)
  const mkSave = (extra) => Object.assign({
    v: 1, t: Date.now(), mode: 'aventura', diff: 'normal', level: 3, seed: 7,
    score: 5000, board: (() => { const b = new Array(64).fill(null); b[0] = 'circle_red'; b[7] = 'circle_red'; return b; })(),
    tiles: new Array(64).fill(null), iconCount: 2, spawnRate: 3000, elapsed: 100, timeLeft: 0,
    hintsLeft: 3, mistakes: 0, maxCombo: 4, removedTotal: 50, emptyBoards: 0, coinsRun: 0,
  }, extra);
  // Guardado NUEVO (con progreso del objetivo): restaura levelScore0 exacto.
  localStorage.setItem(RunSave.KEY, JSON.stringify(mkSave({ advScore0: 4800, advStart: 90 })));
  assert.ok(Game.resumeSaved());
  if (Picker.pending) Picker.cancel();
  assert.equal(Adventure.objective, 'score');
  assert.equal(Adventure.levelScore0, 4800);
  assert.notEqual(Adventure.winCheck(), 'win', '200/900 de progreso: jamás victoria instantánea');
  // Guardado ANTIGUO (sin campos): fallback conservador = el score actual es el inicio.
  localStorage.setItem(RunSave.KEY, JSON.stringify(mkSave({})));
  assert.ok(Game.resumeSaved());
  if (Picker.pending) Picker.cancel();
  assert.equal(Adventure.levelScore0, State.score);
  assert.notEqual(Adventure.winCheck(), 'win');
  RunSave.clear();
});

test('B-03: los consumibles pre-nivel de Clásico sobreviven al guardar/reanudar', () => {
  State.world = 'desierto'; State.worldLevel = 2;
  Game.start('clasico', 'normal', 2, 99);
  Survival.inv = { bomb: 1, freeze: 1 };
  RunSave.save();
  const raw = JSON.parse(localStorage.getItem(RunSave.KEY));
  assert.deepEqual(raw.inv, { bomb: 1, freeze: 1 }, 'el snapshot debe llevar el inventario');
  assert.ok(Game.resumeSaved());
  assert.equal(Survival.inv.bomb, 1);
  assert.equal(Survival.inv.freeze, 1);
  RunSave.clear();
});

test('B-04: styles.css sin backdrop-filter (regla del design system)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ''); // los comentarios pueden citar la regla
  assert.ok(!/backdrop-filter\s*:/.test(css), 'backdrop-filter está prohibido (coste de composición en iOS)');
});

test('B-05: Picker con cancelar visible y funcional (ritmo Zen y ofertas)', () => {
  State.world = 'bosque'; State.worldLevel = 1;
  Game.start('clasico', 'normal', 1, 7);
  let cancelled = 0;
  Picker.open({ title: 't', options: [{ id: 'a', name: 'A' }], cancelLabel: 'Volver', onCancel: () => cancelled++ });
  assert.equal(State.status, 'paused', 'la elección pausa la partida');
  assert.equal($q('#pick-cancel').hidden, false, 'el botón cancelar debe verse');
  Picker.cancel();
  assert.equal(cancelled, 1);
  assert.equal(State.status, 'playing', 'cancelar restaura la partida');
});

test('B-06: fin de partida con una elección abierta no deja el overlay pegado', () => {
  State.world = 'bosque'; State.worldLevel = 1;
  Game.start('clasico', 'normal', 1, 8);
  Picker.open({ title: 't', options: [{ id: 'a', name: 'A' }], onPick: () => {} });
  assert.ok(Picker.pending);
  Game.gameOver('test');
  assert.equal(Picker.pending, null, 'endGame debe descartar la elección');
  assert.equal($q('#pick-overlay').hidden, true, 'el overlay debe quedar oculto');
  // y quit() también limpia (partida nueva + picker + salida al menú)
  Game.start('clasico', 'normal', 1, 9);
  Picker.open({ title: 't', options: [{ id: 'a', name: 'A' }], onPick: () => {} });
  Game.quit();
  assert.equal(Picker.pending, null);
  assert.equal($q('#pick-overlay').hidden, true);
});

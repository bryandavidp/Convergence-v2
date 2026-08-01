/* Tests del núcleo puro de Convergence (Engine, Config, Meta, Game.starsForMistakes).
 * Ejecutar con: node --test tests/
 * game.js se carga entero sobre el stub de DOM; los módulos internos se leen del
 * hook window.__cv (activo porque el stub fija location.search = '?dev'). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Engine, Config, Game, Meta, I18n, RNG, Survival, Render } = cv;

/* ---------- utilidades ---------- */
const SIZE = Config.SIZE; // 8
function freshBoard() {
  State.size = SIZE;
  State.board = new Array(SIZE * SIZE).fill(null);
  State.tiles = new Array(SIZE * SIZE).fill(null);
  State.iconCount = 0;
}
const at = (r, c) => r * SIZE + c;
function withSurvivalRenderStub(fn) {
  const prevSyncAll = Render.syncAll;
  const prevCellPulse = Render.cellPulse;
  Render.syncAll = () => {};
  Render.cellPulse = () => {};
  try { return fn(); }
  finally {
    Render.syncAll = prevSyncAll;
    Render.cellPulse = prevCellPulse;
  }
}

/* =================================================================
 * Engine.converging — la mecánica core del juego
 * ================================================================= */

test('converging: dos iconos iguales a izquierda y derecha convergen', () => {
  freshBoard();
  State.board[at(3, 1)] = 'circle_red';
  State.board[at(3, 6)] = 'circle_red';
  const out = Engine.converging(at(3, 3));
  assert.deepEqual(out.sort((a, b) => a - b), [at(3, 1), at(3, 6)]);
});

test('converging: iconos distintos NO convergen', () => {
  freshBoard();
  State.board[at(3, 1)] = 'circle_red';
  State.board[at(3, 6)] = 'star_blue';
  assert.equal(Engine.converging(at(3, 3)).length, 0);
});

test('converging: solo cuenta el icono MÁS CERCANO de cada dirección', () => {
  freshBoard();
  // En la fila: [.., star, circle, VACÍA, circle, ..] — los star quedan tapados.
  State.board[at(3, 0)] = 'star_blue';
  State.board[at(3, 2)] = 'circle_red';   // más cercano por la izquierda
  State.board[at(3, 5)] = 'circle_red';   // más cercano por la derecha
  const out = Engine.converging(at(3, 3));
  assert.deepEqual(out.sort((a, b) => a - b), [at(3, 2), at(3, 5)]);
});

test('converging: convergencia en las 4 direcciones elimina 4 iconos', () => {
  freshBoard();
  State.board[at(0, 3)] = 'heart_pink';
  State.board[at(7, 3)] = 'heart_pink';
  State.board[at(3, 0)] = 'heart_pink';
  State.board[at(3, 7)] = 'heart_pink';
  assert.equal(Engine.converging(at(3, 3)).length, 4);
});

test('converging: un tile sólido corta la línea de visión', () => {
  freshBoard();
  State.board[at(3, 1)] = 'circle_red';
  State.board[at(3, 6)] = 'circle_red';
  State.tiles[at(3, 2)] = { id: 'rock', solid: true };  // entre la vacía y el icono izquierdo
  assert.equal(Engine.converging(at(3, 3)).length, 0, 'la roca debe ocultar el icono izquierdo');
});

test('converging: no se activa sobre celda ocupada ni sobre tile sólido/trigger', () => {
  freshBoard();
  State.board[at(3, 1)] = 'circle_red';
  State.board[at(3, 5)] = 'circle_red';
  State.board[at(3, 3)] = 'star_blue';                       // ocupada
  assert.equal(Engine.converging(at(3, 3)).length, 0);
  State.board[at(3, 3)] = null;
  State.tiles[at(3, 3)] = { id: 'rock', solid: true };        // sólida
  assert.equal(Engine.converging(at(3, 3)).length, 0);
  State.tiles[at(3, 3)] = { id: 'bonus', trigger: 'bonus' };  // trigger
  assert.equal(Engine.converging(at(3, 3)).length, 0);
});

test('hasMoves: detecta cuando existe/no existe jugada', () => {
  freshBoard();
  assert.equal(Engine.hasMoves(), false);
  State.board[at(0, 0)] = 'circle_red';
  State.board[at(0, 7)] = 'circle_red';
  assert.equal(Engine.hasMoves(), true);
});

/* =================================================================
 * Pools de iconos — invariante anti-confusión
 * ================================================================= */

test('varietyFor: crece 1 cada 3 niveles, piso 4, techo 8', () => {
  assert.equal(Engine.varietyFor(1), 4);
  assert.equal(Engine.varietyFor(3), 4);
  assert.equal(Engine.varietyFor(4), 5);
  assert.equal(Engine.varietyFor(13), 8);
  assert.equal(Engine.varietyFor(999), 8);
});

test('poolForLevel: tamaño correcto y SIN formas repetidas (invariante anti-confusión)', () => {
  for (let level = 1; level <= 60; level++) {
    const pool = Engine.poolForLevel(level);
    assert.equal(pool.length, Engine.varietyFor(level), `nivel ${level}: tamaño de pool`);
    const shapes = pool.map((id) => id.split('_')[0]);
    assert.equal(new Set(shapes).size, shapes.length,
      `nivel ${level}: dos iconos con la misma forma en el pool (${shapes.join(',')})`);
    assert.equal(new Set(pool).size, pool.length, `nivel ${level}: icono duplicado exacto`);
  }
});

test('poolForLevel: niveles consecutivos comparten n-1 iconos (ventana deslizante)', () => {
  const a = new Set(Engine.poolForLevel(10));
  const b = Engine.poolForLevel(11);
  const shared = b.filter((id) => a.has(id)).length;
  assert.ok(shared >= Math.min(a.size, b.length) - 1, 'la ventana debe avanzar de 1 en 1');
});

/* =================================================================
 * Clear-assist (sesgo anti-frustración del spawn)
 * ================================================================= */

test('_pickSpawnId: con el tablero casi vacío sesga hacia el icono solitario', () => {
  freshBoard();
  State.pool = Engine.poolForLevel(1);           // 4 iconos
  const lonely = State.pool[0];
  State.board[at(0, 0)] = lonely;
  State.iconCount = 1;                            // p = pMax = 0.9
  let hits = 0;
  const N = 400;
  for (let i = 0; i < N; i++) if (Engine._pickSpawnId() === lonely) hits++;
  // Esperado ≈ p + (1-p)/pool = 0.9 + 0.1/4 ≈ 0.925. Margen amplio anti-flaky.
  assert.ok(hits / N > 0.7, `sesgo insuficiente: ${hits}/${N}`);
});

test('_pickSpawnId: por encima del umbral el spawn es aleatorio del pool', () => {
  freshBoard();
  State.pool = Engine.poolForLevel(1);
  State.iconCount = Config.CLEAR_ASSIST.threshold + 5;   // sin sesgo
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(Engine._pickSpawnId());
  assert.ok(seen.size >= 3, 'debería muestrear varios iconos distintos del pool');
});

/* =================================================================
 * Refill tras tablero limpio en modos sin fin por vaciado
 * ================================================================= */

test('emptyRefillTarget: escala por dificultad y cadena de tableros limpios', () => {
  freshBoard();
  State.mode = 'zen';
  State.diff = 'facil';
  assert.equal(Engine.emptyRefillTarget(1), 10);

  State.diff = 'dificil';
  assert.equal(Engine.emptyRefillTarget(1), 13);

  State.mode = 'contrarreloj';
  State.diff = 'normal';
  assert.equal(Engine.emptyRefillTarget(1), 12);
  assert.equal(Engine.emptyRefillTarget(3), 18);
  assert.equal(Engine.emptyRefillTarget(99), 24);
});

test('refillAfterEmpty: repuebla equilibrado y deja al menos una jugada', () => {
  freshBoard();
  RNG.seed('empty-refill-balanced');
  State.mode = 'contrarreloj';
  State.diff = 'normal';
  State.level = 1;
  State.pool = Engine.poolForLevel(1);

  const target = Engine.emptyRefillTarget(1);
  const placed = Engine.refillAfterEmpty(1);
  assert.equal(placed.length, target);
  assert.equal(State.iconCount, target);
  assert.equal(Engine.hasMoves(), true, 'el refill debe sembrar una convergencia posible');

  const counts = State.board.filter(Boolean).reduce((acc, id) => {
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
  const values = Object.values(counts);
  assert.ok(values.length >= 3, 'debe usar varios iconos del pool');
  assert.ok(Math.max(...values) <= Math.ceil(target / values.length) + 2, 'la distribucion no debe concentrarse en un solo icono');
});

test('refillAfterEmpty: respeta tiles y sigue jugable con obstaculos', () => {
  freshBoard();
  RNG.seed('empty-refill-obstacles');
  State.mode = 'supervivencia';
  State.diff = 'dificil';
  State.level = 8;
  State.pool = Engine.poolForLevel(State.level);
  for (let r = 0; r < SIZE; r++) State.tiles[at(r, 3)] = { type: 'rock', solid: true };

  const placed = Engine.refillAfterEmpty(2);
  assert.ok(placed.length > 0, 'debe colocar iconos aunque haya obstaculos');
  assert.ok(placed.every((idx) => !State.tiles[idx]), 'no debe colocar iconos sobre tiles');
  assert.equal(Engine.hasMoves(), true, 'el tablero repoblado debe ser continuable');
});

test('supervivencia: bombas limitadas a dos o tres en pantalla', () => {
  freshBoard();
  State.mode = 'supervivencia';
  State.level = 1;
  State.pool = Engine.poolForLevel(1);
  Survival.wave = 12;

  State.diff = 'normal';
  RNG.seed('surv-bomb-cap-normal');
  withSurvivalRenderStub(() => Survival._placeBombs(10));
  assert.equal(Survival._bombIdx().length, 2);

  freshBoard();
  State.mode = 'supervivencia';
  State.diff = 'dificil';
  State.pool = Engine.poolForLevel(1);
  RNG.seed('surv-bomb-cap-hard');
  withSurvivalRenderStub(() => Survival._placeBombs(10));
  assert.equal(Survival._bombIdx().length, 3);
});

test('supervivencia: especiales de oleada no cuentan como iconos de relleno', () => {
  freshBoard();
  State.mode = 'supervivencia';
  State.diff = 'facil';
  State.level = 1;
  State.pool = Engine.poolForLevel(1);
  Survival.wave = 9;
  Survival.mut = { id: 'none' };
  RNG.seed('surv-trap-budget');

  withSurvivalRenderStub(() => Survival._traps(1));

  assert.equal(State.iconCount, 0, 'los especiales nuevos no deben sumar iconos ocultos');
  assert.ok(Survival._specialIdx().length > 0, 'debe colocar alguna trampa de oleada');
  assert.ok(Survival._specialIdx().length <= Survival._specialCap(), 'debe respetar el presupuesto total de especiales');
});

test('supervivencia: bloqueos escalan de uno a dos toques por dificultad', () => {
  State.diff = 'facil'; Survival.wave = 8; assert.equal(Survival._blockHits(), 1);
  State.diff = 'facil'; Survival.wave = 9; assert.equal(Survival._blockHits(), 2);
  State.diff = 'normal'; Survival.wave = 6; assert.equal(Survival._blockHits(), 1);
  State.diff = 'normal'; Survival.wave = 7; assert.equal(Survival._blockHits(), 2);
  State.diff = 'dificil'; Survival.wave = 4; assert.equal(Survival._blockHits(), 1);
  State.diff = 'dificil'; Survival.wave = 5; assert.equal(Survival._blockHits(), 2);
});

/* =================================================================
 * Config: tablas de combo y constantes de balance
 * ================================================================= */

test('COMBO_MULTIPLIERS: tabla exacta y ordenada descendente', () => {
  assert.deepEqual(Config.COMBO_MULTIPLIERS, [[30, 10], [20, 8], [15, 5], [10, 3], [6, 2], [3, 1.5]]);
  const thresholds = Config.COMBO_MULTIPLIERS.map(([t]) => t);
  assert.deepEqual([...thresholds].sort((a, b) => b - a), thresholds, 'debe evaluarse de mayor a menor');
});

test('MILESTONES y constantes de balance intactas', () => {
  assert.deepEqual(Config.MILESTONES, { 10: 500, 20: 1000, 30: 2000 });
  assert.equal(Config.EMPTY_BOARD_BONUS, 500);
  assert.equal(Config.FEVER_COMBO, 10);
  assert.equal(Config.FEVER_BOOST, 1.25);
  assert.equal(Config.TIMED_START, 60);
  assert.equal(Config.TIMED_CAP, 90);
  assert.deepEqual(Config.TIMED_GAIN, { base: 0.9, perIcon: 0.6, combo: 0.32, comboCap: 4, decaySec: 125, minDecay: 0.08 });
});

test('DIFFICULTY: los tres tiers con sus 6 parámetros', () => {
  for (const d of ['facil', 'normal', 'dificil']) {
    const t = Config.DIFFICULTY[d];
    for (const k of ['initialIcons', 'comboWindow', 'spawnStart', 'spawnMin', 'scoreMult', 'penaltyBase']) {
      assert.ok(k in t, `DIFFICULTY.${d}.${k} debe existir`);
    }
  }
  assert.equal(Config.DIFFICULTY.facil.comboWindow, 5000);
  assert.equal(Config.DIFFICULTY.dificil.spawnMin, 900);
});

/* =================================================================
 * Fórmulas de progresión
 * ================================================================= */

test('spawnRateForLevel: decae 5% por nivel con piso spawnMin', () => {
  State.diff = 'normal';
  State.mode = 'clasico';
  assert.equal(Engine.spawnRateForLevel(1), 5000);
  assert.equal(Engine.spawnRateForLevel(2), Math.round(5000 * 0.95));
  assert.equal(Engine.spawnRateForLevel(100), Config.DIFFICULTY.normal.spawnMin);
});

test('starsForMistakes: 0→3★, ≤2→2★, más→1★ (STAR_ERR=[0,2])', () => {
  assert.equal(Game.starsForMistakes(0), 3);
  assert.equal(Game.starsForMistakes(1), 2);
  assert.equal(Game.starsForMistakes(2), 2);
  assert.equal(Game.starsForMistakes(3), 1);
  assert.equal(Game.starsForMistakes(99), 1);
});

test('Meta.xpForLevel: curva lineal 300 + (lvl-1)*250', () => {
  assert.equal(Meta.xpForLevel(1), 300);
  assert.equal(Meta.xpForLevel(2), 550);
  assert.equal(Meta.xpForLevel(10), 300 + 9 * 250);
});

/* =================================================================
 * i18n: paridad de claves ES/EN
 * ================================================================= */

test('I18n.DICT: paridad de claves ES/EN', () => {
  const es = Object.keys(I18n.DICT.es).sort();
  const en = Object.keys(I18n.DICT.en).sort();
  // Toda clave ES debe tener traducción EN.
  const missingEn = es.filter((k) => !en.includes(k));
  assert.deepEqual(missingEn, [], `claves sin traducción EN: ${missingEn.join(', ')}`);
  // Claves solo-EN permitidas por diseño: los textos de modo/bioma en español viven
  // embebidos en Config.MODES/Adventure.BIOMES y solo el inglés va al diccionario
  // (claves derivadas m_{modo}_{n|d|g} y biome_*). Cualquier otra clave solo-EN es un olvido.
  const allowedEnOnly = /^(m_[a-z]+_(n|d|g)|biome_[a-z]+)$/;
  const missingEs = en.filter((k) => !es.includes(k) && !allowedEnOnly.test(k));
  assert.deepEqual(missingEs, [], `claves sin traducción ES: ${missingEs.join(', ')}`);
});

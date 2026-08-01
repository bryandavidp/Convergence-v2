/* Regresión de los bugs de tablero reportados (v2.34.x):
 *   S1: un icono eliminado "no desaparece" — en realidad un spawn/relleno caía en la
 *       celda recién vaciada en el mismo tick, a veces con el MISMO icono (medido en
 *       vivo: relleno idéntico 7-11ms después de eliminar). Corrección: celdas
 *       "calientes" (Engine.noteHot) que spawns y rellenos evitan mientras haya
 *       alternativa, sin cambiar jamás el número de iconos colocados.
 *   S1b: glifo fantasma si animationend nunca llega en Render.clearAnim sin target.
 *   S3: el relleno post-tablero-limpio entra en cascada retardada (Render.refillAnim)
 *       para distinguirse de los spawns normales. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Engine, Game, Render } = cv;
Render.buildBoard();

function boardReset() {
  State.board = new Array(64).fill(null);
  State.tiles = new Array(64).fill(null);
  State.iconCount = 0;
  Engine.resetHot();
}

test('S1: spawnOne evita la celda recién vaciada mientras haya alternativa', () => {
  Game.start('contrarreloj', 'normal', undefined, 900);
  boardReset();
  // Solo dos huecos: el 10 (caliente) y el 53 (frío) — el resto ocupado.
  for (let i = 0; i < 64; i++) if (i !== 10 && i !== 53) { State.board[i] = State.pool[0]; State.iconCount++; }
  Engine.noteHot([10]);
  for (let k = 0; k < 12; k++) {
    const idx = Engine.spawnOne();
    assert.equal(idx, 53, 'con alternativa fría, el spawn nunca cae en la celda caliente');
    State.board[53] = null; State.iconCount--;
  }
});

test('S1: spawnOne SÍ usa la celda caliente si es la única (el overflow no cambia)', () => {
  Game.start('contrarreloj', 'normal', undefined, 901);
  boardReset();
  for (let i = 0; i < 64; i++) if (i !== 10) { State.board[i] = State.pool[0]; State.iconCount++; }
  Engine.noteHot([10]);
  assert.equal(Engine.spawnOne(), 10, 'sin alternativa, la celda caliente sigue siendo válida');
  // Y con el tablero lleno, sigue devolviendo -1.
  assert.equal(Engine.spawnOne(), -1);
});

test('S1: el calor caduca (ventana corta) y no envenena partidas posteriores', () => {
  Game.start('contrarreloj', 'normal', undefined, 902);
  boardReset();
  Engine.noteHot([10]);
  assert.ok(Engine._isHot(10), 'recién marcada = caliente');
  // Timestamp "futuro" (p. ej. reloj virtual reiniciado entre runs del sim): no es caliente.
  Engine._hotCells[20] = globalThis.performance.now() + 1e6;
  assert.ok(!Engine._isHot(20), 'una marca con t futuro se trata como rancia');
  // placeInitial (cada tablero nuevo) limpia el mapa entero.
  Engine.placeInitial(0);
  assert.ok(!Engine._isHot(10), 'placeInitial resetea el calor');
});

test('S1/S3: el relleno NO evita celdas calientes (su legibilidad la da la cascada) y su total no cambia', () => {
  Game.start('zen', 'normal', undefined, 903);
  boardReset();
  // Aunque TODO el tablero esté marcado caliente, la geometría y el total del
  // relleno son EXACTAMENTE los de siempre (guardarraíl de balance: evitar celdas
  // aquí costaba −12% de score del bot estándar).
  Engine.noteHot(Array.from({ length: 64 }, (_, i) => i));
  const target = Engine.emptyRefillTarget(1);
  const placed = Engine.refillAfterEmpty(1);
  assert.equal(placed.length, target, 'el calor no altera el número de iconos del relleno');
});

test('S1 (integración): converger la última pareja rellena en el mismo tick y marca calor para spawns', () => {
  Game.start('zen', 'normal', undefined, 905);
  boardReset();
  State.status = 'playing';
  // Pareja del mismo icono a ambos lados de la casilla 28: única jugada.
  const id = State.pool[0];
  State.board[27] = id; State.board[29] = id; State.iconCount = 2;
  Render.syncAll();
  Game.activate(28);
  // Zen es endless: evaluate → emptyBoardBonus → refill síncrono en el MISMO tick.
  assert.ok(State.iconCount > 0, 'el bonus de tablero vacío rellenó');
  // Las celdas de la convergencia y el punto tocado quedan calientes: el próximo
  // spawn ORGÁNICO no caerá ahí mientras haya alternativa.
  assert.ok(Engine._isHot(27) && Engine._isHot(29) && Engine._isHot(28), 'conv + punto tocado marcados calientes');
});

test('S1b: clearAnim sin target borra el glifo aunque animationend nunca llegue', async () => {
  Game.start('contrarreloj', 'normal', undefined, 906);
  boardReset();
  State.board[12] = State.pool[0]; State.iconCount = 1;
  Render.syncAll();
  assert.equal(Render._cellId[12], State.pool[0]);
  // Eliminación especial (sin target): board se vacía y clearAnim confía en la
  // animación de salida. En el stub animationend jamás dispara (como una pestaña
  // oculta o una animación cancelada): el cinturón setTimeout debe limpiar igual.
  State.board[12] = null; State.iconCount = 0;
  Render.clearAnim([12]);
  await new Promise((res) => setTimeout(res, 620));
  assert.equal(Render._cellId[12], null, 'sin animationend, el glifo fantasma debe borrarse igualmente');
});

test('S3: el relleno usa refillAnim (cascada) y la función tolera cualquier celda', () => {
  assert.equal(typeof Render.refillAnim, 'function');
  // No debe lanzar con celdas válidas ni con glyphs sin animate.
  Render.refillAnim(0, 0);
  Render.refillAnim(63, 700);
});

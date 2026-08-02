/* Contrato entre game.js y el núcleo de reglas del navegador.
 *
 * `game.js` lee constantes y funciones del núcleo con el patrón
 * `GameCore.ready() ? GameCore.core.X : <expresión histórica>`. El fallback solo
 * cubre que el núcleo NO esté cargado; si está cargado pero le falta `X`, la
 * rama del núcleo devuelve `undefined` y la aritmética que venga después produce
 * `NaN` en silencio.
 *
 * Eso pasó de verdad: `BONUS_TILE_POINTS` nunca llegó a existir en
 * `@convergence/game-core` y llegó a producción. Tocar una casilla bonus hacía
 * `State.score += undefined` y el marcador se quedaba en NaN el resto de la
 * partida. Los tests de puntuación no lo vieron porque ninguno tocaba esa
 * casilla, y el de wiring solo comprobaba el fichero generado como texto.
 *
 * Este test no comprueba valores: comprueba que **todo lo que game.js pide al
 * núcleo existe en el núcleo**. Es barato y cubre el fallo entero de la familia.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game-core.js');

const core = globalThis.window.ConvergenceGameCore;
const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

/** Todo lo que game.js consume del núcleo, deducido del propio código. */
function referencedMembers() {
  const matches = source.matchAll(/GameCore\.core\.([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...new Set([...matches].map((match) => match[1]))].sort();
}

test('el núcleo del navegador se carga y se expone', () => {
  assert.ok(core, 'game-core.js debe publicar window.ConvergenceGameCore');
});

test('game.js no pide al núcleo nada que el núcleo no tenga', () => {
  const referenced = referencedMembers();
  assert.ok(referenced.length > 0, 'se esperaba encontrar referencias al núcleo');

  const missing = referenced.filter((name) => core[name] === undefined);
  assert.deepEqual(
    missing,
    [],
    `game.js lee del núcleo miembros que no existen: ${missing.join(', ')}. `
    + 'La rama del núcleo devolvería undefined y la puntuación se volvería NaN.',
  );
});

test('ninguna constante numérica del núcleo llega como NaN o no finita', () => {
  const referenced = referencedMembers();
  for (const name of referenced) {
    const value = core[name];
    if (typeof value !== 'number') continue;
    assert.ok(
      Number.isFinite(value),
      `${name} no es un número finito (${value}): contaminaría el marcador`,
    );
  }
});

test('la casilla bonus suma un valor real y no rompe el marcador', () => {
  // Regresión directa del bug: la suma que ejecuta game.js al tocar la casilla.
  assert.equal(core.BONUS_TILE_POINTS, 30);
  assert.equal(1000 + core.BONUS_TILE_POINTS, 1030);
});

/* JF-ζ (docs/BOSS_SYSTEM_MASTER_PLAN.md §6): adaptador de presentación del jefe de
 * bioma en Aventura. Cero cambio de reglas (GM-08 intacto); lo que se prueba es la
 * identidad (nombres/epítetos i18n), la fase 2 gated (BOSS_MS 20s→15s con ≤2
 * cristales) y que el banner de objetivo pinta la cara del jefe en niveles jefe. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Adventure, I18n } = cv;
cv.Render.buildBoard();

test('JF-ζ: los 6 biomas tienen nombre y epíteto en ES y EN', () => {
  for (const b of Adventure.BIOMES) {
    for (const lang of ['es', 'en']) {
      assert.ok(I18n.DICT[lang]['advdex_' + b.id], `falta advdex_${b.id} en ${lang}`);
      assert.ok(I18n.DICT[lang]['advdex_' + b.id + '_e'], `falta advdex_${b.id}_e en ${lang}`);
    }
  }
});

test('JF-ζ: cada nivel jefe (licOf===4) resuelve a un bioma con identidad', () => {
  // isBoss = último nivel del capítulo; recorre 3 capítulos.
  for (const level of [5, 10, 15]) {
    assert.equal(Adventure.isBoss(level), true, `nivel ${level} es jefe`);
    const b = Adventure.biomeOf(level);
    assert.ok(I18n.t('advdex_' + b.id), `el jefe del nivel ${level} tiene nombre`);
  }
});

test('JF-52: fase 2 del jefe de bioma — el reloj de ataque acelera 20s→15s con ≤2 cristales (gated B-J6)', () => {
  const prevBoard = State.board, prevTiles = State.tiles;
  State.board = new Array(64).fill(null);
  State.tiles = new Array(64).fill(null);
  try {
    // 4 cristales: reloj normal.
    for (let i = 0; i < 4; i++) State.tiles[i] = cv.Tiles.make('crystal');
    assert.equal(Adventure.crystalsLeft(), 4);
    assert.equal(Adventure._bossMsFor(), Adventure.BOSS_MS, '4 cristales: 20s');
    // Bajar a 2: fase 2.
    State.tiles[0] = null; State.tiles[1] = null;
    assert.equal(Adventure.crystalsLeft(), 2);
    assert.equal(Adventure._bossMsFor(), 15000, '≤2 cristales: 15s');
  } finally { State.board = prevBoard; State.tiles = prevTiles; }
});

test('JF-ζ: el banner de objetivo pinta la cara del jefe SOLO en niveles jefe', () => {
  const prevMode = State.mode, prevLevel = State.level;
  const prevBoard = State.board, prevTiles = State.tiles;
  State.board = new Array(64).fill(null);
  State.tiles = new Array(64).fill(null);
  State.mode = 'aventura';
  try {
    // Nivel jefe (5): banner con la cara.
    State.level = 5;
    Adventure.objective = 'boss';
    Adventure.banner(5);
    const banner = document.querySelector('#obj-banner');
    assert.ok(/obj-boss-face/.test(banner.innerHTML), 'nivel jefe: cara presente');
    assert.ok(banner.innerHTML.includes(I18n.t('advdex_' + Adventure.biomeOf(5).id)), 'nombre del jefe en el banner');
    // Nivel normal (1): sin cara.
    State.level = 1;
    Adventure.objective = 'clear';
    Adventure.banner(1);
    assert.ok(!/obj-boss-face/.test(banner.innerHTML), 'nivel normal: sin cara de jefe');
  } finally {
    State.mode = prevMode; State.level = prevLevel;
    State.board = prevBoard; State.tiles = prevTiles;
  }
});

test('JF-ζ: los jefes de bioma NO usan el bestiario de Supervivencia (exclusividad de modo)', () => {
  // advdex_* son claves nuevas; NO deben colisionar con bossdex_* de Supervivencia.
  for (const b of Adventure.BIOMES) {
    assert.equal(cv.Bosses.DEX[b.id] === undefined || b.id === 'void' || b.id === 'crystal', true,
      'los ids de bioma pueden coincidir por nombre pero el registro Bosses.DEX es de Supervivencia');
  }
  // El punto real: la identidad de Aventura vive en advdex_*, separada de bossdex_*.
  assert.notEqual(I18n.t('advdex_void'), I18n.t('bossdex_void'), 'La Nada (Aventura) ≠ El Vacío (Supervivencia)');
});

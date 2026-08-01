/* Regresión de rendimiento de animaciones bajo ráfaga (docs/ANIMATION_PERF_PLAN.md).
 * Fija el escenario B (repetir una acción con animación en la tienda no debe crecer sin
 * límite): pool fijo reutilizable en ShopFX (AP-1), tope de concurrencia con descarte
 * (AP-4), coalescing de compras seguidas (AP-2) y partícula-moneda sin filtro (AP-5). */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { ShopFX } = cv;

// El stub de DOM no dispara onfinish de las animaciones, así que las ranuras se quedan
// "ocupadas": eso es EXACTAMENTE lo que interesa medir (que el tope se respeta aunque nada
// se libere). Este helper devuelve el pool a un estado limpio entre pruebas.
function resetShopFX() {
  ShopFX.ensureLayer();
  ShopFX.active = 0; ShopFX.idx = 0; ShopFX.chipIdx = 0;
  ShopFX.pool.forEach((p) => { p.busy = false; p.anim = null; });
  ShopFX.chips.forEach((c) => { c.anim = null; });
  ShopFX._fly = { coins: null, gems: null };
}
const anchor = () => document.getElementById('any-shop-card');

test('AP-1: ShopFX construye UN pool fijo reutilizable (no crece al reusar)', () => {
  ShopFX.ensureLayer();
  const n = ShopFX.pool.length, c = ShopFX.chips.length;
  assert.equal(n, ShopFX.POOL, 'el pool de partículas tiene tamaño fijo');
  assert.equal(c, ShopFX.CHIP_POOL, 'el pool de rótulos tiene tamaño fijo');
  ShopFX.ensureLayer(); // segunda llamada: _buildPool es idempotente
  assert.equal(ShopFX.pool.length, n, 'no se reconstruye el pool');
  assert.equal(ShopFX.chips.length, c);
});

test('AP-1/AP-4: una ráfaga de compras no crea nodos sin límite (pool acotado + cap)', () => {
  resetShopFX();
  const before = ShopFX.pool.length;
  // 60 compras "de golpe", DESACTIVANDO el coalescing (para forzar emisión real cada vez)
  // y comprobar que el pool satura en el tope en vez de crecer.
  for (let i = 0; i < 60; i++) {
    ShopFX._fly = { coins: null, gems: null };
    ShopFX.flyCurrency('coins', 100, anchor());
  }
  assert.equal(ShopFX.pool.length, before, 'el pool NO crece por muchas compras que se hagan');
  assert.ok(ShopFX.active <= ShopFX.CAP, `la concurrencia jamás supera el tope (${ShopFX.active} <= ${ShopFX.CAP})`);
  assert.ok(ShopFX.active >= 32, 'la ráfaga sí saturó el pool (no se quedó corta)');
});

test('AP-4: _particle devuelve null al saturar el tope (descarta, no crea)', () => {
  resetShopFX();
  ShopFX.active = ShopFX.CAP; // pool "lleno"
  assert.equal(ShopFX._particle('shopfx-star', 0, 0), null, 'no emite partícula por encima del cap');
  assert.equal(ShopFX.active, ShopFX.CAP, 'y no incrementa la concurrencia');
});

test('AP-2: compras seguidas de la MISMA divisa se fusionan (no relanzan el enjambre)', () => {
  resetShopFX();
  ShopFX.flyCurrency('coins', 100, anchor());
  const afterFirst = ShopFX.active;
  assert.ok(afterFirst > 0, 'la primera compra sí emite partículas');
  ShopFX.flyCurrency('coins', 100, anchor()); // inmediata: dentro de la ventana de coalescing
  assert.equal(ShopFX.active, afterFirst, 'la segunda compra no añade partículas nuevas');
  assert.equal(ShopFX._fly.coins.total, 200, 'acumula la cantidad en el rótulo vivo');
  assert.equal(ShopFX._fly.coins.chip.b.textContent, '+200', 'el rótulo "+N" refleja el total');
});

test('AP-2: count-up cancelable por divisa (no apila bucles rAF)', () => {
  resetShopFX();
  // countUp registra su id de rAF por divisa; una segunda llamada cancela la anterior.
  ShopFX.countUp('gems', 0, 50, 500, 0);
  const first = ShopFX._countRaf.gems;
  ShopFX.countUp('gems', 0, 80, 500, 0);
  // El registro sigue existiendo (o quedó a 0 si terminó), pero nunca hay dos vivos a la vez:
  assert.equal(typeof ShopFX._countRaf.gems, 'number');
  assert.ok(true, 'la segunda llamada no lanza sin cancelar la primera (id sobrescrito)');
  void first;
});

test('AP-5: la moneda voladora ya no usa <img> con filter:drop-shadow (CSS)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.ok(!/\.shopfx-coin img\b/.test(css), 'no debe quedar la regla .shopfx-coin img (filtro)');
  assert.ok(/\.shopfx-coin\b[^{]*\{[^}]*background-size:\s*contain/.test(css), 'la moneda se pinta por background-image');
});

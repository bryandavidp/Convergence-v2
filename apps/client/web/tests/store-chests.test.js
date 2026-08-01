'use strict';

// Contrato de la sección "Cofres" de la tienda de recursos: compra directa de
// cofres con gemas. El cofre de evento NO se vende (solo se gana jugando).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Meta, Storefront, CHEST_TYPES, CHEST_TYPE_ORDER } = cv;
const root = path.join(__dirname, '..');

function metaSnapshot() { return JSON.parse(JSON.stringify(Meta.state)); }
function restoreMeta(snapshot) {
  const state = Meta.state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, JSON.parse(JSON.stringify(snapshot)));
  localStorage.setItem('cv_meta', JSON.stringify(state));
}
function withRestoredMeta(run) {
  const snapshot = metaSnapshot();
  try { return run(); }
  finally { restoreMeta(snapshot); }
}

test('CHEST_OFFERS: vende todos los cofres menos el de evento, con precios crecientes', () => {
  const offers = Storefront.CHEST_OFFERS;
  const sellable = CHEST_TYPE_ORDER.filter((id) => id !== 'event');
  assert.equal(offers.length, sellable.length, 'debe haber una oferta por cada cofre vendible');
  assert.deepEqual(offers.map((o) => o.id), sellable, 'las ofertas siguen el orden de rareza sin el cofre de evento');
  assert.ok(!offers.some((o) => o.id === 'event'), 'el cofre de evento no puede estar en la tienda');
  offers.forEach((o) => {
    assert.ok(CHEST_TYPES[o.id], `${o.id} debe ser un tipo de cofre válido`);
    assert.ok(Number.isInteger(o.gemCost) && o.gemCost > 0, `${o.id} debe costar gemas enteras positivas`);
  });
  for (let i = 1; i < offers.length; i++) {
    assert.ok(offers[i].gemCost > offers[i - 1].gemCost, `el precio de ${offers[i].id} debe superar al anterior`);
  }
});

test('buyChest: descuenta gemas y añade exactamente el cofre comprado', () => {
  withRestoredMeta(() => {
    Meta.state.gems = 100000;
    Storefront.CHEST_OFFERS.forEach((offer) => {
      const gemsBefore = Meta.gems();
      const chestsBefore = Meta.chests();
      const invBefore = Meta.chestInventory().length;
      const result = Storefront.buyChest(offer.id);
      assert.equal(result && result.status, 'paid', `comprar ${offer.id} debe liquidarse`);
      assert.equal(Meta.gems(), gemsBefore - offer.gemCost, `${offer.id} descuenta su coste en gemas`);
      assert.equal(Meta.chests(), chestsBefore + 1, `${offer.id} suma un cofre al contador`);
      const inv = Meta.chestInventory();
      assert.equal(inv.length, invBefore + 1, `${offer.id} añade un cofre al inventario`);
      assert.equal(inv[inv.length - 1].type, offer.id, `el cofre añadido es del tipo comprado (${offer.id})`);
      assert.equal(inv[inv.length - 1].source, 'shop', 'el cofre queda marcado como comprado en tienda');
    });
  });
});

test('buyChest: el cofre de evento y los ids inválidos no se venden', () => {
  withRestoredMeta(() => {
    Meta.state.gems = 100000;
    const chestsBefore = Meta.chests();
    const gemsBefore = Meta.gems();
    assert.equal(Storefront.buyChest('event'), null, 'el cofre de evento no se vende');
    assert.equal(Storefront.buyChest('nope'), null, 'un id desconocido no se vende');
    assert.equal(Meta.chests(), chestsBefore, 'ningún intento inválido añade cofres');
    assert.equal(Meta.gems(), gemsBefore, 'ningún intento inválido gasta gemas');
  });
});

test('buyChest: sin gemas suficientes se rechaza sin gastar ni entregar cofre', () => {
  withRestoredMeta(() => {
    Meta.state.gems = 5;
    const chestsBefore = Meta.chests();
    const result = Storefront.buyChest('divine');
    assert.equal(result && result.status, 'declined');
    assert.equal(result.reason, 'insufficient-gems');
    assert.equal(Meta.gems(), 5, 'no se descuentan gemas en una compra rechazada');
    assert.equal(Meta.chests(), chestsBefore, 'no se entrega cofre en una compra rechazada');
  });
});

test('la vista de la tienda de recursos monta la sección de cofres y la renderiza', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const resourceView = html.slice(html.indexOf('id="view-resource-shop"'), html.indexOf('id="view-shop"'));
  assert.match(resourceView, /class="resource-section resource-section-chests"/, 'la tienda de recursos debe incluir la sección de cofres');
  assert.match(resourceView, /id="chest-offers"/, 'debe existir el contenedor de ofertas de cofres');
  assert.match(js, /function chestOfferCard\(offer\)/, 'debe existir el renderer de tarjetas de cofre');
  assert.match(js, /Storefront\.CHEST_OFFERS\.map\(chestOfferCard\)/, 'buildResourceShop debe pintar las ofertas de cofres');
  assert.match(js, /\[data-chest-offer\][\s\S]*Storefront\.buyChest/, 'el handler de compra de cofres debe invocar Storefront.buyChest');
});

test('la pantalla de cofres enlaza la tienda y ofrece comprar o jugar cuando está vacía', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const chestView = html.slice(html.indexOf('id="view-chests"'), html.indexOf('id="view-multi"'));
  assert.match(chestView, /class="chest-shop-shortcut"[^>]+data-act="open-chest-shop"/);
  assert.match(chestView, /id="chest-empty-actions"[^>]+hidden/);
  assert.match(chestView, /data-act="open-chest-shop"[\s\S]*data-act="chest-play"/);
  assert.match(js, /openResourceShop\('chests'\)/);
  assert.match(js, /focusKind === 'chests' \? '#resource-chests-title'/);
  assert.match(js, /classList\.toggle\('is-empty', n === 0\)/);
  assert.match(css, /\.view-chests\.is-empty \.chest-main-actions \{ display: none; \}/);
});

test('claves i18n de la tienda de cofres presentes en ES y EN', () => {
  const dict = cv.I18n.DICT;
  ['resource_shop_chests', 'chest_shop_title', 'chest_shop_desc', 'chest_shop_buy', 'chest_shop_add', 'chest_shop_bought', 'chest_store_shortcut', 'empty_chests_pitch', 'empty_chests_buy', 'empty_chests_play'].forEach((key) => {
    assert.ok(dict.es[key], `falta la clave ${key} en ES`);
    assert.ok(dict.en[key], `falta la clave ${key} en EN`);
  });
});

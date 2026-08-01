'use strict';

// Contrato de la tienda de recursos + booster temporal de XP.
// Esta suite mantiene el booster de XP separado de los potenciadores jugables
// (bomb/freeze/etc.) y restaura Meta por completo tras cada prueba mutante.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { Meta, I18n, State, Game, RunSave, Render, Loop, Survival } = cv;
const Storefront = cv.Storefront;
const root = path.join(__dirname, '..');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function metaSnapshot() {
  return JSON.parse(JSON.stringify(Meta.state));
}

function restoreMeta(snapshot) {
  const state = Meta.state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, JSON.parse(JSON.stringify(snapshot)));
  localStorage.setItem('cv_meta', JSON.stringify(state));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreObject(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(snapshot));
}

function withRestoredMeta(run) {
  const snapshot = metaSnapshot();
  try { return run(); }
  finally { restoreMeta(snapshot); }
}

function withRestoredRun(run) {
  const state = clone(State);
  const gameEnded = Game.ended;
  const survivalInv = clone(Survival.inv || {});
  const previousRun = localStorage.getItem(RunSave.KEY);
  try { return run(); }
  finally {
    Loop.stop();
    RunSave.clear();
    restoreObject(State, state);
    Survival.inv = survivalInv;
    Game.ended = gameEnded;
    if (previousRun == null) localStorage.removeItem(RunSave.KEY);
    else localStorage.setItem(RunSave.KEY, previousRun);
  }
}

// Admite tanto un catálogo plano como uno agrupado por coins/gems. El contrato
// público de cada oferta sigue siendo id + amount + tipo de recurso.
function flattenOffers(catalog, inheritedKind = '') {
  if (Array.isArray(catalog)) {
    return catalog.map((offer) => Object.assign({}, offer, {
      kind: offer.kind || offer.currency || offer.type || inheritedKind,
    }));
  }
  if (!catalog || typeof catalog !== 'object') return [];
  return Object.entries(catalog).flatMap(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && ('amount' in value || 'durationMs' in value || 'id' in value)) {
      return [Object.assign({ id: value.id || key }, value, {
        kind: value.kind || value.currency || value.type || inheritedKind,
      })];
    }
    return flattenOffers(value, key);
  });
}

function currencyKind(offer) {
  return offer.kind || offer.currency || offer.type;
}

function cleanBoostStart(now) {
  const current = Meta.xpBoost(now);
  return Math.max(now, Number(current.endsAt) || 0) + 1;
}

function baseGameContext(extra = {}) {
  return Object.assign({
    score: 1200,
    level: 3,
    maxCombo: 7,
    removed: 24,
    elapsed: 75,
    mode: 'zen',
    perfect: true,
    daily: false,
  }, extra);
}

function savedClassicRun(extra = {}) {
  return Object.assign({
    v: 1,
    t: Date.now(),
    mode: 'clasico',
    diff: 'normal',
    level: 1,
    seed: 31415,
    world: 'bosque',
    worldLevel: 1,
    score: 250,
    board: new Array(64).fill(null),
    tiles: new Array(64).fill(null),
    iconCount: 0,
    spawnRate: 3000,
    elapsed: 18,
    timeLeft: 0,
    hintsLeft: 3,
    mistakes: 0,
    maxCombo: 2,
    removedTotal: 8,
    emptyBoards: 0,
    coinsRun: 0,
  }, extra);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('Storefront se exporta en el objeto dev y usa pago ficticio automático', () => {
  assert.ok(Storefront, 'window.__cv debe exponer Storefront');
  assert.equal(Storefront.PAYMENT_MODE, 'mock-auto');
  assert.ok(Storefront.CURRENCY_OFFERS, 'falta el catálogo CURRENCY_OFFERS');
  assert.ok(Storefront.XP_BOOST_OFFERS, 'falta el catálogo XP_BOOST_OFFERS');
});

test('CURRENCY_OFFERS contiene ofertas válidas y únicas de monedas y gemas', () => {
  assert.ok(Storefront, 'Storefront debe estar disponible');
  const offers = flattenOffers(Storefront.CURRENCY_OFFERS);
  assert.ok(offers.length >= 2, 'debe existir al menos una oferta por divisa');
  assert.deepEqual(new Set(offers.map(currencyKind)), new Set(['coins', 'gems']));
  assert.equal(new Set(offers.map((offer) => offer.id)).size, offers.length, 'los ids de oferta deben ser únicos');
  for (const offer of offers) {
    assert.equal(typeof offer.id, 'string');
    assert.ok(offer.id.length > 0);
    assert.ok(Number.isSafeInteger(offer.amount) && offer.amount > 0, `${offer.id}: amount inválido`);
  }
});

test('checkoutCurrency acredita al instante y devuelve una transacción paid/mock-auto', () => withRestoredMeta(() => {
  assert.ok(Storefront, 'Storefront debe estar disponible');
  const offers = flattenOffers(Storefront.CURRENCY_OFFERS);
  const coins = offers.find((offer) => currencyKind(offer) === 'coins');
  const gems = offers.find((offer) => currencyKind(offer) === 'gems');
  assert.ok(coins && gems, 'se necesitan ofertas de ambas divisas');

  Meta.state.coins = 0;
  Meta.state.gems = 0;

  const coinTx = Storefront.checkoutCurrency(coins.id);
  assert.equal(coinTx.status, 'paid');
  assert.equal(coinTx.paymentMode, 'mock-auto');
  assert.equal(Meta.coins(), coins.amount);
  assert.equal(Meta.gems(), 0, 'comprar monedas no debe alterar gemas');

  const gemTx = Storefront.checkoutCurrency(gems.id);
  assert.equal(gemTx.status, 'paid');
  assert.equal(gemTx.paymentMode, 'mock-auto');
  assert.equal(Meta.coins(), coins.amount, 'comprar gemas no debe alterar monedas');
  assert.equal(Meta.gems(), gems.amount);
}));

test('SKU desconocido no acredita divisas ni activa XP', () => withRestoredMeta(() => {
  const before = metaSnapshot();
  assert.equal(Storefront.checkoutCurrency('sku-does-not-exist'), null);
  assert.equal(Storefront.buyXpBoost('sku-does-not-exist', 9_200_000_000_000), null);
  assert.deepEqual(Meta.state, before, 'rechazar un SKU desconocido debe ser una operación pura');
}));

test('XP_BOOST_OFFERS fija exactamente 6h, 3d y 7d, todos a ×4 y con coste en gemas', () => {
  assert.ok(Storefront, 'Storefront debe estar disponible');
  const offers = flattenOffers(Storefront.XP_BOOST_OFFERS);
  assert.equal(offers.length, 3);
  assert.deepEqual(offers.map((offer) => offer.durationMs).sort((a, b) => a - b), [6 * HOUR, 3 * DAY, 7 * DAY]);
  assert.ok(offers.every((offer) => offer.multiplier === 4), 'todos los packs deben multiplicar XP ×4');
  assert.ok(offers.every((offer) => Number.isSafeInteger(offer.gemCost) && offer.gemCost > 0), 'cada pack debe tener gemCost positivo');
  assert.equal(new Set(offers.map((offer) => offer.id)).size, offers.length, 'los ids de booster deben ser únicos');
});

test('Meta.activateXpBoost activa, acumula tiempo restante y expira en el límite exacto', () => withRestoredMeta(() => {
  const referenceNow = 9_000_000_000_000;
  const start = cleanBoostStart(referenceNow);
  const first = Meta.activateXpBoost(6 * HOUR, start);

  assert.deepEqual(first, {
    active: true,
    multiplier: 4,
    endsAt: start + 6 * HOUR,
    remainingMs: 6 * HOUR,
  });

  const stackedAt = start + HOUR;
  const stacked = Meta.activateXpBoost(3 * DAY, stackedAt);
  const expectedEnd = start + 6 * HOUR + 3 * DAY;
  assert.equal(stacked.active, true);
  assert.equal(stacked.multiplier, 4);
  assert.equal(stacked.endsAt, expectedEnd, 'una compra activa debe extender desde el vencimiento actual');
  assert.equal(stacked.remainingMs, expectedEnd - stackedAt);

  assert.deepEqual(Meta.xpBoost(expectedEnd), {
    active: false,
    multiplier: 1,
    endsAt: expectedEnd,
    remainingMs: 0,
  });

  const restartedAt = expectedEnd + DAY;
  const restarted = Meta.activateXpBoost(6 * HOUR, restartedAt);
  assert.equal(restarted.endsAt, restartedAt + 6 * HOUR, 'un booster caducado debe reiniciarse desde now');
}));

test('Storefront.buyXpBoost gasta gemas, activa el pack y no toca boosters jugables', () => withRestoredMeta(() => {
  assert.ok(Storefront, 'Storefront debe estar disponible');
  const offer = flattenOffers(Storefront.XP_BOOST_OFFERS)[0];
  const referenceNow = 9_100_000_000_000;
  const now = cleanBoostStart(referenceNow);
  Meta.state.gems = offer.gemCost + 11;
  const playableBefore = Meta.boosterInventory();

  const result = Storefront.buyXpBoost(offer.id, now);
  assert.ok(result, 'la compra con saldo suficiente debe completarse');
  assert.equal(Meta.gems(), 11);
  assert.deepEqual(Meta.xpBoost(now), {
    active: true,
    multiplier: 4,
    endsAt: now + offer.durationMs,
    remainingMs: offer.durationMs,
  });
  assert.deepEqual(Meta.boosterInventory(), playableBefore, 'el booster de XP no pertenece al arsenal jugable');
}));

test('comprar XP booster sin gemas rechaza sin mutar saldo, expiración ni arsenal', () => withRestoredMeta(() => {
  const offer = flattenOffers(Storefront.XP_BOOST_OFFERS)[1];
  Meta.state.gems = Math.max(0, offer.gemCost - 1);
  const before = metaSnapshot();

  const result = Storefront.buyXpBoost(offer.id, 9_300_000_000_000);
  assert.equal(result.status, 'declined');
  assert.equal(result.reason, 'insufficient-gems');
  assert.deepEqual(Meta.state, before, 'un pago rechazado no debe escribir ningún estado Meta');
}));

test('recordGame conserva el XP base y aplica ×4 como bonus explícito sobre todo el XP ganado', () => withRestoredMeta(() => {
  const result = Meta.recordGame(baseGameContext({ xpMultiplier: 4 }));
  assert.ok(Number.isSafeInteger(result.xpBase) && result.xpBase >= 0);
  assert.equal(result.xpMultiplier, 4);
  assert.equal(result.xpBoostBonus, result.xpBase * 3);
  assert.equal(result.xpGained, result.xpBase * 4);
  assert.equal(result.xpGained, result.xpBase + result.xpBoostBonus);
}));

test('recordGame usa ×1 por defecto y sanea multiplicadores hostiles sin producir XP inválido', () => withRestoredMeta(() => {
  const clean = Meta.recordGame(baseGameContext());
  assert.equal(clean.xpMultiplier, 1);
  assert.equal(clean.xpBoostBonus, 0);
  assert.equal(clean.xpGained, clean.xpBase);

  const stable = metaSnapshot();
  for (const hostile of [NaN, Infinity, -4, 99, '4', null]) {
    restoreMeta(stable);
    const result = Meta.recordGame(baseGameContext({ xpMultiplier: hostile }));
    assert.ok(result.xpMultiplier === 1 || result.xpMultiplier === 4, `multiplicador no saneado: ${String(hostile)}`);
    assert.ok(Number.isSafeInteger(result.xpGained) && result.xpGained >= 0);
    assert.equal(result.xpBoostBonus, result.xpGained - result.xpBase);
    assert.equal(result.xpGained, result.xpBase * result.xpMultiplier);
  }
}));

test('Meta publica schema 10 y persiste el vencimiento xpBoostUntil', () => {
  assert.equal(Meta.state._v, 10);
  assert.ok(Object.prototype.hasOwnProperty.call(Meta.state, 'xpBoostUntil'));
  assert.ok(Number.isFinite(Meta.state.xpBoostUntil) && Meta.state.xpBoostUntil >= 0);
});

test('RunSave conserva snapshots ×1/×4 y un snapshot antiguo sin campo cae a ×1', () => withRestoredMeta(() => withRestoredRun(() => {
  Render.buildBoard();
  State.world = 'bosque';
  State.worldLevel = 1;
  Game.start('clasico', 'normal', 1, 2718);

  for (const multiplier of [1, 4]) {
    State.xpMultiplier = multiplier;
    RunSave.save();
    assert.equal(RunSave.load().xpMultiplier, multiplier, `el snapshot debe guardar ×${multiplier}`);
    assert.equal(Game.resumeSaved(), true);
    assert.equal(State.xpMultiplier, multiplier, `reanudar debe restaurar ×${multiplier}`);
  }

  const legacy = savedClassicRun();
  assert.ok(!Object.prototype.hasOwnProperty.call(legacy, 'xpMultiplier'));
  localStorage.setItem(RunSave.KEY, JSON.stringify(legacy));
  assert.equal(Game.resumeSaved(), true);
  assert.equal(State.xpMultiplier, 1, 'un snapshot pre-XP-booster nunca debe regalar ×4');
})));

test('los nueve SKU apuntan a PNG únicos existentes y precacheados por el service worker', () => {
  const offers = [
    ...flattenOffers(Storefront.CURRENCY_OFFERS),
    ...flattenOffers(Storefront.XP_BOOST_OFFERS),
  ];
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const precacheAt = sw.indexOf('const SHOP_GENERATED_ART');
  const precacheEnd = sw.indexOf('];', precacheAt);
  const precacheBlock = sw.slice(precacheAt, precacheEnd + 2);

  assert.equal(offers.length, 9, 'el storefront acordado tiene seis packs de divisa y tres de XP');
  assert.equal(new Set(offers.map((offer) => offer.asset)).size, 9, 'cada SKU necesita arte propio');
  assert.ok(precacheAt >= 0 && precacheEnd > precacheAt, 'falta SHOP_GENERATED_ART en sw.js');
  assert.match(sw, /IMAGE_MANIFEST = \[\]\.concat\([\s\S]*?\bSHOP_GENERATED_ART\b/, 'SHOP_GENERATED_ART debe entrar en la instalación offline');

  for (const offer of offers) {
    assert.match(offer.asset, /^img\/ui-generated\/shop\/[a-z0-9-]+\.png$/);
    const absolute = path.join(root, ...offer.asset.split('/'));
    assert.ok(fs.existsSync(absolute), `${offer.id}: no existe ${offer.asset}`);
    assert.ok(fs.statSync(absolute).size > 0, `${offer.id}: asset vacío`);
    const stem = path.basename(offer.asset, '.png');
    assert.match(precacheBlock, new RegExp(`['"]${escapeRegExp(stem)}['"]`), `${offer.asset} no está en SHOP_GENERATED_ART`);
  }
});

test('las tiendas de recursos y cosméticos son vistas separadas y cada una conserva su ruta', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const resourceView = html.match(/<(?:section|div)\b[^>]*id="view-resource-shop"[^>]*>/);
  const cosmeticView = html.match(/<(?:section|div)\b[^>]*id="view-shop"[^>]*>/);

  assert.ok(resourceView, 'falta la vista independiente view-resource-shop');
  assert.ok(cosmeticView, 'debe conservarse view-shop para tableros/temas');
  assert.notEqual(resourceView.index, cosmeticView.index);
  assert.match(resourceView[0], /data-hub-view="resource-shop"/);
  assert.match(cosmeticView[0], /data-hub-view="shop"/);
  assert.match(js, /HubViews\.open\(['"]resource-shop['"]/);
  assert.match(js, /HubViews\.open\(['"]shop['"]/);
});

test('las acciones enrutan recursos y estilos por flujos distintos, con guard durante partida', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const actionsAt = js.indexOf("document.addEventListener('click'");
  const actionsEnd = js.indexOf('// Inicio', actionsAt);
  const actions = js.slice(actionsAt, actionsEnd);
  const resourceAt = js.indexOf('function openResourceShop');
  const resourceEnd = js.indexOf('// Tienda de temas', resourceAt);
  const resourceRoute = js.slice(resourceAt, resourceEnd);
  const collectionsAt = html.indexOf('id="view-collections"');

  assert.ok(actionsAt >= 0 && actionsEnd > actionsAt, 'no se pudo aislar el router data-act');
  assert.match(actions, /a === 'buy-coins'[^\n]+openResourceShop\('coins'\)/);
  assert.match(actions, /a === 'buy-gems'[^\n]+openResourceShop\('gems'\)/);
  assert.match(actions, /a === 'nav-shop'[^\n]+openResourceShop\(\)/);
  assert.match(actions, /a === 'open-style-shop'[^\n]+openShop\(\)/);
  assert.match(actions, /a === 'nav-collections'[^\n]+openCollections\(\)/);
  assert.ok(collectionsAt >= 0, 'falta la vista Colecciones');
  // El hub rediseñado de Colecciones enruta a tableros/temas mediante tarjetas
  // de categoría (data-col-open); el detalle de cada una ofrece el CTA a la
  // tienda de estilos (open-style-shop).
  assert.match(js, /data-col-open=/, 'las categorías de Colecciones deben ser navegables');
  assert.match(js, /boards:\s*\{[\s\S]*?act:\s*'open-style-shop'/, 'Tableros debe enrutar a la tienda de estilos');
  assert.match(js, /themes:\s*\{[\s\S]*?act:\s*'open-style-shop'/, 'Temas debe enrutar a la tienda de estilos');

  assert.ok(resourceAt >= 0 && resourceEnd > resourceAt, 'no se pudo aislar openResourceShop');
  assert.match(resourceRoute, /document\.body\.dataset\.screen === 'game'/);
  assert.match(resourceRoute, /\['playing', 'paused', 'levelComplete'\]\.includes\(State\.status\)/);
  assert.match(resourceRoute, /return false/, 'el acceso desde una partida debe bloquearse antes de abrir la vista');
  assert.match(resourceRoute, /HubViews\.open\('resource-shop'/);
});

test('el HUD muestra el booster activo y resultados renderiza su multiplicador/bonus', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
  const fillStatsAt = js.indexOf('    fillStats() {');
  const fillStatsEnd = js.indexOf('saveBest()', fillStatsAt);
  const resultRenderer = js.slice(fillStatsAt, fillStatsEnd);

  assert.match(html, /id="hud-xp-boost"/, 'falta el estado de XP ×4 en el HUD de partida');
  assert.ok(fillStatsAt >= 0 && fillStatsEnd > fillStatsAt, 'no se pudo aislar el renderer de resultados');
  assert.match(resultRenderer, /xpBoostBonus/);
  assert.match(resultRenderer, /xpMultiplier/);
});

test('el copy de XP booster mantiene paridad ES/EN', () => {
  const es = Object.keys(I18n.DICT.es);
  const en = new Set(Object.keys(I18n.DICT.en));
  const xpBoostKeys = es.filter((key) => /(?:xp.*boost|boost.*xp)/i.test(key));

  assert.ok(xpBoostKeys.length > 0, 'faltan claves i18n específicas del XP booster');
  for (const key of xpBoostKeys) {
    assert.ok(en.has(key), `falta traducción EN para ${key}`);
    assert.notEqual(I18n.DICT.es[key], key);
    assert.notEqual(I18n.DICT.en[key], key);
  }
});

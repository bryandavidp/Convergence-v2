'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const { State, Config, Meta, Boosters, Survival, Bosses } = globalThis.window.__cv;
const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const IDS = ['bomb', 'freeze', 'clearLine', 'wild', 'x2'];

const clone = (value) => JSON.parse(JSON.stringify(value));
const restore = (snapshot) => {
  const state = Meta.state;
  Object.keys(state).forEach((key) => { delete state[key]; });
  Object.assign(state, clone(snapshot));
};

test('economía booster: la cotización usa stock primero y el commit es una sola decisión atómica', () => {
  const snapshot = clone(Meta.state);
  try {
    Meta.state.coins = 200;
    Meta.state.boosterStock = Object.fromEntries(IDS.map((id) => [id, 0]));
    Meta.state.boosterStock.freeze = 1;

    const quote = Meta.quoteBoosterLoadout(['freeze', 'bomb', 'bomb'], Config.SURVIVAL_LOADOUT_MAX);
    assert.deepEqual(quote.ids, ['freeze', 'bomb'], 'deduplica unidades del loadout');
    assert.deepEqual(quote.stock, ['freeze']);
    assert.deepEqual(quote.purchased, ['bomb']);
    assert.equal(quote.coinCost, Config.BOOSTER_PRICES.bomb);

    const committed = Meta.commitBoosterLoadout(quote.ids, Config.SURVIVAL_LOADOUT_MAX);
    assert.ok(committed);
    assert.equal(Meta.coins(), 120);
    assert.equal(Meta.boosterCount('freeze'), 0);

    const before = clone(Meta.state);
    Meta.state.coins = 10;
    const rejected = Meta.commitBoosterLoadout(['wild', 'x2'], Config.SURVIVAL_LOADOUT_MAX);
    assert.equal(rejected, null);
    assert.equal(Meta.coins(), 10);
    assert.deepEqual(Meta.boosterInventory(), before.boosterStock, 'un fallo no consume stock parcialmente');
  } finally { restore(snapshot); }
});

test('Supervivencia: empieza solo con lo confirmado y un reinicio técnico no regala unidades', () => {
  const previous = {
    mode: State.mode, diff: State.diff, inv: clone(Survival.inv), pending: Survival.pendingLoadout,
  };
  try {
    State.mode = 'supervivencia'; State.diff = 'normal';
    Survival.pendingLoadout = { bomb: 1, x2: 1 };
    Survival.start();
    assert.equal(Survival.inv.bomb, 1);
    assert.equal(Survival.inv.x2, 1);
    assert.equal(Survival.inv.freeze, 0);
    assert.equal(Survival.pendingLoadout, null, 'la transferencia se consume una sola vez');

    Survival.start();
    IDS.forEach((id) => assert.equal(Survival.inv[id], 0, `${id} no debe reaparecer gratis`));
    IDS.forEach((id) => assert.equal(Boosters.DEFS[id].start, 0));
  } finally {
    State.mode = previous.mode; State.diff = previous.diff;
    Survival.inv = previous.inv; Survival.pendingLoadout = previous.pending;
  }
});

test('Supervivencia: la reserva persistente no es visible, consumible ni robable durante la run', () => {
  const snapshot = clone(Meta.state);
  const previousMode = State.mode;
  const previousInv = clone(Survival.inv);
  try {
    Meta.state.boosterStock = Object.fromEntries(IDS.map((id) => [id, id === 'freeze' ? 3 : 0]));
    State.mode = 'supervivencia'; Survival.inv = {};
    assert.equal(Survival.boosterAvailable('freeze'), 0);
    assert.equal(Survival._spendBooster('freeze'), false);
    assert.equal(Bosses._cageSteal([]), false, 'la Jaula no encuentra stock fuera del inventario de run');
    assert.equal(Meta.boosterCount('freeze'), 3);
  } finally {
    State.mode = previousMode; Survival.inv = previousInv; restore(snapshot);
  }
});

test('suministro: cada anillo paga poco, respeta dificultad y nunca crea boosters', () => {
  const snapshot = clone(Meta.state);
  const previous = {
    mode: State.mode, diff: State.diff, wave: Survival.wave, charge: Survival.charge,
    inv: clone(Survival.inv), mut: Survival.mut, runCoins: Survival.runCoins,
  };
  try {
    Meta.state.coins = 0;
    Meta.state.boosterStock = Object.fromEntries(IDS.map((id) => [id, 0]));
    State.mode = 'supervivencia'; State.diff = 'normal'; State.coinsRun = 0;
    Survival.wave = 30; Survival.charge = 99; Survival.inv = {}; Survival.mut = { id: 'none' }; Survival.runCoins = 0;
    const paid = Survival.addSupplyCharge(1);
    assert.equal(paid, 2, 'normal paga 2 monedas por anillo');
    assert.equal(Meta.coins(), 2);
    assert.equal(Survival.charge, 0);
    assert.deepEqual(Meta.boosterInventory(), Object.fromEntries(IDS.map((id) => [id, 0])));
    assert.deepEqual(Survival.inv, {});

    State.diff = 'dificil'; Survival.charge = 100;
    assert.equal(Survival.addSupplyCharge(0), 3, 'difícil aplica su multiplicador y redondea a 3');
  } finally {
    restore(snapshot);
    State.mode = previous.mode; State.diff = previous.diff; State.coinsRun = 0;
    Survival.wave = previous.wave; Survival.charge = previous.charge; Survival.inv = previous.inv;
    Survival.mut = previous.mut; Survival.runCoins = previous.runCoins;
  }
});

test('política de sesión: Daily no equipa boosters y reintentar Supervivencia vuelve a preparación', () => {
  const gameStart = gameJs.slice(gameJs.indexOf('start(mode, diff'), gameJs.indexOf('// Reto del día:', gameJs.indexOf('start(mode, diff')));
  const dailyStart = gameJs.slice(gameJs.indexOf('startDaily()'), gameJs.indexOf('// Reanuda la partida', gameJs.indexOf('startDaily()')));
  const restart = gameJs.slice(gameJs.indexOf('restart() {'), gameJs.indexOf('quit() {', gameJs.indexOf('restart() {')));
  assert.match(gameStart, /else \{ Survival\.disarm\(\);[\s\S]*?Survival\.inv\s*=\s*\{\}/);
  assert.match(dailyStart, /this\.start\('contrarreloj'/);
  assert.match(restart, /State\.mode === 'supervivencia'[\s\S]*?openSurvivalDiff\(\)/);
  assert.doesNotMatch(restart, /commitBoosterLoadout|pendingLoadout\s*=/,
    'reintentar no debe recomprar ni copiar automáticamente el arsenal anterior');
});

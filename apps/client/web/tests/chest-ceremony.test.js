'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const {
  State,
  Config,
  Meta,
  Survival,
  CHEST_TYPES,
  CHEST_TYPE_ORDER,
  chestOdds,
  chestRollCount,
} = globalThis.window.__cv;

const root = path.join(__dirname, '..');
const gameJs = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const BOOSTER_IDS = ['bomb', 'freeze', 'clearLine', 'wild', 'x2'];
const UPGRADE_PATH = {
  wood: 'bronze',
  bronze: 'silver',
  silver: 'gold',
  gold: 'magic',
  magic: 'royal',
  royal: 'supreme',
  supreme: 'champion',
  champion: 'divine',
  event: 'royal',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotState() {
  return clone(Meta.state);
}

function restoreState(snapshot) {
  const state = Meta.state;
  Object.keys(state).forEach((key) => { delete state[key]; });
  Object.assign(state, clone(snapshot));
}

function resetChestState(level = 1) {
  const state = Meta.state;
  state.level = level;
  state.coins = 0;
  state.gems = 0;
  state.tickets = 0;
  state.chests = 0;
  state.chestInventory = [];
  state.chestUnlock = null;
  state.chestReady = [];
  state.chestNotifiedReady = [];
  state.chestSeq = 0;
  state.boosterStock = Object.fromEntries(BOOSTER_IDS.map((id) => [id, 0]));
}

function withRandomSequence(sequence, fn, fallback = 0) {
  const previous = Math.random;
  let index = 0;
  Math.random = () => index < sequence.length ? sequence[index++] : fallback;
  try { return fn(); }
  finally { Math.random = previous; }
}

function openOne(type, level, sequence, fallback = 0) {
  resetChestState(level);
  Meta.addChest(1, type, 'ch4-test');
  const chest = Meta.chestInventory()[0];
  return withRandomSequence(sequence, () => Meta.openChest(chest.uid), fallback);
}

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `no se pudo aislar ${start}`);
  return source.slice(from, to);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    let t = (value += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('CH-4: cada tamaño entrega entre 2 y 4 premios, con monedas garantizadas y payload serializable', () => {
  const snapshot = snapshotState();
  try {
    for (const type of CHEST_TYPE_ORDER) {
      // .5 evita el tier-up; el resto fuerza ramas de recursos deterministas.
      const reward = openOne(type, 1, [.5, 0, 0, 0, 0, 0, 0, 0]);
      assert.ok(reward, type);
      assert.equal(reward.items.length, chestRollCount(type), `${type}: número de premios`);
      assert.ok(reward.items.length >= 2 && reward.items.length <= 4, `${type}: debe entregar 2–4 premios`);
      assert.ok(
        reward.items.some((item) => item.kind === 'coins' && item.guaranteed === true && item.amount > 0),
        `${type}: debe incluir monedas garantizadas`,
      );

      let encoded;
      assert.doesNotThrow(() => { encoded = JSON.stringify(reward); }, `${type}: payload circular`);
      const decoded = JSON.parse(encoded);
      assert.equal(decoded.items.length, reward.items.length);
      assert.notStrictEqual(reward.items[1], reward, `${type}: reward.items no debe autorreferenciar reward`);
    }
  } finally { restoreState(snapshot); }
});

test('CH-4: tier-up respeta la ruta, el límite 10% y divine publica probabilidad cero', () => {
  const snapshot = snapshotState();
  try {
    for (const [from, to] of Object.entries(UPGRADE_PATH)) {
      const upgraded = openOne(from, 1, [.099, 0, 0, 0, 0, 0, 0]);
      assert.equal(upgraded.baseChestType, from);
      assert.equal(upgraded.chestType, to, `${from} debe ascender a ${to}`);
      assert.deepEqual(upgraded.tierUp, { from, to });
      assert.deepEqual(upgraded.upgradeRoll, { from, to, chance: 0.1, upgraded: true });
      assert.deepEqual(chestOdds(from, 1).upgrade, { to, pct: 10 });
    }

    const held = openOne('wood', 1, [.10, 0, 0, 0, 0]);
    assert.equal(held.chestType, 'wood', 'el límite es estricto: 0.10 no asciende');
    assert.equal(held.tierUp, undefined);
    assert.deepEqual(held.upgradeRoll, { from: 'wood', to: 'bronze', chance: 0.1, upgraded: false });

    const divine = openOne('divine', 1, [0, 0, 0, 0]);
    assert.equal(divine.baseChestType, 'divine');
    assert.equal(divine.chestType, 'divine');
    assert.equal(divine.tierUp, undefined);
    assert.equal(divine.upgradeRoll, null);
    assert.deepEqual(chestOdds('divine', 1).upgrade, { to: null, pct: 0 });
  } finally { restoreState(snapshot); }
});

test('CH-4: monedas y gemas escalan de nivel 1 a nivel 31 y quedan limitadas a ×2.5', () => {
  const snapshot = snapshotState();
  try {
    for (const type of CHEST_TYPE_ORDER) {
      const base = CHEST_TYPES[type].reward;
      const level1 = chestOdds(type, 1);
      const level31 = chestOdds(type, 31);
      const beyondCap = chestOdds(type, 999);

      assert.deepEqual([level1.coins.min, level1.coins.max], base.coins, `${type}: monedas nivel 1`);
      assert.deepEqual([level1.gems.min, level1.gems.max], base.gems, `${type}: gemas nivel 1`);
      assert.deepEqual(
        [level31.coins.min, level31.coins.max],
        base.coins.map((n) => Math.round(n * 2.5)),
        `${type}: monedas nivel 31`,
      );
      assert.deepEqual(
        [level31.gems.min, level31.gems.max],
        base.gems.map((n) => Math.round(n * 2.5)),
        `${type}: gemas nivel 31`,
      );
      assert.deepEqual(beyondCap.coins, level31.coins, `${type}: tope de monedas`);
      assert.deepEqual(beyondCap.gems, level31.gems, `${type}: tope de gemas`);
    }

    const coins1 = openOne('divine', 1, [0, 0, 0]).amount;
    const coins31 = openOne('divine', 31, [0, 0, 0]).amount;
    const gems1 = openOne('divine', 1, [0, .25, 0]).amount;
    const gems31 = openOne('divine', 31, [0, .25, 0]).amount;
    assert.equal(coins1, 1000);
    assert.equal(coins31, 2500);
    assert.equal(gems1, 35);
    assert.equal(gems31, 88);
  } finally { restoreState(snapshot); }
});

test('CH-4: la tirada bonus cubre recursos y boosters con distribución 52/23/13/12', () => {
  const boundaryCases = [
    { sequence: [.519999, 0], kind: 'coins' },
    { sequence: [.52, 0], kind: 'gems' },
    { sequence: [.75], kind: 'ticket' },
    { sequence: [.88, 0], kind: 'booster', boosterId: 'bomb' },
  ];
  for (const expected of boundaryCases) {
    const item = withRandomSequence(expected.sequence, () => Meta._chestBonusRoll(CHEST_TYPES.gold, 1));
    assert.equal(item.kind, expected.kind);
    assert.ok(Number.isInteger(item.amount) && item.amount > 0);
    if (expected.boosterId) assert.equal(item.boosterId, expected.boosterId);
  }

  const previous = Math.random;
  const counts = { coins: 0, gems: 0, ticket: 0, booster: 0 };
  const samples = 25000;
  Math.random = mulberry32(0xc0ffee);
  try {
    for (let i = 0; i < samples; i++) {
      const item = Meta._chestBonusRoll(CHEST_TYPES.gold, 1);
      counts[item.kind]++;
      if (item.kind === 'booster') assert.ok(BOOSTER_IDS.includes(item.boosterId));
    }
  } finally { Math.random = previous; }

  const expected = { coins: .52, gems: .23, ticket: .13, booster: .12 };
  for (const [kind, probability] of Object.entries(expected)) {
    const observed = counts[kind] / samples;
    assert.ok(Math.abs(observed - probability) < .015, `${kind}: ${observed.toFixed(4)} vs ${probability}`);
  }
});

test('CH-4: el arsenal persistente concede, consume y recibe boosters de cofres', () => {
  const snapshot = snapshotState();
  try {
    resetChestState();
    assert.deepEqual(Meta.boosterInventory(), Object.fromEntries(BOOSTER_IDS.map((id) => [id, 0])));

    for (const id of BOOSTER_IDS) {
      assert.equal(Meta.addBooster(id, 2), 2, `${id}: grant`);
      assert.equal(Meta.boosterCount(id), 2);
      assert.equal(Meta.spendBooster(id, 1), true, `${id}: consume`);
      assert.equal(Meta.boosterCount(id), 1);
      assert.equal(Meta.spendBooster(id, 2), false, `${id}: no permite saldo negativo`);
      assert.equal(Meta.boosterCount(id), 1);
    }
    assert.equal(Meta.addBooster('unknown', 2), 0);
    assert.equal(Meta.spendBooster('unknown', 1), false);

    resetChestState();
    // gold: tier hold, monedas garantizadas, principal de gemas y bonus booster bomb.
    const reward = openOne('gold', 1, [.5, .5, .5, .5, .99, 0]);
    assert.ok(reward.items.some((item) => item.kind === 'booster' && item.boosterId === 'bomb'));
    assert.equal(Meta.boosterCount('bomb'), 1, 'el drop debe entrar en el arsenal');
    assert.equal(Meta.spendBooster('bomb', 1), true);
    assert.equal(Meta.boosterCount('bomb'), 0);
  } finally { restoreState(snapshot); }
});

test('CH-4: el stock persistente solo entra a una partida mediante un loadout confirmado', () => {
  const snapshot = snapshotState();
  const previousMode = State.mode;
  const previousInventory = clone(Survival.inv || {});
  try {
    resetChestState();
    Meta.addBooster('freeze', 2);

    State.mode = 'clasico';
    Survival.inv = {};
    assert.equal(Survival.boosterAvailable('freeze'), 0, 'Clásico no debe sumar el stock sin seleccionar');
    assert.equal(Survival._spendBooster('freeze'), false, 'Clásico no debe gastar directamente el stock');
    assert.equal(Meta.boosterCount('freeze'), 2);

    Survival.inv = { freeze: 1 };
    assert.equal(Survival.boosterAvailable('freeze'), 1, 'PreLevel entrega una unidad al inventario de la partida');
    assert.equal(Survival._spendBooster('freeze'), true);
    assert.equal(Meta.boosterCount('freeze'), 2, 'usar la unidad seleccionada no vuelve a tocar el stock');

    State.mode = 'supervivencia';
    Survival.inv = {};
    assert.equal(Survival.boosterAvailable('freeze'), 0, 'Supervivencia no debe sumar la reserva sin confirmar');
    assert.equal(Survival._spendBooster('freeze'), false, 'la partida no puede drenar la reserva implícitamente');
    assert.equal(Meta.boosterCount('freeze'), 2, 'el stock persistente permanece intacto');

    const quote = Meta.quoteBoosterLoadout(['freeze'], Config.SURVIVAL_LOADOUT_MAX);
    assert.deepEqual(quote.stock, ['freeze']);
    const committed = Meta.commitBoosterLoadout(['freeze'], Config.SURVIVAL_LOADOUT_MAX);
    assert.ok(committed, 'la confirmación transfiere una unidad de stock');
    assert.equal(Meta.boosterCount('freeze'), 1);
    Survival.inv = { freeze: 1 };
    assert.equal(Survival.boosterAvailable('freeze'), 1);
    assert.equal(Survival._spendBooster('freeze'), true);
    assert.equal(Meta.boosterCount('freeze'), 1, 'usar el loadout no vuelve a tocar la reserva');

    assert.equal(Config.PRELEVEL_MAX, 2);
    const preLevel = sourceBetween(gameJs, 'const PreLevel = {', 'const DailyMut = {');
    assert.match(preLevel, /Meta\.quoteBoosterLoadout\(this\._selIds\(\),\s*Config\.PRELEVEL_MAX\)/);
    assert.match(preLevel, /const price\s*=\s*stock\s*>\s*0\s*\?[\s\S]*?booster_stock/);
    assert.match(preLevel, /Meta\.commitBoosterLoadout\(picked,\s*Config\.PRELEVEL_MAX\)/);
    assert.match(preLevel, /Game\.startClassic\([\s\S]*?Survival\.inv\s*=\s*\{\}[\s\S]*?picked\.forEach\([\s\S]*?Survival\.inv\[id\]\s*=\s*1/);
    const modeLaunch = sourceBetween(gameJs, 'const ModeLaunch = {', 'function launchZen');
    assert.match(modeLaunch, /Meta\.commitBoosterLoadout\(ids,\s*Config\.SURVIVAL_LOADOUT_MAX\)/);
    assert.match(modeLaunch, /Survival\.pendingLoadout\s*=\s*\{\}/);
  } finally {
    State.mode = previousMode;
    Survival.inv = previousInventory;
    restoreState(snapshot);
  }
});

test('CH-4: la migración convierte boosterStock array en un objeto persistible válido', () => {
  const script = [
    "'use strict';",
    "require('./tests/dom-stub.js');",
    "localStorage.setItem('cv_meta', JSON.stringify({_v: 6, boosterStock: []}));",
    "require('./game.js');",
    'const Meta = window.__cv.Meta;',
    'const before = Meta.boosterInventory();',
    "Meta.addBooster('bomb', 2);",
    "const stored = JSON.parse(localStorage.getItem('cv_meta')).boosterStock;",
    'process.stdout.write(JSON.stringify({ before, after: Meta.boosterInventory(), stored, array: Array.isArray(stored) }));',
  ].join(' ');
  const migrated = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
  }));
  const empty = Object.fromEntries(BOOSTER_IDS.map((id) => [id, 0]));

  assert.deepEqual(migrated.before, empty);
  assert.equal(migrated.array, false);
  assert.deepEqual(migrated.after, { ...empty, bomb: 2 });
  assert.deepEqual(migrated.stored, migrated.after);
  assert.match(gameJs, /Array\.isArray\(m\.boosterStock\)/);
});

test('CH-4: no hay spoilers antes del reveal y reduced-motion muestra la lista completa', () => {
  const reveal = sourceBetween(gameJs, 'function showChestReward(', 'function showChestTierRoll(');
  const orchestration = sourceBetween(gameJs, 'function revealChestReward(', 'function openDailyChoicePicker(');

  assert.match(reveal, /const reduceMotion\s*=\s*Settings\.reducedFx[\s\S]*?prefers-reduced-motion:\s*reduce/);
  assert.match(reveal, /const initialInfo\s*=\s*allVisible\s*\?\s*info\s*:\s*firstInfo/);
  assert.match(reveal, /const initialTitle\s*=\s*allVisible\s*&&\s*cosmetic\s*\?[\s\S]*?:\s*I18n\.t\('chest_reveal_title'\)/);
  assert.match(reveal, /data-chest-equip\$\{allVisible\s*\?\s*''\s*:\s*' hidden disabled'\}/);
  assert.match(reveal, /const hidden\s*=\s*!reduceMotion\s*&&\s*i\s*>\s*0/);
  assert.match(reveal, /rarity-\$\{hidden\s*\?\s*'hidden'\s*:\s*it\.rarity\}/);
  assert.match(reveal, /aria-label="\$\{esc\(hidden\s*\?\s*I18n\.t\('chest_tap_reveal'\)\s*:\s*it\.label\)\}"/);
  assert.match(reveal, /const announced\s*=\s*allVisible\s*\?[\s\S]*?items\.map[\s\S]*?:\s*`\$\{chestRewardInfo\(items\[0\]\)\.label\}/);
  assert.match(orchestration, /const first\s*=\s*chestRewardInfo\(Array\.isArray\(r\.items\)[\s\S]*?Toasts\.show\([\s\S]*?first\.label[\s\S]*?first\.icon/);

  assert.match(styles, /#screen-start \.cr-items\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /#screen-start \.cr-item\s*\{[^}]*min-height:\s*112px/s);
  assert.match(styles, /\.cr-item\.is-hidden \.cr-item-face\s*\{[^}]*opacity:\s*0/s);
  assert.match(styles, /\.cr-item\.is-hidden \.cr-item-back\s*\{[^}]*opacity:\s*1/s);
  assert.match(styles, /\.cr-item\.rarity-hidden\s*\{/);
  assert.match(styles, /body\.reduced-fx #screen-start \.cr-item[\s\S]*?animation:\s*none;\s*transition:\s*none/);
});

test('CH-4: el foco avanza carta a carta y termina en Continuar', () => {
  const reveal = sourceBetween(gameJs, 'function showChestReward(', 'function showChestTierRoll(');

  assert.match(reveal, /const next\s*=\s*hidden\s*&&\s*i\s*===\s*1/);
  assert.match(reveal, /class="cr-item[^"`]*\$\{next\s*\?\s*' is-next'/);
  assert.match(reveal, /data-chest-next\$\{allVisible\s*\?\s*''\s*:\s*' disabled'\}/);
  assert.match(reveal, /const pending\s*=\s*el\.querySelector\('\.cr-item\.is-hidden'\)[\s\S]*?pending\.classList\.add\('is-next'\);\s*pending\.disabled\s*=\s*false[\s\S]*?pending\.focus\(\)/);
  assert.match(reveal, /nextButton\.disabled\s*=\s*false[\s\S]*?moveFocus\s*&&\s*nextButton[\s\S]*?nextButton\.focus\(\)/);
  assert.match(reveal, /if\s*\(!card\.classList\.contains\('is-next'\)\)\s*return/);
  assert.match(reveal, /classList\.remove\('is-hidden',\s*'is-next'\)[\s\S]*?announce\(label\);\s*unlockNextAction\(true\)/);
  assert.match(reveal, /const firstAction\s*=\s*el\.querySelector\('\.cr-item\.is-next'\)\s*\|\|\s*el\.querySelector\('\[data-chest-next\]'\)[\s\S]*?firstAction\.focus\(\)/);
});

test('CH-4: el ascenso solo interrumpe al ocurrir y la apertura separa atlas de movimiento', () => {
  const reveal = sourceBetween(gameJs, 'function showChestReward(', 'function showChestTierRoll(');
  const tier = sourceBetween(gameJs, 'function showChestTierRoll(', 'function revealChestReward(');
  const orchestration = sourceBetween(gameJs, 'function revealChestReward(', 'function openDailyChoicePicker(');

  assert.match(tier, /!roll\.upgraded\)\s*\{\s*onDone\(\);\s*return/);
  assert.match(tier, /chest_tier_success_detail/);
  assert.match(tier, /announce\(`\$\{outcome\}\. \$\{detail\}`\)/);
  assert.match(tier, /if\s*\(motionOff\(\)\)[\s\S]*?Promise\.resolve\(\)\.then/);
  assert.doesNotMatch(tier, /setTimeout\(onDone/);
  assert.match(reveal, /chest_tier_reward_note[\s\S]*?class="cr-upgrade-note"/,
    'el ascenso debe seguir explicado en la recompensa, incluso sin animación');
  assert.match(orchestration, /r\.upgradeRoll\s*&&\s*r\.upgradeRoll\.upgraded\)\s*showChestTierRoll\(r,\s*reveal,\s*run\)/);
  assert.match(orchestration, /prepareChestAtlas\(openingType\)[\s\S]*?afterChestAnimation\(motion,\s*'chestOpenMotion'/);
  const atlasFrames = styles.slice(styles.indexOf('@keyframes chestAtlasFrames'), styles.indexOf('@keyframes chestOpenMotion'));
  const smoothMotion = styles.slice(styles.indexOf('@keyframes chestOpenMotion'), styles.indexOf('@keyframes chestOpenGlow'));
  assert.match(atlasFrames, /background-position/);
  assert.doesNotMatch(atlasFrames, /transform|filter|box-shadow/);
  assert.match(smoothMotion, /translate3d/);
  assert.doesNotMatch(smoothMotion, /background-position|filter|box-shadow/);
  assert.ok(
    (styles.match(/#screen-start \.chest-tier-roll > b\s*\{\s*opacity:\s*1;\s*transform:\s*none;\s*\}/g) || []).length >= 2,
    'el resultado debe ser visible tanto con reduced-fx como con prefers-reduced-motion',
  );

  assert.match(reveal, /if\s*\(revealed\.rarity\s*===\s*'common'\)\s*Sound\.ui\(\);\s*else\s*\{\s*Sound\.record\(\);[\s\S]*?if\s*\(!reduceMotion\)\s*FX\.confetti/);
  assert.match(reveal, /classList\.add\('rarity-'\s*\+\s*revealed\.rarity,\s*'is-revealed'\)/);
  assert.match(styles, /\.cr-item\.is-revealed\.rarity-rare,[\s\S]*?\.rarity-cosmetic\s*\{\s*animation:\s*chestRareReveal/);
});

test('CH-4: preview y ceremonia cambian de forma exclusiva y cancelable', () => {
  const state = sourceBetween(gameJs, 'function clearChestCeremonyAsync(', 'function setChestButtonsBusy(');
  const build = sourceBetween(gameJs, 'function buildChests()', 'function openSelectedChest(');
  const orchestration = sourceBetween(gameJs, 'function revealChestReward(', 'function openDailyChoicePicker(');

  const previewStart = indexHtml.indexOf('id="chest-preview"');
  const previewBody = indexHtml.indexOf('id="chest-preview-body"', previewStart);
  const ceremonyStart = indexHtml.indexOf('id="chest-ceremony"', previewBody);
  const ceremonyTagEnd = indexHtml.indexOf('>', ceremonyStart);
  assert.ok(previewStart >= 0 && previewBody > previewStart && ceremonyStart > previewBody);
  assert.match(indexHtml.slice(ceremonyStart, ceremonyTagEnd), /hidden inert/);
  assert.match(state, /preview\.hidden\s*=\s*!!open[\s\S]*?ceremony\.hidden\s*=\s*!open/);
  assert.match(state, /toggleAttribute\('inert'/);
  assert.match(state, /chestCeremonyRun\+\+[\s\S]*?chestCeremonyCleanups/);
  assert.match(build, /const el\s*=\s*\$\('#chest-preview-body'\)[\s\S]*?resetChestCeremony\(\)/);
  assert.match(orchestration, /setChestCeremonyOpen\(true\)/);
  assert.match(orchestration, /chestCeremonyReturnFocus[\s\S]*?focusChestNode\(stage\)/);
  assert.match(state, /function finishChestCeremony\(\)[\s\S]*?buildChests\(\)[\s\S]*?focusChestNode/);
  assert.match(styles, /\.view-chests\.is-ceremony-open \.chest-main-actions[\s\S]*?\.chest-catalog \{ display: none; \}/);
});

test('CH-4: los umbrales de medallas del Reto permanecen intactos', () => {
  assert.deepEqual(Meta.DAILY_MEDALS, [750, 1500, 2500]);
  assert.equal(Meta.dailyMedal(749), 'none');
  assert.equal(Meta.dailyMedal(750), 'bronze');
  assert.equal(Meta.dailyMedal(1499), 'bronze');
  assert.equal(Meta.dailyMedal(1500), 'silver');
  assert.equal(Meta.dailyMedal(2499), 'silver');
  assert.equal(Meta.dailyMedal(2500), 'gold');
});

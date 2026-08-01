'use strict';

// CH-5 (docs/CHEST_SYSTEM_MASTER_PLAN.md §5): Choice Chest diario, catch-up
// bondadoso y cofres de evento ligados a una semana real mediante snapshots.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const { Meta, I18n, Picker, State } = globalThis.window.__cv;
const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

const TODAY = '2026-07-18';
const BOOSTER_IDS = ['bomb', 'freeze', 'clearLine', 'wild', 'x2'];

function fullSnapshot() { return JSON.parse(JSON.stringify(Meta.state)); }

function restore(snapshot) {
  const state = Meta.state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, snapshot);
  localStorage.setItem('cv_meta', JSON.stringify(snapshot));
}

function resetChestAgency(state, dailyDate = '') {
  state.level = 1;
  state.coins = 0;
  state.gems = 0;
  state.tickets = 0;
  state.boosterStock = { bomb: 0, freeze: 0, clearLine: 0, wild: 0, x2: 0 };
  state.chests = 0;
  state.chestInventory = [];
  state.chestUnlock = null;
  state.chestReady = [];
  state.chestNotifiedReady = [];
  state.chestSlots = 3;
  state.chestSeq = 0;
  state.chestPipeline = { wins: 0, cycle: 0 };
  state.dailyChest = { date: dailyDate };
  state.weekly = { week: '', id: '', progress: 0, done: false };
}

function economySnapshot() {
  return {
    coins: Meta.coins(),
    gems: Meta.gems(),
    tickets: Meta.tickets(),
    boosters: Meta.boosterInventory(),
  };
}

function withDate(date, fn) {
  const RealDate = globalThis.Date;
  const stamp = RealDate.parse(`${date}T12:00:00.000Z`);
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [stamp])); }
    static now() { return stamp; }
  }
  globalThis.Date = FakeDate;
  try { return fn(); }
  finally { globalThis.Date = RealDate; }
}

function withRandomSequence(sequence, fn) {
  const previous = Math.random;
  let index = 0;
  Math.random = () => sequence[Math.min(index++, sequence.length - 1)];
  try { return fn(); }
  finally { Math.random = previous; }
}

test('CH-5: el Choice Chest fija tres opciones persistentes y no entrega nada antes de elegir', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state);
    const before = economySnapshot();
    const result = withDate(TODAY, () => withRandomSequence([0, 0, 0, 0], () => Meta.recordChestProgress('clasico')));

    assert.ok(result.dailyChoice, 'la primera victoria debe devolver el Choice Chest creado');
    assert.equal(result.dailyChoice.type, 'bronze');
    assert.equal(result.dailyChoice.choice.id, `daily:${TODAY}`);
    assert.equal(result.dailyChoice.choice.options.length, 3);
    assert.equal(result.dailyChoice.state, 'ready', 'la recompensa diaria debe poder elegirse al ganarla');
    assert.equal(new Set(result.dailyChoice.choice.options.map((option) => option.id)).size, 3);
    assert.deepEqual(economySnapshot(), before, 'generar/revelar opciones no debe aplicar ninguna');

    const uid = result.dailyChoice.uid;
    const fixedOptions = result.dailyChoice.choice.options;
    assert.deepEqual(Meta.chestChoiceInfo(uid).choice.options, fixedOptions);
    assert.deepEqual(Meta.dailyChoiceChests()[0].choice.options, fixedOptions);
    assert.equal(Meta.openChest(uid), null, 'la apertura aleatoria no puede saltarse la elección');
    assert.deepEqual(economySnapshot(), before);

    const saved = JSON.parse(localStorage.getItem('cv_meta'));
    const persisted = saved.chestInventory.find((chest) => chest.uid === uid);
    assert.deepEqual(persisted.choice.options, fixedOptions, 'las opciones deben guardarse antes del Picker');

    const externalCopy = Meta.chestChoiceInfo(uid);
    externalCopy.choice.options[0].amount += 9999;
    assert.deepEqual(Meta.chestChoiceInfo(uid).choice.options, fixedOptions, 'las APIs deben devolver copias defensivas');
  } finally { restore(snapshot); }
});

test('CH-5: opción inválida y doble claim son idempotentes; solo se aplica la elegida', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state);
    const choice = withDate(TODAY, () => withRandomSequence([0, 0, 0, 0], () => Meta.recordChestProgress('zen').dailyChoice));
    const uid = choice.uid;
    const coinOption = choice.choice.options.find((option) => option.kind === 'coins');
    const before = economySnapshot();

    assert.equal(Meta.makeChestChoiceReady(uid).state, 'ready');
    assert.deepEqual(economySnapshot(), before, 'marcarlo listo no concede premio');
    assert.equal(Meta.claimChestChoice(uid, 'opcion-inventada'), null);
    assert.ok(Meta.chestChoiceInfo(uid), 'una opción inválida no consume el cofre');
    assert.deepEqual(economySnapshot(), before);

    const reward = Meta.claimChestChoice(uid, coinOption.id);
    assert.equal(reward.kind, 'coins');
    assert.equal(reward.amount, coinOption.amount);
    assert.equal(reward.choice, true);
    assert.equal(reward.items.length, 1);
    assert.equal(Meta.coins(), before.coins + coinOption.amount);
    assert.equal(Meta.gems(), before.gems);
    assert.equal(Meta.tickets(), before.tickets);
    assert.deepEqual(Meta.boosterInventory(), before.boosters);
    assert.equal(Meta.chestChoiceInfo(uid), null);

    const after = economySnapshot();
    assert.equal(Meta.claimChestChoice(uid, coinOption.id), null, 'un segundo claim no puede duplicar el premio');
    assert.deepEqual(economySnapshot(), after);
  } finally { restore(snapshot); }
});

test('CH-5: un Choice Chest persistido con datos manipulados degrada a cofre normal sin corromper la economía', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state);
    const choice = withDate(TODAY, () => Meta.recordChestProgress('clasico').dailyChoice);
    const stored = state.chestInventory.find((entry) => entry.uid === choice.uid);
    stored.choice.options[0].amount = String(stored.choice.options[0].amount);
    const before = economySnapshot();

    assert.equal(Meta.chestChoiceInfo(choice.uid), null, 'un importe string no puede entrar en la ruta de claim');
    const degraded = Meta.chestInventory().find((entry) => entry.uid === choice.uid);
    assert.ok(degraded);
    assert.equal(Object.hasOwn(degraded, 'choice'), false, 'el cofre se conserva, pero pierde el payload inválido');
    assert.deepEqual(economySnapshot(), before);
  } finally { restore(snapshot); }
});

test('CH-5: el Choice Chest diario nace listo, no bloquea la cola y no admite un salto de pago', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state);
    state.gems = 50;
    withDate(TODAY, () => {
      Meta.addChest(1, 'magic', 'queue-before-choice');
      const gemsBefore = Meta.gems();
      const choice = Meta.recordChestProgress('aventura').dailyChoice;
      const options = choice.choice.options;
      assert.equal(choice.state, 'ready');
      assert.equal(Meta.chestInstantCost(choice.uid), 0);
      assert.equal(Meta.startChestUnlock(choice.uid), null);
      assert.equal(Meta.makeChestChoiceReady(choice.uid).state, 'ready');
      assert.deepEqual(Meta.makeChestChoiceReady(choice.uid).choice.options, options, 'marcar listo sigue siendo idempotente');
      assert.equal(Meta.chestUnlock().type, 'magic', 'el cofre normal más corto arranca sin esperar al Choice');
      assert.equal(Meta.gems(), gemsBefore, 'ganar/revelar el Choice no cobra la antigua apertura instantánea');
      assert.deepEqual(economySnapshot(), { coins: 0, gems: 50, tickets: 0, boosters: { bomb: 0, freeze: 0, clearLine: 0, wild: 0, x2: 0 } });
    });
  } finally { restore(snapshot); }
});

test('CH-5: primer usuario y ayer reciben bronce; un hueco de dos o más días recibe plata', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  const cases = [
    { previous: '', type: 'bronze', catchUp: false, label: 'primer usuario' },
    { previous: '2026-07-17', type: 'bronze', catchUp: false, label: 'jugó ayer' },
    { previous: '2026-07-16', type: 'silver', catchUp: true, label: 'faltó ayer' },
    { previous: '2026-07-01', type: 'silver', catchUp: true, label: 'hueco largo, tope un tier' },
  ];
  try {
    for (const scenario of cases) {
      resetChestAgency(state, scenario.previous);
      const result = withDate(TODAY, () => Meta.recordChestProgress('clasico'));
      assert.equal(result.daily, scenario.type, scenario.label);
      assert.equal(result.dailyChoice.type, scenario.type, scenario.label);
      assert.equal(result.dailyChoice.choice.tier, scenario.type, scenario.label);
      assert.equal(result.dailyChoice.choice.catchUp, scenario.catchUp, scenario.label);
      assert.equal(Meta.dailyChoiceChests().length, 1, scenario.label);
    }
  } finally { restore(snapshot); }
});

test('CH-5: un Choice Chest pendiente no se sobrescribe al ganar el de otro día', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state);
    const first = withDate('2026-07-16', () => withRandomSequence([0, 0, 0, 0], () => Meta.recordChestProgress('clasico').dailyChoice));
    const firstOptions = first.choice.options;
    const second = withDate(TODAY, () => withRandomSequence([.9, .9, .9, .9], () => Meta.recordChestProgress('zen').dailyChoice));
    const pending = Meta.dailyChoiceChests();

    assert.equal(pending.length, 2);
    assert.deepEqual(pending.map((entry) => entry.choice.id), ['daily:2026-07-16', `daily:${TODAY}`]);
    assert.deepEqual(Meta.chestChoiceInfo(first.uid).choice.options, firstOptions);
    assert.equal(second.type, 'silver', 'el día perdido da catch-up aunque el cofre anterior siga pendiente');
    assert.equal(second.choice.catchUp, true);
  } finally { restore(snapshot); }
});

test('CH-5: el cofre de evento conserva snapshot semanal y garantiza su booster temático', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state, TODAY);
    const awarded = withDate(TODAY, () => Meta.addEventChest('weekly'));
    const chest = Meta.chestInventory().find((entry) => entry.type === 'event');
    assert.ok(chest);
    assert.deepEqual(chest.event, awarded);
    assert.match(chest.event.id, /^weekly:\d{4}-\d{2}-\d{2}:w_/);
    assert.ok(BOOSTER_IDS.includes(chest.event.featuredBooster));
    assert.match(chest.source, new RegExp(`^event:${chest.event.id}:weekly$`));

    const originalSnapshot = JSON.parse(JSON.stringify(chest.event));
    const nextEvent = withDate('2026-07-25', () => Meta.currentChestEvent('weekly'));
    assert.notEqual(nextEvent.id, originalSnapshot.id, 'otra semana debe producir otro evento');
    assert.deepEqual(Meta.chestInventory().find((entry) => entry.uid === chest.uid).event, originalSnapshot,
      'rotar la semana no puede mutar un cofre ya ganado');

    const beforeBooster = Meta.boosterCount(originalSnapshot.featuredBooster);
    const reward = withRandomSequence([.5, 0, 0, 0], () => Meta.openChest(chest.uid));
    const thematic = reward.items.find((item) => item.kind === 'booster' && item.event);
    assert.ok(thematic, 'el evento debe añadir un booster temático garantizado');
    assert.equal(thematic.boosterId, originalSnapshot.featuredBooster);
    assert.equal(Meta.boosterCount(originalSnapshot.featuredBooster), beforeBooster + thematic.amount);
  } finally { restore(snapshot); }
});

test('CH-5: eventos legacy o con snapshot parcial migran una vez a un snapshot estricto y estable', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  const legacyEntry = (event) => ({
    uid: 'legacy-event', type: 'event', source: 'legacy-weekly',
    earnedAt: Date.parse('2026-07-01T12:00:00Z'), durationMs: 6 * 60 * 60 * 1000,
    ...(event ? { event } : {}),
  });
  const assertStrictEvent = (event) => {
    assert.match(event.week, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(event.challengeId, /^w_(games|remove|score|combo)$/);
    assert.equal(event.id, `weekly:${event.week}:${event.challengeId}`);
    assert.ok(BOOSTER_IDS.includes(event.featuredBooster));
    assert.match(event.source, /^[a-z0-9-]{1,32}$/);
  };
  try {
    resetChestAgency(state, TODAY);
    state.chests = 1;
    state.chestInventory = [legacyEntry()];
    const migrated = withDate(TODAY, () => Meta.chestInventory()[0].event);
    assertStrictEvent(migrated);
    assert.equal(migrated.source, 'legacy-weekly');
    assert.deepEqual(JSON.parse(localStorage.getItem('cv_meta')).chestInventory[0].event, migrated,
      'la migración se persiste en la primera lectura');
    assert.deepEqual(withDate('2026-07-25', () => Meta.chestInventory()[0].event), migrated,
      'cambiar de semana no vuelve a fotografiar un cofre ya migrado');

    resetChestAgency(state, TODAY);
    state.chests = 1;
    state.chestInventory = [legacyEntry({
      id: 'weekly:2026-02-31:w_games', week: '2026-02-31', challengeId: 'w_games',
      featuredBooster: 'bomb', source: '<script>',
    })];
    const repaired = withDate(TODAY, () => Meta.chestInventory()[0].event);
    assertStrictEvent(repaired);
    assert.notEqual(repaired.id, 'weekly:2026-02-31:w_games');
    assert.notEqual(repaired.source, '<script>');
  } finally { restore(snapshot); }
});

test('CH-5: snapshots no sobrescriben identidad y UIDs corruptos/duplicados se reparan sin perder cofres', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  const entry = (uid, type) => ({
    uid, type, source: 'legacy', earnedAt: Date.now(), durationMs: 3 * 60 * 60 * 1000,
  });
  try {
    resetChestAgency(state, TODAY);
    Meta.addChest(1, 'wood', 'trusted-source', {
      uid: 'attacker-uid', type: 'divine', source: 'attacker', durationMs: 1,
      earnedAt: 1, arbitrary: '<img onerror=alert(1)>',
    });
    const captured = Meta.chestInventory()[0];
    assert.notEqual(captured.uid, 'attacker-uid');
    assert.equal(captured.type, 'wood');
    assert.equal(captured.source, 'trusted-source');
    assert.equal(captured.durationMs, 3 * 60 * 60 * 1000);
    assert.equal(Object.hasOwn(captured, 'arbitrary'), false);

    resetChestAgency(state, TODAY);
    const runningUid = '../running', readyUid = 'bad uid';
    state.chests = 4;
    state.chestInventory = [
      entry(runningUid, 'bronze'), entry(readyUid, 'bronze'),
      entry('duplicate', 'silver'), entry('duplicate', 'gold'),
    ];
    state.chestUnlock = {
      uid: runningUid, startedAt: Date.now(), endsAt: Date.now() + 60 * 60 * 1000,
      durationMs: 3 * 60 * 60 * 1000,
    };
    state.chestReady = [readyUid];
    state.chestNotifiedReady = [readyUid];

    const repaired = Meta.chestInventory();
    assert.equal(repaired.length, 4, 'reparar identidad no descarta recompensas');
    assert.equal(new Set(repaired.map((chest) => chest.uid)).size, 4);
    repaired.forEach((chest) => assert.match(chest.uid, /^[A-Za-z0-9_-]{1,96}$/));
    assert.notEqual(repaired[0].uid, runningUid);
    assert.notEqual(repaired[1].uid, readyUid);
    assert.equal(repaired[2].uid, 'duplicate', 'el primer UID válido conserva identidad');
    assert.notEqual(repaired[3].uid, 'duplicate', 'solo el duplicado recibe identidad nueva');
    assert.equal(state.chestUnlock.uid, repaired[0].uid, 'el timer sigue apuntando al cofre reparado');
    assert.deepEqual(state.chestReady, [repaired[1].uid]);
    assert.deepEqual(state.chestNotifiedReady, [repaired[1].uid]);
  } finally { restore(snapshot); }
});

test('CH-5: el ciclo genérico completo ya no produce cofres event sin contexto', () => {
  const snapshot = fullSnapshot(), state = Meta.state;
  try {
    resetChestAgency(state, TODAY);
    withDate(TODAY, () => {
      for (let objective = 0; objective < 32 * Meta.CHEST_PIPELINE_TARGET; objective++) {
        Meta.recordChestProgress('test');
      }
    });
    const cycle = Meta.chestInventory().filter((entry) => entry.source === 'pipeline:test');
    assert.equal(cycle.length, 32);
    assert.equal(cycle.some((entry) => entry.type === 'event'), false);
    assert.equal(cycle.every((entry) => !entry.event), true);
  } finally { restore(snapshot); }
});

test('CH-5: Eventos, Picker e i18n exponen la elección de tres premios', () => {
  for (const id of ['events-choice-card', 'events-choice-status', 'events-choice-open']) {
    assert.match(indexHtml, new RegExp(`id="${id}"`), `${id} debe existir en Eventos`);
  }
  assert.match(indexHtml, /data-act="open-daily-choice"/);
  assert.match(indexHtml, /data-i18n="daily_choice_title"/);

  const pickerStart = gameJs.indexOf('function openDailyChoicePicker(');
  const pickerEnd = gameJs.indexOf('function openDailyChoiceFromEvents(', pickerStart);
  const pickerFlow = gameJs.slice(pickerStart, pickerEnd);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  assert.match(pickerFlow, /Meta\.chestChoiceInfo\(uid\)/);
  assert.match(pickerFlow, /choice\.options\.map/);
  assert.match(pickerFlow, /name:\s*reward\.label/);
  assert.match(pickerFlow, /Picker\.open\(/);
  assert.match(pickerFlow, /Meta\.claimChestChoice\(uid, optionId\)/);
  assert.match(gameJs, /function openSelectedChest\([\s\S]*?Meta\.makeChestChoiceReady\(chest\.uid\)/);
  assert.match(gameJs, /function refreshEvents\([\s\S]*?Meta\.dailyChoiceChests\(\)/);
  assert.match(gameJs, /if\s*\(state\s*===\s*'ready'\)[\s\S]*?timed\.hidden\s*=\s*true[\s\S]*?is-single-action/,
    'todo cofre listo debe mostrar un único CTA real');
  assert.match(styles, /\.chest-main-actions\.is-single-action\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);

  const buildStart = gameJs.indexOf('function buildChests()');
  const choiceContentsStart = gameJs.indexOf('if (selected && selected.choice) {', buildStart);
  const normalContentsStart = gameJs.indexOf('} else {', choiceContentsStart);
  const choiceContents = gameJs.slice(choiceContentsStart, normalContentsStart);
  assert.ok(buildStart >= 0 && choiceContentsStart > buildStart && normalContentsStart > choiceContentsStart);
  assert.match(choiceContents, /selected\.choice\.options\.map/);
  assert.match(choiceContents, /chestRewardInfo\(option\)/);
  assert.match(choiceContents, /reward\.label/);
  assert.doesNotMatch(choiceContents, /chestOdds\(/, 'un Choice no puede mostrar la tabla aleatoria del tier');

  assert.match(gameJs, /setInterval\(\(\) => \{\s*if \(HubViews\.current === 'events'\) refreshEvents\(\);\s*else syncHomeChests\(\);[\s\S]*?\}, 30000\)/);
  assert.match(gameJs, /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.hidden\) return;\s*if \(HubViews\.current === 'events'\) refreshEvents\(\);\s*else syncHomeChests\(\);/);
  assert.match(styles, /\.pick-options\s*\{/);
  assert.match(styles, /\.pick-overlay\.safe-delay-active \.pick-opt/);

  const keys = [
    'chest_daily_won', 'chest_daily_catchup_won', 'daily_choice_event_label',
    'daily_choice_title', 'daily_choice_open', 'daily_choice_view', 'daily_choice_ready',
    'daily_choice_waiting', 'daily_choice_opening', 'daily_choice_sub',
    'daily_choice_catchup_sub', 'daily_choice_cancel', 'chest_choice_label',
    'chest_event_featured', 'chest_event_bonus',
  ];
  for (const key of keys) {
    assert.ok(I18n.DICT.es[key], `falta es.${key}`);
    assert.ok(I18n.DICT.en[key], `falta en.${key}`);
  }
});

test('CH-5: Picker mueve/restaura foco, confina Tab y Escape cancela antes de navegar', () => {
  const originalQuerySelector = document.querySelector;
  const originalRaf = window.requestAnimationFrame;
  const originalActive = document.activeElement;
  const originalStatus = State.status;
  const overlay = document.createElement('div');
  const title = document.createElement('h2');
  const sub = document.createElement('p');
  const box = document.createElement('div');
  const first = document.createElement('button');
  const second = document.createElement('button');
  const cancel = document.createElement('button');
  const trigger = document.createElement('button');
  const listeners = {};
  const buttons = [first, second, cancel];
  let cancelled = 0;

  overlay.hidden = true;
  overlay.contains = (node) => buttons.includes(node);
  overlay.querySelector = (selector) => selector === '.pick-opt' ? first : (selector === '#pick-cancel' ? cancel : null);
  overlay.querySelectorAll = (selector) => selector === 'button' ? buttons : [];
  overlay.addEventListener = (type, listener) => { listeners[type] = listener; };
  const nodes = new Map([
    ['#pick-overlay', overlay], ['#pick-title', title], ['#pick-sub', sub],
    ['#pick-options', box], ['#pick-cancel', cancel],
  ]);
  document.querySelector = (selector) => nodes.has(selector) ? nodes.get(selector) : originalQuerySelector(selector);
  window.requestAnimationFrame = (callback) => { callback(); return 1; };
  State.status = 'menu';
  trigger.focus();

  const keyEvent = (key, shiftKey = false) => ({
    key, shiftKey, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  });

  try {
    delete overlay._wired;
    Picker.open({
      title: 'Elige', sub: 'Uno de tres', cancelLabel: 'Ahora no',
      options: [
        { id: 'coins', name: '+100 monedas' },
        { id: 'gems', name: '+8 gemas' },
      ],
      onCancel: () => { cancelled += 1; },
    });
    assert.equal(document.activeElement, first, 'el primer premio recibe foco al abrir');
    assert.match(box.innerHTML, /\+100 monedas/);
    assert.equal(typeof listeners.keydown, 'function');

    cancel.focus();
    const forward = keyEvent('Tab');
    listeners.keydown(forward);
    assert.equal(forward.prevented, true);
    assert.equal(document.activeElement, first, 'Tab desde el final vuelve al primer premio');

    first.focus();
    const backward = keyEvent('Tab', true);
    listeners.keydown(backward);
    assert.equal(backward.prevented, true);
    assert.equal(document.activeElement, cancel, 'Shift+Tab desde el inicio vuelve al último control');

    const escape = keyEvent('Escape');
    listeners.keydown(escape);
    assert.equal(escape.prevented, true);
    assert.equal(escape.stopped, true);
    assert.equal(cancelled, 1);
    assert.equal(Picker.pending, null);
    assert.equal(overlay.hidden, true);
    assert.equal(document.activeElement, trigger, 'cerrar restaura el control que abrió el Picker');

    assert.match(gameJs, /if \(Picker\.pending\) \{ e\.preventDefault\(\); Picker\.cancel\(\); \}/,
      'Escape global debe cancelar Picker antes que Modal/Hub/Game');
    assert.match(gameJs,
      /\['#btn-open-premium', '#btn-open-chest', '#btn-chest-catalog', '#btn-pause', '#nav-home'\][\s\S]*?\.find\([\s\S]*?!element\.hidden\s*&&\s*!element\.disabled[\s\S]*?closest\('\[hidden\]'\)/,
      'si el disparador desaparece, el foco cae en la primera acción realmente visible');
    assert.match(gameJs, /cancel\(\)\s*\{[\s\S]*?this\._close\(false\)[\s\S]*?onCancel[\s\S]*?finally\s*\{\s*this\._restoreFocus\(\)/,
      'el callback de cancelar debe actualizar la vista antes de restaurar el foco');
  } finally {
    if (Picker.pending) Picker.dismiss();
    document.querySelector = originalQuerySelector;
    window.requestAnimationFrame = originalRaf;
    document.activeElement = originalActive;
    State.status = originalStatus;
  }
});

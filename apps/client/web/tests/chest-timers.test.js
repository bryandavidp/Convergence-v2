'use strict';

// CH-3 (docs/CHEST_SYSTEM_MASTER_PLAN.md §5): duraciones consolidadas con tarifa
// plana de gemas, cofres listos que no bloquean y auto-encadenado del siguiente
// temporizador (también offline, anclado al instante exacto de la finalización).

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const { Meta, CHEST_TYPES, CHEST_TYPE_ORDER, CHEST_SKIP_GEMS_PER_HOUR, ChestNotices } = globalThis.window.__cv;

const HOUR = 60 * 60 * 1000;

function fullSnapshot() { return JSON.parse(JSON.stringify(Meta.state)); }
function restore(snap) {
  const m = Meta.state;
  for (const k of Object.keys(m)) delete m[k];
  Object.assign(m, snap);
}
function resetChests(m) {
  m.chests = 0; m.chestInventory = []; m.chestUnlock = null; m.chestReady = []; m.chestNotifiedReady = [];
}
function withNow(now, fn) {
  const previous = Date.now;
  Date.now = () => now;
  try { return fn(); }
  finally { Date.now = previous; }
}
function withRandomSequence(sequence, fn) {
  const previous = Math.random;
  let index = 0;
  Math.random = () => sequence[Math.min(index++, sequence.length - 1)];
  try { return fn(); }
  finally { Math.random = previous; }
}

test('timers: duraciones consolidadas (3/8/12/24/36 h) y tarifa plana de 3 gemas/hora', () => {
  const allowed = new Set([3, 8, 12, 24, 36]);
  for (const id of CHEST_TYPE_ORDER) {
    const defn = CHEST_TYPES[id];
    const hours = defn.durationMs / HOUR;
    assert.ok(allowed.has(hours), `${id}: ${hours}h fuera del set legible`);
    assert.equal(defn.instantCost, hours * CHEST_SKIP_GEMS_PER_HOUR, `${id}: la tarifa debe ser exactamente 3 gemas/hora`);
  }
});

test('timers: cada cofre nuevo guarda su duración y un inventario pre-CH-3 conserva la histórica', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m);
    Meta.addChest(1, 'silver', 'new');
    assert.equal(Meta.chestInventory()[0].durationMs, 8 * HOUR, 'un cofre nuevo captura el catálogo actual');

    m.chests = 2;
    m.chestInventory.push({ uid: 'legacy-bronze', type: 'bronze', source: 'legacy', earnedAt: 1 });
    const legacy = Meta.chestInventory().find((entry) => entry.uid === 'legacy-bronze');
    assert.equal(legacy.durationMs, 4 * HOUR, 'bronce ganado antes de CH-3 conserva sus 4 h');
    const started = Meta.startChestUnlock(legacy.uid);
    assert.equal(started.durationMs, 4 * HOUR);
    assert.equal(Meta.chestInstantCost(legacy.uid), 12, '4 h × 3 gemas/h');
  } finally { restore(snap); }
});

test('timers: chestUnlock legacy conserva reloj y cobra 3 gemas por cada hora restante', () => {
  const snap = fullSnapshot(), m = Meta.state, now = 2_000_000_000_000;
  try {
    resetChests(m);
    m.chests = 1;
    m.chestInventory = [{ uid: 'legacy-royal', type: 'royal', source: 'legacy', earnedAt: 1 }];
    m.chestUnlock = { uid: 'legacy-royal', startedAt: now - 8 * HOUR, endsAt: now + 8 * HOUR };
    withNow(now, () => {
      const unlock = Meta.chestUnlock();
      assert.equal(unlock.durationMs, 16 * HOUR, 'royal pre-CH-3 conserva 16 h');
      assert.equal(unlock.startedAt, now - 8 * HOUR);
      assert.equal(unlock.endsAt, now + 8 * HOUR);
      assert.equal(Meta.chestInstantCost('legacy-royal'), 24);
    });
  } finally { restore(snap); }
});

test('timers: al completarse un desbloqueo, el más corto en espera se encadena solo (offline)', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m);
    Meta.addChest(1, 'silver', 'test'); // 8 h
    Meta.addChest(1, 'wood', 'test');   // 3 h (el más corto: debe encadenarse primero)
    Meta.addChest(1, 'gold', 'test');   // 8 h
    const [silver, wood, gold] = Meta.chestInventory().map((c) => c.uid);
    Meta.startChestUnlock(silver);
    // Simula que terminó hace 4 h: madera encadena en ese instante (3 h → también
    // terminada hace 1 h) y oro arranca hace 1 h.
    m.chestUnlock.startedAt = Date.now() - 12 * HOUR;
    m.chestUnlock.endsAt = Date.now() - 4 * HOUR;
    const ready = Meta.chestReadyUids();
    assert.deepEqual(ready.sort(), [silver, wood].sort());
    const unlock = Meta.chestUnlock();
    assert.equal(unlock.uid, gold);
    assert.equal(unlock.auto, true, 'el encadenado queda marcado como automático');
    assert.ok(Math.abs(unlock.remainingMs - 7 * HOUR) < 5000, `restante ≈7h, fue ${unlock.remainingMs}`);
  } finally { restore(snap); }
});

test('timers: recoger un cofre listo arranca solo el siguiente más corto añadido después', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m);
    Meta.addChest(1, 'gold', 'test');
    const gold = Meta.chestInventory()[0].uid;
    Meta.startChestUnlock(gold);
    m.chestUnlock.endsAt = Date.now() - 1;
    assert.deepEqual(Meta.chestReadyUids(), [gold]);
    Meta.addChest(1, 'wood', 'test');
    const wood = Meta.chestInventory().find((c) => c.uid !== gold).uid;
    withRandomSequence([.5, 0, 0, 0], () => Meta.openChest(gold));
    const unlock = Meta.chestUnlock();
    assert.ok(unlock, 'tras recoger debe quedar un temporizador en curso');
    assert.equal(unlock.uid, wood);
    assert.equal(unlock.auto, true);
  } finally { restore(snap); }
});

test('timers: el catch-up offline estabiliza una reserva superior a doce cofres en una llamada', () => {
  const snap = fullSnapshot(), m = Meta.state, now = 2_000_000_000_000;
  try {
    resetChests(m);
    withNow(now, () => {
      Meta.addChest(14, 'wood', 'test');
      Meta.startChestUnlock(Meta.chestInventory()[0].uid);
      m.chestUnlock.startedAt = now - 43 * HOUR;
      m.chestUnlock.endsAt = now - 40 * HOUR;
      assert.equal(Meta.chestReadyUids().length, 14);
      assert.equal(Meta.chestUnlock(), null, 'no debe quedar un timer ya vencido oculto');
    });
  } finally { restore(snap); }
});

test('timers: la cola automática se ordena por duración guardada y desempata de forma estable', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m);
    Meta.addChest(1, 'gold', 'first');
    Meta.addChest(1, 'wood', 'second');
    Meta.addChest(1, 'silver', 'third');
    m.chestInventory[2].durationMs = 2 * HOUR; // snapshot legado/promocional más corto que su tipo
    const queue = Meta.chestAutoQueue();
    assert.deepEqual(queue.map((entry) => entry.source), ['third', 'second', 'first']);
    assert.deepEqual(queue.map((entry) => entry.durationMs / HOUR), [2, 3, 8]);
  } finally { restore(snap); }
});

test('timers: la reserva puede alimentar el auto-inicio aunque el cofre esté fuera de las ranuras', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m); m.chestSlots = 3;
    Meta.addChest(3, 'gold', 'slot');
    Meta.addChest(1, 'wood', 'reserve');
    const inventory = Meta.chestInventory();
    Meta.startChestUnlock(inventory[0].uid);
    m.chestUnlock.endsAt = Date.now() - 1;
    const unlock = Meta.chestUnlock();
    assert.equal(unlock.uid, inventory[3].uid);
    assert.equal(unlock.source, 'reserve');
    assert.equal(Meta.chestTimerState(inventory[3].uid), 'running');
  } finally { restore(snap); }
});

test('timers: un cofre listo cuesta 0 y uno en espera con otro en curso cobra tarifa completa', () => {
  const snap = fullSnapshot(), m = Meta.state;
  try {
    resetChests(m);
    Meta.addChest(1, 'wood', 'test');
    Meta.addChest(1, 'magic', 'test');
    const [wood, magic] = Meta.chestInventory().map((c) => c.uid);
    Meta.startChestUnlock(wood);
    m.chestUnlock.endsAt = Date.now() - 1; // madera lista → mágico encadena
    assert.equal(Meta.chestInstantCost(wood), 0);
    assert.equal(Meta.chestTimerState(magic), 'running');
    // El mágico acaba de arrancar: la omisión ronda la tarifa completa.
    const cost = Meta.chestInstantCost(magic);
    assert.ok(cost >= CHEST_TYPES.magic.instantCost - 1 && cost <= CHEST_TYPES.magic.instantCost, String(cost));
  } finally { restore(snap); }
});

test('avisos: Notification local se emite una sola vez por UID listo', async () => {
  const snap = fullSnapshot(), m = Meta.state;
  const previousNotification = globalThis.Notification;
  const previousServiceWorker = navigator.serviceWorker;
  const shown = [];
  try {
    resetChests(m);
    Meta.addChest(1, 'wood', 'test');
    const uid = Meta.chestInventory()[0].uid;
    m.chestReady = [uid];
    function FakeNotification(title, options) { shown.push({ title, options }); this.close = () => {}; }
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission = async () => 'granted';
    globalThis.Notification = FakeNotification;
    navigator.serviceWorker = undefined;

    assert.equal(await ChestNotices.sync([uid]), true);
    assert.equal(await ChestNotices.sync([uid]), false);
    assert.equal(shown.length, 1);
    assert.deepEqual(Meta.chestNotifiedReadyUids(), [uid]);
  } finally {
    globalThis.Notification = previousNotification;
    navigator.serviceWorker = previousServiceWorker;
    ChestNotices.pending.clear();
    restore(snap);
  }
});

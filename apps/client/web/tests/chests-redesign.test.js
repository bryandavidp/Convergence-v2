'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('./dom-stub.js');
require('../game.js');

const { Meta, CHEST_TYPES, CHEST_TYPE_ORDER, chestOdds, I18n } = globalThis.window.__cv;
const gameJs = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function gameSourceBetween(start, end) {
  return gameJs.slice(gameJs.indexOf(start), gameJs.indexOf(end, gameJs.indexOf(start)));
}

function snapshot() {
  const m = Meta.state;
  return JSON.parse(JSON.stringify({
    coins: m.coins,
    gems: m.gems,
    tickets: m.tickets,
    chests: m.chests,
    chestInventory: m.chestInventory,
    chestUnlock: m.chestUnlock,
    chestReady: m.chestReady,
    chestSlots: m.chestSlots,
    chestSeq: m.chestSeq,
    boards: m.boards,
    cosmetics: m.cosmetics,
  }));
}

function restore(snap) { Object.assign(Meta.state, snap); }

function withRandomSequence(sequence, fn) {
  const previous = Math.random;
  let index = 0;
  Math.random = () => sequence[Math.min(index++, sequence.length - 1)];
  try { return fn(); }
  finally { Math.random = previous; }
}

test('cofres: catálogo completo con diez atlas y cuatro niveles visuales', () => {
  assert.deepEqual(CHEST_TYPE_ORDER, ['wood', 'bronze', 'silver', 'gold', 'magic', 'royal', 'supreme', 'champion', 'divine', 'event']);
  for (const id of CHEST_TYPE_ORDER) {
    const chest = CHEST_TYPES[id];
    assert.equal(chest.id, id);
    assert.match(chest.asset, new RegExp(`/atlas/${id}\\.png$`));
    assert.ok(chest.durationMs >= 3 * 60 * 60 * 1000);
    assert.ok(chest.instantCost > 0);
    assert.ok(chest.reward.ticketCut <= 1);
  }
});

test('cofres: migra el contador histórico a inventario de madera sin tiradas aleatorias', () => {
  const snap = snapshot(), m = Meta.state;
  try {
    m.chests = 2;
    m.chestInventory = [];
    m.chestUnlock = null;
    let randomCalls = 0;
    const previous = Math.random;
    Math.random = () => { randomCalls++; return .5; };
    try {
      const inventory = Meta.chestInventory();
      assert.equal(inventory.length, 2);
      assert.deepEqual(inventory.map((chest) => chest.type), ['wood', 'wood']);
      assert.equal(randomCalls, 0);
    } finally { Math.random = previous; }
  } finally { restore(snap); }
});

test('cofres: un desbloqueo persiste, calcula omisión proporcional y queda listo', () => {
  const snap = snapshot(), m = Meta.state;
  try {
    m.chests = 0; m.chestInventory = []; m.chestUnlock = null; m.chestReady = []; m.chestSeq = 0;
    Meta.addChest(1, 'wood', 'test');
    const chest = Meta.chestInventory()[0];
    const started = Meta.startChestUnlock(chest.uid);
    assert.equal(started.uid, chest.uid);
    assert.equal(started.ready, false);
    assert.equal(Meta.chestInstantCost(chest.uid), CHEST_TYPES.wood.instantCost);

    // CH-3: al terminar, el cofre pasa a "listo" (no bloquea) y deja de haber
    // desbloqueo en curso; recogerlo es gratis.
    m.chestUnlock.endsAt = Date.now() - 1;
    assert.equal(Meta.chestUnlock(), null);
    assert.deepEqual(Meta.chestReadyUids(), [chest.uid]);
    assert.equal(Meta.chestTimerState(chest.uid), 'ready');
    assert.equal(Meta.chestInstantCost(chest.uid), 0);
    assert.equal(Meta.startChestUnlock(chest.uid), null, 'un cofre listo no se re-inicia');

    // CH-4 añade una tirada previa de mejora de tier; .5 evita el ascenso y 0
    // mantiene determinista la recompensa principal de monedas.
    const reward = withRandomSequence([.5, 0, 0, 0], () => Meta.openChest(chest.uid));
    assert.equal(reward.kind, 'coins');
    assert.equal(reward.amount, 60);
    assert.equal(reward.chestType, 'wood');
    assert.equal(Meta.chests(), 0);
    assert.equal(Meta.chestUnlock(), null);
    assert.deepEqual(Meta.chestReadyUids(), []);
  } finally { restore(snap); }
});

test('cofres: las tablas de alto nivel escalan premio y la cuarta ranura cuesta gemas', () => {
  const snap = snapshot(), m = Meta.state;
  try {
    m.chests = 0; m.chestInventory = []; m.chestUnlock = null; m.chestSlots = 3; m.chestSeq = 0;
    m.coins = 0; m.gems = Meta.CHEST_SLOT_GEMS; m.tickets = 0;
    Meta.addChest(1, 'divine', 'test');
    const divine = Meta.chestInventory()[0];
    const reward = withRandomSequence([0, 0], () => Meta.openChest(divine.uid));
    assert.equal(reward.kind, 'coins');
    assert.equal(reward.amount, 1000);
    assert.equal(reward.rarity, 'mythic');
    assert.equal(reward.chestType, 'divine');

    assert.equal(Meta.unlockChestSlot(), true);
    assert.equal(Meta.chestSlotLimit(), 4);
    assert.equal(m.gems, 0);
    assert.equal(Meta.unlockChestSlot(), true, 'desbloquear de nuevo debe ser idempotente');
  } finally { restore(snap); }
});

test('cofres: preview y ceremonia son regiones exclusivas sin overlays móviles', () => {
  assert.match(styles, /COFRES 3\.1 · responsive móvil orientado a tarea/);
  assert.match(styles, /@media \(max-width: 599px\)/);
  const previewStart = indexHtml.indexOf('id="chest-preview"');
  const previewEnd = indexHtml.indexOf('</section>', previewStart);
  const ceremonyStart = indexHtml.indexOf('id="chest-ceremony"');
  assert.ok(previewStart >= 0 && previewEnd > previewStart && ceremonyStart > previewEnd,
    'preview y ceremonia deben ser secciones hermanas');
  const preview = indexHtml.slice(previewStart, previewEnd);
  assert.match(preview, /id="chest-preview-body"/);
  assert.match(preview, /class="chest-preview-details"/);
  assert.match(preview, /class="chest-open-options chest-main-actions"/);
  assert.match(indexHtml.slice(ceremonyStart), /hidden inert[\s\S]*?id="chests-body"/);
  assert.match(styles, /\.view-chests\.is-ceremony-open \.chest-topbar[\s\S]*?\.chest-catalog \{ display: none; \}/);
  const phoneFlow = styles.slice(styles.indexOf('/* Teléfonos: escenario e información'), styles.indexOf('/* iPhone SE y teléfonos bajos'));
  assert.match(phoneFlow, /\.chest-showcase-shell[\s\S]*?height:\s*auto/);
  assert.match(phoneFlow, /\.chest-selected-card,[\s\S]*?position:\s*relative/);
  assert.doesNotMatch(phoneFlow, /\.chests-body\s*\{\s*position:\s*absolute/);
  assert.doesNotMatch(phoneFlow, /\.chest-selected-card,[\s\S]{0,240}position:\s*absolute/);
  assert.match(styles, /@media \(max-width: 359px\), \(max-width: 480px\) and \(max-height: 700px\)/);
  assert.doesNotMatch(styles, /min-height:\s*220px;\s*\n\s*height:\s*220px/);
  assert.match(styles, /#screen-start \.chest-main-button \{\s*\n\s*min-height:\s*58px/);
  assert.match(styles, /#screen-start \.chest-catalog-card button \{ min-height: 44px/);
});

test('cofres CH-1/4: la banda solo promete categorías con tabla e inventario reales', () => {
  const band = indexHtml.split('chest-rewards-grid')[1].split('</section>')[0];
  assert.ok(band.includes('coin.png') && band.includes('gem.png') && band.includes('ticket.png'), 'monedas/gemas/tickets presentes');
  assert.ok(band.includes('bolt.png') && band.includes('chest_reward_boosters'), 'boosters presentes tras implementar su stock');
  assert.ok(band.includes('planet.png') && band.includes('crystal.png'), 'tableros/temas presentes');
  assert.equal((band.match(/data-i18n="chest_level_scaled"/g) || []).length, 2, 'monedas y gemas declaran el escalado por nivel');
  assert.ok(!band.includes('60 – 2400') && !band.includes('3 – 70'), 'sin rangos globales obsoletos que omitan el escalado');
  assert.ok(!band.includes('potion.png') && !band.includes('chest_reward_objects'), 'sin objetos fantasma');
  assert.ok(!band.includes('chest_reward_surprise'), 'sin "y más…" vago');
});

test('cofres CH-1/4: chestOdds expone tiradas, escalado, bonus y mejora reales por tipo', () => {
  const wood = chestOdds('wood');
  assert.deepEqual(wood.coins, { min: 60, max: 199, pct: 60 });
  assert.equal(wood.gems.pct, 30);
  assert.equal(wood.tickets.pct, 8);
  assert.equal(wood.cosmetic.pct, 2);
  assert.deepEqual(wood.guaranteedCoins, { min: 15, max: 50 });
  assert.equal(wood.rolls, 2);
  assert.deepEqual(wood.upgrade, { to: 'bronze', pct: 10 });
  assert.deepEqual(wood.bonus, {
    count: 0,
    coinsPct: 52, gemsPct: 23, ticketsPct: 13, boosterPct: 12,
    coins: { min: 10, max: 33 }, gems: { min: 1, max: 2 },
  });
  const divine = chestOdds('divine');
  assert.deepEqual(divine.coins, { min: 1000, max: 2400, pct: 20 });
  assert.equal(divine.gems.pct, 12);
  assert.equal(divine.tickets.pct, 8);
  assert.equal(divine.cosmetic.pct, 60);
  assert.equal(divine.rolls, 4);
  assert.equal(divine.bonus.count, 2);
  assert.deepEqual(divine.upgrade, { to: null, pct: 0 });
  const divineLate = chestOdds('divine', 31);
  assert.deepEqual(divineLate.coins, { min: 2500, max: 6000, pct: 20 });
  assert.deepEqual(divineLate.gems, { min: 88, max: 175, pct: 12 });
  assert.deepEqual(divineLate.guaranteedCoins, { min: 625, max: 1500 });
  assert.deepEqual(divineLate.bonus.coins, { min: 25, max: 743 });
  assert.deepEqual(divineLate.bonus.gems, { min: 3, max: 35 });
  // Un tipo desconocido cae a madera, igual que el resto del sistema.
  assert.deepEqual(chestOdds('nope'), chestOdds('wood'));
  // La suma por tipo debe cubrir el 100% (±1 por redondeo).
  for (const id of CHEST_TYPE_ORDER) {
    const o = chestOdds(id);
    const total = o.coins.pct + o.gems.pct + o.tickets.pct + o.cosmetic.pct;
    assert.ok(Math.abs(total - 100) <= 1, `${id}: ${total}%`);
  }
});

test('cofres CH-1: i18n de transparencia presente en ambos idiomas', () => {
  for (const key of [
    'chest_odds_title', 'chest_odds_cosmetic', 'home_chest_opening',
    'chest_guaranteed_coins', 'chest_primary_roll', 'chest_bonus_rolls',
    'chest_bonus_odds', 'chest_upgrade_label', 'chest_upgrade_detail',
    'chest_level_scaled', 'chest_reward_boosters', 'booster_stock',
    'chest_type_panel', 'chest_ceremony_title', 'chest_tier_success_detail',
    'chest_tier_reward_note', 'chest_open_now_cost', 'chest_selected_announcement',
  ]) {
    assert.ok(I18n.DICT.es[key], `es.${key}`);
    assert.ok(I18n.DICT.en[key], `en.${key}`);
  }
});

test('cofres CH-3: Home proyecta el estado y la reserva es una cola visible y seleccionable', () => {
  assert.match(indexHtml, /id="home-chests-nav-state"[^>]*hidden/,
    'Inicio debe mostrar Abriendo/¡Listo! sin duplicar la tarjeta de Eventos');
  assert.match(indexHtml, /class="chest-reserve" id="chest-reserve"/);
  assert.match(styles, /\.chest-reserve-queue\s*\{[^}]*grid-auto-flow:\s*column[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.chest-reserve-item\s*\{/);

  const render = gameSourceBetween('function renderChestSlots(', 'function buildChestCatalog()');
  assert.match(render, /Meta\.chestAutoQueue\(\)/);
  assert.match(render, /data-chest-reserve-slot/);
  assert.match(render, /aria-pressed=/);
  assert.match(render, /focusChestSelection\(selectedChestUid\)/);
  assert.match(render, /queueRank/);
});

test('cofres QA: la fixture de volumen solo opera en local y restaura el perfil', () => {
  assert.match(gameJs, /const qaHost\s*=\s*location\.hostname\s*===\s*'localhost'[\s\S]*?qaParams\.has\('dev'\)/);
  assert.match(gameJs, /const qaMetaSnapshot\s*=\s*localStorage\.getItem\('cv_meta'\)/);
  assert.match(gameJs, /pagehide[\s\S]*?localStorage\.removeItem\('cv_meta'\)[\s\S]*?localStorage\.setItem\('cv_meta',\s*qaMetaSnapshot\)/);
  assert.match(gameJs, /while\s*\(qaCount\s*<\s*24[\s\S]*?Meta\.addGems\(100000\s*-\s*Meta\.gems\(\)\)/);
});

test('cofres CH-3: badge y notificación local son best-effort sin rechazos sin manejar', () => {
  assert.match(gameJs, /const ChestNotices = \{[\s\S]*?Notification\.requestPermission[\s\S]*?chestNotifiedReady/);
  assert.match(gameJs, /badgeResult[\s\S]*?badgeResult\.catch\(\(\) => \{ \}\)/);
  assert.match(gameJs, /visibilitychange[\s\S]*?syncHomeChests\(\)/);
});

test('cofres: carruseles y tablet conservan jerarquía, snap y objetivos táctiles', () => {
  assert.match(styles, /scroll-snap-type:\s*x mandatory/);
  assert.match(styles, /grid-auto-columns:\s*clamp\(150px,\s*48vw,\s*176px\)/);
  assert.match(styles, /grid-auto-columns:\s*clamp\(104px,\s*31vw,\s*124px\)/);
  assert.match(styles, /@media \(min-width: 600px\) and \(max-width: 760px\)/);
  assert.match(styles, /\.chest-preview-details \{ grid-template-columns:\s*minmax\(180px,\s*\.85fr\) minmax\(0,\s*1\.5fr\)/);
  assert.match(styles, /@media \(max-width: 350px\)[\s\S]*?\.chest-catalog-grid \{ grid-template-columns: 1fr; \}/);
});

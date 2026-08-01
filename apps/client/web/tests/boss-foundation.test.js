/* JF-α (docs/BOSS_SYSTEM_MASTER_PLAN.md §9): cimientos del sistema de encuentros.
 * Con Bosses.ENCOUNTERS=false (el default de producción hasta JF-γ) el juego se
 * comporta EXACTAMENTE como antes; estos tests encienden el flag localmente para
 * ejercitar el framework: registro DEX, actos/niveles/sorteo, anclas (daño por
 * convergencia encima, blindaje por adyacencia, inmunidad a objetos), FSM del
 * encuentro (ataques por acumulador, fases, derrota/retirada) e invariantes. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
const { State, Survival, Bosses, Tiles, Engine, Game, RNG, Render } = cv;
cv.Render.buildBoard();

/* Partida de Supervivencia mínima y tablero controlado. OJO: fuera de Game.start
 * State.board no existe como array de 64 nulls — celdas `undefined` (≠ null) rompen
 * Engine.converging/emptyCells; hay que construirlo explícitamente. */
function freshRun(wave) {
  Survival._mutOverride = 'none';
  State.mode = 'supervivencia'; State.diff = 'normal'; State.status = 'playing';
  Survival.start();
  Survival.wave = wave || 1;
  Survival._lastBossType = null; Survival._bossOverride = null;
  State.size = 8;
  State.board = new Array(64).fill(null);
  State.tiles = new Array(64).fill(null);
  State.iconCount = 0;
}
function fillIcons(n) {
  for (let i = 0; i < n && i < State.board.length; i++) {
    if (State.board[i] === null) { State.board[i] = State.pool[i % State.pool.length]; State.iconCount++; }
  }
}
function bossTiles() { return State.tiles.filter((t) => t && t.type === 'boss').length; }
function withRng(v, fn) {
  const orig = RNG.random;
  RNG.random = typeof v === 'function' ? v : () => v;
  try { return fn(); } finally { RNG.random = orig; }
}
/* El default de producción del flag se captura ANTES de cualquier test (JF-γ lo
 * enciende); cleanup lo restaura en vez de forzar un valor. */
const FLAG_DEFAULT = Bosses.ENCOUNTERS;
function cleanup() {
  Bosses.abort();
  Bosses.ENCOUNTERS = FLAG_DEFAULT;
  Survival._bossOverride = null; Survival._mutOverride = 'none';
  Survival._beatQ = []; Survival._beatSeq = 0;
  State.status = 'idle';
}

test('JF-01: registro DEX — 5 señores + La Corte Profunda con acto, acento, anclas y ataque', () => {
  const ids = Object.keys(Bosses.DEX);
  assert.deepEqual(ids.sort(), ['crystalid', 'frost', 'lockdown', 'meteor', 'puppeteer', 'quake', 'tide', 'void'].sort());
  for (const id of ids) {
    const d = Bosses.DEX[id];
    assert.ok(d.acto >= 1 && d.acto <= 3, `${id}: acto válido`);
    assert.match(d.accent, /^#[0-9a-f]{6}$/i, `${id}: acento hex`);
    assert.ok(d.anchors >= 2 && d.anchors <= 4, `${id}: anclas 2-4`);
    assert.ok(d.attackMs >= 8000, `${id}: cadencia de ataque razonable`);
    assert.ok(d.atk && d.frame, `${id}: ataque y marco definidos`);
  }
  assert.equal(Bosses.DEX.quake.chaosPromote, true, 'el caos promueve a Tectónico');
  assert.equal(Bosses.DEX.tide.edgeAnchors, true, 'La Corriente ancla en los bordes');
});

test('JF-03: actoForWave y levelForWave (eco/heraldo, tope PESADILLA)', () => {
  assert.equal(Bosses.actoForWave(6), 1);
  assert.equal(Bosses.actoForWave(12), 2);
  assert.equal(Bosses.actoForWave(23), 2);
  assert.equal(Bosses.actoForWave(24), 3);
  assert.equal(Bosses.levelForWave(6), 1);
  assert.equal(Bosses.levelForWave(18), 2);
  assert.equal(Bosses.levelForWave(30), 3);
  assert.equal(Bosses.levelForWave(48), 3, 'el nivel base topa en III');
  assert.equal(Bosses.levelForWave(6, { eco: true }), 2, 'eco = +1 nivel');
  assert.equal(Bosses.levelForWave(30, { eco: true }), 4, 'eco sobre III = PESADILLA');
  assert.equal(Bosses.levelForWave(30, { eco: true, herald: true }), 4, 'tope absoluto IV');
});

test('JF-03: pick respeta actos, promoción del caos, no-repetición y eco', () => {
  freshRun(5);
  try {
    // Sin eco (roll alto) y sin último jefe: solo Acto I en oleada 6.
    withRng(0.99, () => {
      for (let k = 0; k < 30; k++) {
        const id = Bosses.pick(6);
        assert.ok(['meteor', 'tide', 'frost'].includes(id), `oleada 6 solo Acto I, salió ${id}`);
      }
    });
    // Acto II disponible en oleada 12+ (roll siempre ≥0.2: nunca eco).
    const seen = new Set();
    const origR = RNG.random; RNG.random = () => 0.2 + 0.79 * Math.random();
    try { for (let k = 0; k < 200; k++) seen.add(Bosses.pick(15)); } finally { RNG.random = origR; }
    assert.ok(seen.has('lockdown') && seen.has('quake'), 'Acto II entra en oleada 12+');
    // Semana del caos: quake promovido al Acto I.
    Survival._mutOverride = 'chaos';
    const seenChaos = new Set();
    const origR2 = RNG.random; RNG.random = () => 0.2 + 0.79 * Math.random();
    try { for (let k = 0; k < 200; k++) seenChaos.add(Bosses.pick(6)); } finally { RNG.random = origR2; }
    assert.ok(seenChaos.has('quake'), 'caos promueve a Tectónico desde el Acto I');
    Survival._mutOverride = 'none';
    // No-repetición inmediata (con eco desactivado por roll alto).
    Survival._lastBossType = 'meteor';
    withRng(0.99, () => {
      for (let k = 0; k < 40; k++) assert.notEqual(Bosses.pick(6), 'meteor', 'sin repetición inmediata');
    });
    // Eco: roll bajo con jefe previo devuelve 'eco'.
    withRng(0.01, () => { assert.equal(Bosses.pick(6), 'eco'); });
    Survival._lastBossType = null;
    withRng(0.01, () => { assert.notEqual(Bosses.pick(6), 'eco', 'sin jefe previo no hay eco'); });
  } finally { cleanup(); }
});

test('JF-02: ancla normal — converger el icono de encima la golpea y dispara la fase', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    const A = State.pool[0];
    State.board[0] = A; State.board[2] = A; State.iconCount = 2;
    State.tiles[0] = Tiles.make('boss');
    // Encuentro artesanal (control total del tablero).
    Bosses.enc = { id: 'meteor', lvl: 1, kind: 'boss', phase: 1, anchorsMax: 2, anchorsLeft: 2, ms: 0, atkAcc: 0, reincAcc: 0, attackEvery: 12000, durMs: 50000, telegraphed: false, targets: null, flawless: true, attacks: 0 };
    Game.activate(1); // converge 0 y 2 (icono sobre el ancla incluido)
    assert.equal(State.tiles[0], null, 'el ancla golpeada desaparece');
    assert.equal(Bosses.enc.anchorsLeft, 1, 'el golpe descuenta PV');
    assert.equal(Bosses.enc.phase, 2, 'a mitad de anclas entra la fase 2');
  } finally { cleanup(); }
});

test('JF-02: ancla blindada — icono atrapado (no converge) hasta romper el blindaje por adyacencia', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    const A = State.pool[0];
    State.board[0] = A; State.board[2] = A; State.iconCount = 2;
    const t = Tiles.make('boss'); t.hits = 1; t.solid = true; State.tiles[0] = t;
    Bosses.enc = { id: 'lockdown', lvl: 2, kind: 'boss', phase: 1, anchorsMax: 3, anchorsLeft: 3, ms: 0, atkAcc: 0, reincAcc: 0, attackEvery: 13000, durMs: 50000, telegraphed: false, targets: null, flawless: true, attacks: 0 };
    const conv = Engine.converging(1);
    assert.ok(!conv.includes(0) && conv.length < 2, 'el blindaje atrapa el icono y corta la visión');
    // Convergencia ADYACENTE al ancla: agrieta el blindaje.
    Survival.frenzy = 0;
    Survival.onConverge({ removed: 0, combo: 0, cells: [1], center: 1 });
    assert.equal(State.tiles[0].hits, 0, 'blindaje roto');
    assert.equal(State.tiles[0].solid, false, 'ancla expuesta');
    const conv2 = Engine.converging(1);
    assert.ok(conv2.includes(0) && conv2.includes(2), 'expuesta, el icono ya converge');
  } finally { cleanup(); }
});

test('JF-02: anclas y jaulas inmunes a objetos/alivio; la bomba agrieta y la jaula devuelve botín', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    const A = State.pool[0];
    State.board[10] = A; State.iconCount = 1;
    const anchor = Tiles.make('boss'); anchor.hits = 1; anchor.solid = true; State.tiles[10] = anchor;
    // _powerClear (vía de bombas/rayo/escoba/alivio) no toca al jefe ni a su icono.
    const cleared = [];
    assert.equal(Survival._powerClear(10, cleared), 0);
    assert.ok(State.tiles[10] && State.board[10] === A, 'ancla e icono intactos');
    // La bomba agrieta el blindaje 1 nivel (sin destruir el ancla).
    Survival.inv.bomb = 1; Survival.armed = null;
    Survival.applyBoosterAt('bomb', 11); // área 3×3 cubre la 10
    assert.ok(State.tiles[10], 'la bomba no destruye el ancla');
    assert.equal(State.tiles[10].hits, 0, 'la bomba agrieta el blindaje');
    assert.equal(State.tiles[10].solid, false);
    // Jaula: se rompe por adyacencia y devuelve el botín.
    const cage = Tiles.make('cage'); cage.hits = 1; cage.loot = 'freeze'; State.tiles[20] = cage;
    const before = Survival.inv.freeze || 0;
    Bosses.crackAt(20);
    assert.equal(State.tiles[20], null, 'jaula rota');
    assert.equal(Survival.inv.freeze, before + 1, 'botín devuelto');
  } finally { cleanup(); }
});

test('JF-α: startEncounter coloca anclas bajo iconos, respeta caps y un solo encuentro', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(24);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e, 'encuentro creado');
    assert.equal(e.lvl, 1);
    assert.equal(bossTiles(), e.anchorsMax, 'anclas en el tablero = PV');
    Bosses._anchorIdx().forEach((i) => assert.notEqual(State.board[i], null, 'ancla BAJO un icono'));
    const specials = State.tiles.filter((t) => t && t.type !== 'crystal').length;
    assert.ok(specials <= Survival._specialCap(), 'anclas dentro del cap de especiales');
    // Invariante: máximo un encuentro.
    assert.equal(Bosses.startEncounter('frost'), null, 'segundo encuentro rechazado');
    assert.equal(Bosses.enc.id, 'meteor');
    Bosses.abort();
    assert.equal(Bosses.enc, null); assert.equal(bossTiles(), 0, 'abort limpia anclas');
  } finally { cleanup(); }
});

test('JF-α: sin sustrato (tablero vacío) cae al jefe-evento clásico con su ritual', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    Survival._bossSurvivedAt = 0; Survival._boonAt = 0;
    const e = Bosses.startEncounter('meteor'); // tablero sin iconos: no hay dónde anclar
    assert.equal(e, null);
    assert.equal(Bosses.enc, null);
    assert.ok(Survival._boonAt > 0, 'el fallback programa la bendición como el evento clásico');
  } finally { cleanup(); }
});

test('JF-α: derrota — romper todas las anclas resuelve y programa beat + bendición', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('frost'); // 2 anclas, sin blindaje
    assert.ok(e && e.anchorsMax === 2);
    Survival._bossSurvivedAt = 0; Survival._boonAt = 0; Survival._bossesDefeated = 0;
    const idx = Bosses._anchorIdx();
    Bosses.onAnchorHit(idx[0]); State.tiles[idx[0]] = null; // el converge real retira el tile
    assert.equal(Bosses.enc.anchorsLeft, 1);
    Bosses.onAnchorHit(idx[1]); State.tiles[idx[1]] = null;
    assert.equal(Bosses.enc, null, 'derrota resuelve el encuentro');
    assert.equal(bossTiles(), 0, 'sin anclas huérfanas');
    assert.equal(Survival._bossesDefeated, 1);
    assert.ok(Survival._lastDefeat && Survival._lastDefeat.id === 'frost' && Survival._lastDefeat.flawless === true);
    assert.ok(Survival._bossSurvivedAt > 0 && Survival._boonAt > 0, 'beat y bendición programados');
  } finally { cleanup(); }
});

test('JF-α: retirada — el encuentro expira por acumulador de dt y ataca por el camino', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    Survival._boonAt = 0;
    let guard = 0;
    while (Bosses.enc && guard < 1500) { Bosses.tick(100); guard++; }
    assert.equal(Bosses.enc, null, 'el encuentro termina solo (retirada)');
    assert.ok(e.attacks >= 3, `ataca varias veces durante ~2 oleadas (${e.attacks})`);
    assert.equal(bossTiles(), 0, 'las anclas se retiran con el jefe');
    assert.ok(Survival._boonAt > 0, 'retirada = bendición como siempre');
  } finally { cleanup(); }
});

test('JF-γ: el flag de producción está ENCENDIDO y bossEvent arranca encuentros', () => {
  assert.equal(Bosses.ENCOUNTERS, true, 'JF-γ enciende los encuentros en producción');
  freshRun(6);
  try {
    fillIcons(20);
    Survival._bossOverride = 'meteor';
    Survival._planBoss(); Survival._nextBoss = 'meteor';
    Survival.bossEvent();
    assert.ok(Bosses.enc && Bosses.enc.id === 'meteor', 'bossEvent arranca el encuentro');
    assert.ok(bossTiles() > 0, 'anclas en el tablero');
  } finally { cleanup(); }
});

test('JF-α: interruptor de emergencia — con flag APAGADO el jefe-evento clásico sigue intacto', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = false;
    fillIcons(20);
    Survival._bossOverride = 'meteor';
    Survival.bossEvent();
    assert.equal(Bosses.enc, null, 'sin encuentro con el flag apagado');
    assert.equal(bossTiles(), 0, 'sin anclas con el flag apagado');
    assert.ok(Survival._boonAt > 0, 'el ritual clásico sigue');
  } finally { cleanup(); }
});

test('JF-α: matriz jefes × niveles — cada encuentro corre completo sin excepción y con invariantes', () => {
  const waves = { 1: 6, 2: 18, 3: 26 };
  for (const id of Object.keys(Bosses.DEX)) {
    for (const lvl of [1, 2, 3]) {
      freshRun(waves[lvl]);
      try {
        Bosses.ENCOUNTERS = true;
        fillIcons(28);
        const e = Bosses.startEncounter(id);
        assert.ok(e, `${id} Nv.${lvl}: encuentro creado`);
        assert.equal(e.lvl, lvl, `${id}: nivel por oleada`);
        let guard = 0;
        while (Bosses.enc && guard < 1500) {
          Bosses.tick(100); guard++;
          if (guard % 20 === 0) {
            const filled = State.board.filter((v) => v !== null).length;
            assert.ok(filled >= 0 && filled <= 64, `${id} Nv.${lvl}: iconos en [0,64]`);
            assert.equal(filled, State.iconCount, `${id} Nv.${lvl}: iconCount consistente`);
            const specials = State.tiles.filter((t) => t && t.type !== 'crystal').length;
            assert.ok(specials <= Survival._specialCap() + 2, `${id} Nv.${lvl}: especiales acotados (${specials})`);
          }
        }
        assert.equal(Bosses.enc, null, `${id} Nv.${lvl}: el encuentro TERMINA`);
        assert.equal(bossTiles(), 0, `${id} Nv.${lvl}: sin anclas huérfanas`);
        assert.ok(e.attacks >= 2, `${id} Nv.${lvl}: atacó (${e.attacks})`);
      } finally { cleanup(); }
    }
  }
});

test('JF-α: eco — startEncounter("eco") repite el último jefe real a nivel +1', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    Survival._lastBossType = 'frost';
    const e = Bosses.startEncounter('eco');
    assert.ok(e);
    assert.equal(e.id, 'frost', 'el eco repite al último jefe real');
    assert.equal(e.lvl, 2, 'eco = nivel +1 (oleada 6 daría Nv.1)');
  } finally { cleanup(); }
});

test('JF-γ: fase 2 del Cerrajero — la Jaula roba un potenciador y devolverlo funciona', () => {
  freshRun(14);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(24);
    const e = Bosses.startEncounter('lockdown');
    assert.ok(e);
    e.phase = 2;
    Survival.inv = { bomb: 1, freeze: 0, clearLine: 0, wild: 0, x2: 0 };
    const stole = Bosses._cageSteal(Survival._emptyIdx().slice(0, 3));
    assert.equal(stole, true, 'con inventario de run, roba');
    assert.equal(Survival.inv.bomb, 0, 'el potenciador robado sale del inventario');
    const cageIdx = State.tiles.findIndex((t) => t && t.type === 'cage');
    assert.ok(cageIdx >= 0, 'jaula plantada en el tablero');
    assert.equal(State.tiles[cageIdx].loot, 'bomb');
    // Romperla por adyacencia la devuelve.
    Bosses.crackAt(cageIdx);
    assert.equal(State.tiles[cageIdx], null);
    assert.equal(Survival.inv.bomb, 1, 'jaula rota devuelve el botín');
    // Sin inventario de run: no roba (cae al cierre normal).
    Survival.inv = { bomb: 0, freeze: 0, clearLine: 0, wild: 0, x2: 0 };
    assert.equal(Bosses._cageSteal(Survival._emptyIdx().slice(0, 3)), false);
  } finally { cleanup(); }
});

test('JF-γ: efectos de derrota — deshielo de Boreal y devolución exacta del Cerrajero', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(24);
    // Boreal: hielo en el tablero + derrota → descongela todo y da carga.
    State.tiles[30] = Tiles.make('frozen'); State.tiles[31] = Tiles.make('frozen');
    Survival.charge = 10;
    Bosses._defeatEffect({ id: 'frost', lvl: 1 });
    assert.equal(State.tiles[30], null); assert.equal(State.tiles[31], null);
    assert.equal(Survival.charge, 35, 'deshielo + 25 de suministro');
    // Cerrajero: jaula pendiente → derrota devuelve exactamente lo robado.
    const cg = Tiles.make('cage'); cg.hits = 1; cg.loot = 'freeze'; State.tiles[40] = cg;
    Survival.inv.freeze = 0;
    Bosses._defeatEffect({ id: 'lockdown', lvl: 1 });
    assert.equal(State.tiles[40], null, 'la jaula se abre al caer el jefe');
    assert.equal(Survival.inv.freeze, 1, 'devuelve exactamente lo enjaulado');
    // La Corriente: derrota vacía las filas exteriores.
    fillIcons(64);
    const before = State.board.filter((v) => v !== null).length;
    Bosses._defeatEffect({ id: 'tide', lvl: 1 });
    for (let c = 0; c < 8; c++) { assert.equal(State.board[c], null); assert.equal(State.board[56 + c], null); }
    assert.ok(State.board.filter((v) => v !== null).length < before);
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'iconCount consistente tras el efecto');
  } finally { cleanup(); }
});

test('JF-γ: botín de derrota y Ronda maestra (+1 vida, o carga al tope)', () => {
  freshRun(6);
  try {
    State.status = 'playing';
    Survival.lives = 2; Survival.MAX_LIVES = 3; Survival.charge = 0;
    const coins0 = cv.Meta.coins();
    Survival._encounterEnd({ id: 'frost', lvl: 2, flawless: true }, 'defeat');
    Survival._bossSurvived();
    assert.equal(cv.Meta.coins(), coins0 + 8 + 4 * 2, 'botín: 8 + 4×nivel');
    assert.equal(Survival.lives, 3, 'Ronda maestra: +1 vida');
    // Al tope de vidas: la Ronda maestra paga en carga.
    Survival.lives = Survival.MAX_LIVES + 1; Survival.charge = 0;
    Survival._encounterEnd({ id: 'frost', lvl: 1, flawless: true }, 'defeat');
    Survival._bossSurvived();
    assert.equal(Survival.lives, Survival.MAX_LIVES + 1, 'vidas al tope no suben');
    assert.equal(Survival.charge, 50, 'paga +50 de carga');
    // Sin flawless: solo botín.
    Survival.lives = 2; Survival.charge = 0;
    Survival._encounterEnd({ id: 'meteor', lvl: 1, flawless: false }, 'defeat');
    Survival._bossSurvived();
    assert.equal(Survival.lives, 2); assert.equal(Survival.charge, 0);
  } finally { cleanup(); }
});

test('JF-γ: fase 2 de Nubarrón deja roca y la de Tectónico añade rocas tras el terremoto total', () => {
  freshRun(14);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    e.phase = 2;
    e.targets = Survival._emptyIdx().slice(0, 4);
    const rocks0 = State.tiles.filter((t) => t && t.type === 'rock').length;
    Bosses._attack(e);
    const rocks1 = State.tiles.filter((t) => t && t.type === 'rock').length;
    assert.ok(rocks1 >= rocks0 + 1, 'la lluvia de fase 2 deja roca');
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'conteo consistente');
    Bosses.abort();
    // Tectónico fase 2: terremoto total + rocas (respetando topes).
    const e2 = Bosses.startEncounter('quake');
    assert.ok(e2);
    e2.phase = 2; e2.targets = null;
    const rocksQ0 = State.tiles.filter((t) => t && t.type === 'rock').length;
    Bosses._attack(e2);
    const rocksQ1 = State.tiles.filter((t) => t && t.type === 'rock').length;
    assert.ok(rocksQ1 >= rocksQ0, 'rocas no bajan; suben si hay hueco y tope');
    const blocks = Survival._blockIdx().length;
    assert.ok(blocks <= Survival._blockCap(), 'tope de bloqueos respetado');
  } finally { cleanup(); }
});

test('JF-β: claves i18n del bestiario en ES y EN', () => {
  const keys = [];
  for (const id of Object.keys(Bosses.DEX)) keys.push('bossdex_' + id, 'bossdex_' + id + '_e', 'bossatk_' + id + '_1', 'bossatk_' + id + '_2');
  for (const id of Object.keys(Bosses.MINIDEX)) keys.push('minidex_' + id, 'minidex_' + id + '_e');
  keys.push('surv_boss_lvl', 'surv_boss_hp_sr', 'surv_boss_enter_sr', 'surv_boss_prep', 'surv_boss_phase2', 'surv_boss_defeated', 'surv_boss_retreat',
    'surv_boss_cage_steal', 'surv_master_round', 'surv_master_round_charge',
    'mini_steal', 'mini_return', 'mini_firefly_gift', 'mini_sentinel_gift', 'mini_herald_down', 'mini_herald_up', 'mini_gone', 'sr_mini_enter', 'sr_mini_down',
    'surv_boss_shards', 'surv_boss_regrow', 'surv_boss_devour', 'surv_boss_grow', 'surv_boss_threads', 'surv_boss_heal',
    'surv_boss_crystalid_warn', 'surv_boss_void_warn', 'surv_boss_puppeteer_warn',
    'feat_cazador', 'feat_cazador_d', 'feat_ronda_maestra', 'feat_ronda_maestra_d', 'feat_domaecos', 'feat_domaecos_d');
  for (const lang of ['es', 'en']) for (const k of keys) assert.ok(cv.I18n.DICT[lang][k], `falta ${k} en ${lang}`);
});

test('JF-δ: sorteo de minijefes — pity, exclusiones de oleada de jefe/previa y nunca 2 seguidos', () => {
  freshRun(4);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    // Pity: sin suerte (roll alto), al llegar al umbral aparece igualmente.
    Survival.bossNext = false;
    Bosses._miniDry = Bosses.MINI_PITY - 1; Bosses._lastWaveMini = false;
    withRng(0.99, () => Bosses.maybeMini());
    assert.ok(Bosses.enc && Bosses.enc.kind === 'mini', 'el pity garantiza el minijefe');
    const firstId = Bosses.enc.id;
    assert.ok(['magpie', 'firefly'].includes(firstId), 'Acto I solo trae minis de Acto I');
    Bosses.abort();
    // Nunca 2 seguidos.
    Bosses._lastWaveMini = true; Bosses._miniDry = 99;
    withRng(0.01, () => Bosses.maybeMini());
    assert.equal(Bosses.enc, null, 'tras un mini, la siguiente oleada descansa');
    // Oleada previa a jefe en Acto I: nada (el Heraldo es Acto II+).
    Survival.bossNext = true; Bosses._lastWaveMini = false;
    withRng(0.01, () => Bosses.maybeMini());
    assert.equal(Bosses.enc, null, 'sin Heraldo en Acto I');
    // Oleada previa a jefe en Acto II: el Heraldo puede aparecer.
    Survival.wave = 16;
    withRng(0.01, () => Bosses.maybeMini());
    assert.ok(Bosses.enc && Bosses.enc.id === 'herald', 'el Heraldo anuncia al jefe en Acto II');
  } finally { cleanup(); }
});

test('JF-δ: la Urraca roba con conteo consistente y devolverla agrupa el botín', () => {
  freshRun(5);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(24);
    const e = Bosses.startMini('magpie');
    assert.ok(e);
    const count0 = State.iconCount;
    Bosses._miniBeat(e); // roba 1
    assert.equal(e.stolen.length, 1);
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'conteo consistente tras el robo');
    assert.equal(State.iconCount, count0 - 1);
    // Cazarla devuelve lo robado.
    const at = e.at;
    Bosses.onAnchorHit(at); State.tiles[at] = null;
    assert.equal(Bosses.enc, null, 'cazada');
    assert.equal(State.iconCount, count0, 'los iconos robados vuelven al tablero');
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount);
  } finally { cleanup(); }
});

test('JF-δ: el Centinela congela su territorio y al caer lo limpia con suelo', () => {
  freshRun(5);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(32);
    const e = Bosses.startMini('sentinel');
    assert.ok(e);
    assert.ok(State.tiles[e.at].hits >= 1, 'el Centinela llega blindado');
    State.tiles[e.at].hits = 0; State.tiles[e.at].solid = false; // exponerlo para el test
    const frozen0 = State.tiles.filter((t) => t && t.type === 'frozen').length;
    Bosses._miniBeat(e);
    const frozen1 = State.tiles.filter((t) => t && t.type === 'frozen').length;
    assert.ok(frozen1 >= frozen0, 'congela en su fila/columna cuando hay hueco');
    const at = e.at;
    Bosses.onAnchorHit(at); State.tiles[at] = null;
    assert.equal(Bosses.enc, null);
    assert.ok(State.iconCount >= 8 || State.board.filter((v) => v !== null).length <= 8, 'suelo anti-inflación respetado');
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'conteo consistente');
  } finally { cleanup(); }
});

test('JF-δ: el Heraldo — escapar empodera al jefe (+1 nivel) y cazarlo lo debilita (−1)', () => {
  freshRun(17); // oleada 17: previa al jefe de la 18 (bossEvery 6), Acto II
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(24);
    const h = Bosses.startMini('herald');
    assert.ok(h);
    // Escapa (el jefe llega): startEncounter consume al mini y lee el empoderamiento.
    Survival.wave = 18;
    const e = Bosses.startEncounter('meteor');
    assert.ok(e, 'el jefe arranca consumiendo al Heraldo');
    assert.equal(e.lvl, 3, 'oleada 18 = Nv.II, +1 por Heraldo vivo = Nv.III');
    Bosses.abort();
    // Cazado: el siguiente jefe llega debilitado.
    Survival.wave = 17;
    fillIcons(24);
    const h2 = Bosses.startMini('herald');
    assert.ok(h2);
    Bosses.onAnchorHit(h2.at); State.tiles[h2.at] = null;
    assert.equal(Bosses.enc, null, 'Heraldo cazado');
    Survival.wave = 18;
    const e2 = Bosses.startEncounter('frost');
    assert.equal(e2.lvl, 1, 'Nv.II − 1 por Heraldo caído = Nv.I');
  } finally { cleanup(); }
});

test('JF-δ: la Luciérnaga es bonus — cazarla da frenesí; y expira sola', () => {
  freshRun(5);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startMini('firefly');
    assert.ok(e);
    Survival.frenzy = 0; Survival.frenzyUntil = 0;
    Bosses.onAnchorHit(e.at); State.tiles[e.at] = null;
    assert.equal(Survival.frenzy, 24, 'toque dorado: +24 de frenesí');
    // Expiración: se marcha sola sin bendición ni beat.
    fillIcons(20);
    const e2 = Bosses.startMini('firefly');
    assert.ok(e2);
    Survival._boonAt = 0;
    let g = 0; while (Bosses.enc && g < 400) { Bosses.tick(100); g++; }
    assert.equal(Bosses.enc, null, 'la Luciérnaga se va sola');
    assert.equal(Survival._boonAt, 0, 'los minijefes NO dan bendición');
  } finally { cleanup(); }
});

test('JF-β: el banner se enciende con el encuentro y se apaga al resolverse', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('tide');
    assert.ok(e);
    Survival.render();
    const banner = document.querySelector('#surv-boss');
    const bar = document.querySelector('#surv-bar');
    assert.equal(banner.hidden, false, 'banner visible durante el encuentro');
    assert.ok(bar.classList.contains('encounter'), 'panel tintado');
    assert.equal(document.querySelector('#surv-boss-name').textContent, cv.I18n.t('bossdex_tide'));
    assert.equal(document.querySelector('#surv-boss-hp').textContent, '◆'.repeat(e.anchorsMax));
    assert.match(document.querySelector('#surv-boss-next').textContent, /\d+s$/, 'píldora con cuenta atrás');
    // Golpe → PV baja y la firma re-renderiza los pips.
    const idx = Bosses._anchorIdx()[0];
    Bosses.onAnchorHit(idx); State.tiles[idx] = null;
    Survival.render();
    assert.equal(document.querySelector('#surv-boss-hp').textContent, '◆'.repeat(e.anchorsLeft) + '◇'.repeat(e.anchorsMax - e.anchorsLeft));
    Bosses.resolve('retreat');
    Survival.render();
    const resCard = document.querySelector('#surv-boss-result');
    assert.equal(resCard.hidden, false, 'card de resultado visible durante la retirada');
    assert.ok(resCard.classList.contains('resolved'));
    Bosses.face.resolveUntil = globalThis.performance.now() - 1;
    Bosses.tick(16);
    Survival.render();
    assert.equal(resCard.hidden, true, 'card de resultado apagada tras expirar la retirada');
    assert.ok(!bar.classList.contains('encounter'));
  } finally { cleanup(); }
});

test('BP-0: el banner muestra el ataque y el primer ataque tiene ventana de lectura', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    assert.equal(e.attackEvery - e.atkAcc, Bosses.FIRST_ATTACK_MS, 'primer ataque retrasado para leer card/anclas');
    Survival.render();
    assert.ok(document.querySelector('#surv-boss-next').textContent.includes(Bosses.atkName(e)), 'pildora nombra el ataque');
  } finally { cleanup(); }
});

test('BP-0: fase 2 concede gracia antes del siguiente impacto', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    e.atkAcc = e.attackEvery - 100;
    e.telegraphed = true;
    e.targets = [0, 1];
    const idx = Bosses._anchorIdx();
    Bosses.onAnchorHit(idx[0]); State.tiles[idx[0]] = null;
    Bosses.onAnchorHit(idx[1]); State.tiles[idx[1]] = null;
    assert.equal(e.phase, 2);
    assert.ok(e.attackEvery - e.atkAcc >= Bosses.PHASE_ATTACK_GRACE_MS, 'fase 2 no encadena ataque inmediato');
    assert.equal(e.telegraphed, false, 'tell anterior cancelado tras cambio de fase');
    assert.equal(e.targets, null, 'targets viejos descartados');
  } finally { cleanup(); }
});

test('BP-0: el banner persiste brevemente tras derrota y luego se apaga', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('frost');
    assert.ok(e);
    Survival.render();
    Bosses.resolve('defeat');
    Survival.render();
    const resCard = document.querySelector('#surv-boss-result');
    assert.equal(resCard.hidden, false, 'tarjeta dedicada de resultado visible durante resolucion');
    assert.ok(resCard.classList.contains('resolved'));
    assert.ok(document.querySelector('#surv-boss-result-name').textContent.includes(Bosses.name('frost')));
    Bosses.face.resolveUntil = globalThis.performance.now() - 1;
    Bosses.tick(16);
    Survival.render();
    assert.equal(resCard.hidden, true, 'tarjeta dedicada de resultado apagada al terminar resolucion');
  } finally { cleanup(); }
});

test('BP-1: cada ataque de jefe usa una premarca visual especifica', () => {
  assert.equal(Bosses.warnClass({ id: 'meteor' }), 'boss-warn-meteor');
  assert.equal(Bosses.warnClass({ id: 'tide' }), 'boss-warn-tide');
  assert.equal(Bosses.warnClass({ id: 'frost' }), 'boss-warn-frost');
  assert.equal(Bosses.warnClass({ id: 'lockdown' }), 'boss-warn-lock');
  assert.equal(Bosses.warnClass({ id: 'quake' }), 'boss-warn-quake');
  assert.equal(Bosses.warnClass({ id: 'crystalid' }), 'boss-warn-shards');
  assert.equal(Bosses.warnClass({ id: 'void' }), 'boss-warn-void');
  assert.equal(Bosses.warnClass({ id: 'puppeteer' }), 'boss-warn-thread');
});

test('BP-1: el telegraph aplica clase de celda o marco de tablero segun ataque', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    let e = Bosses.startEncounter('meteor');
    assert.ok(e);
    e.atkAcc = e.attackEvery - Bosses.TELEGRAPH_MS;
    Bosses.tick(1);
    assert.ok(Render.cells.some((c) => c.classList.contains('boss-warn-meteor')), 'meteoro usa tell rojo propio');
    Render.cells.forEach((c) => c.classList.remove('boss-warn-meteor'));
    Bosses.abort();

    fillIcons(30);
    e = Bosses.startEncounter('puppeteer');
    assert.ok(e);
    e.atkAcc = e.attackEvery - Bosses.TELEGRAPH_MS;
    Bosses.tick(1);
    assert.ok(document.querySelector('.board-wrap').classList.contains('boss-warn-board'), 'ataques sin celdas marcan el tablero');
  } finally {
    const wrap = document.querySelector('.board-wrap');
    if (wrap) wrap.classList.remove('boss-warn-board');
    cleanup();
  }
});

test('BP-3: la cola de beats ejecuta en orden y se puede vaciar por canal', () => {
  freshRun(1);
  try {
    const seq = [];
    const now = globalThis.performance.now();
    Survival._scheduleBeat('toast', 40, () => seq.push('late'));
    Survival._scheduleBeat('reward', 10, () => seq.push('early'));
    Survival._pumpBeats(now + 20);
    assert.deepEqual(seq, ['early']);
    Survival._clearBeats('toast');
    Survival._pumpBeats(now + 80);
    assert.deepEqual(seq, ['early'], 'el beat vaciado no se ejecuta');
  } finally { cleanup(); }
});

test('JF-β: la derrota reemplaza el beat «SUPERADO» por «DERROTADO» una sola vez', () => {
  freshRun(6);
  try {
    State.status = 'playing'; Survival.lives = 3;
    Survival._bossesSurvived = 0; Survival._livesLostThisWave = 0;
    Survival._encounterEnd({ id: 'frost', lvl: 1, flawless: true }, 'defeat');
    assert.ok(Survival._defeatBeat, 'beat de derrota pendiente');
    Survival._bossSurvived();
    assert.equal(Survival._defeatBeat, null, 'beat consumido');
    assert.equal(Survival._bossesSurvived, 1, 'la derrota también cuenta como superado');
    // El siguiente beat (retirada normal) ya no es de derrota.
    Survival._encounterEnd({ id: 'frost', lvl: 1, flawless: false }, 'retreat');
    assert.equal(Survival._defeatBeat, null);
  } finally { cleanup(); }
});

test('JF-ε: el Acto III entra en el pool desde la oleada 24', () => {
  freshRun(25);
  try {
    Bosses.ENCOUNTERS = true;
    Survival._lastBossType = null;
    const seen = new Set();
    const origR = RNG.random; RNG.random = () => 0.2 + 0.79 * Math.random();
    try { for (let k = 0; k < 300; k++) seen.add(Bosses.pick(26)); } finally { RNG.random = origR; }
    assert.ok(seen.has('crystalid') && seen.has('void') && seen.has('puppeteer'), 'la Corte Profunda aparece en Acto III');
    withRng(0.99, () => {
      for (let k = 0; k < 30; k++) assert.ok(!['crystalid', 'void', 'puppeteer'].includes(Bosses.pick(6)), 'Acto III no baja al Acto I');
    });
  } finally { cleanup(); }
});

test('JF-ε: el Cristálido rebrota en fase 2 (regen por tempo)', () => {
  freshRun(26);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(28);
    const e = Bosses.startEncounter('crystalid');
    assert.ok(e && e.anchorsMax === 4);
    // Dos golpes → fase 2 con 2 anclas perdidas.
    const idx = Bosses._anchorIdx();
    Bosses.onAnchorHit(idx[0]); State.tiles[idx[0]] = null;
    Bosses.onAnchorHit(idx[1]); State.tiles[idx[1]] = null;
    assert.equal(e.phase, 2);
    assert.equal(e.anchorsLeft, 2);
    // El rebrote devuelve un ancla pasado regenMs.
    Bosses.tick(12100);
    assert.equal(e.anchorsLeft, 3, 'regeneró 1 ancla');
    assert.equal(Bosses._anchorIdx().length, 3, 'el ancla nueva está en el tablero');
  } finally { cleanup(); }
});

test('JF-ε: el Vacío devora con conteo consistente, crece en fase 2 y lo devuelve al caer', () => {
  freshRun(26);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(30);
    const e = Bosses.startEncounter('void');
    assert.ok(e && e.anchorsMax === 2);
    const count0 = State.iconCount;
    e.targets = Bosses._pickTargets(e);
    Bosses._attack(e);
    assert.ok(e.devoured.length >= 1, 'devoró al menos 1');
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'conteo consistente tras devorar');
    assert.equal(State.iconCount, count0 - e.devoured.length);
    // Fase 2: crece.
    e.phase = 2;
    const max0 = e.anchorsMax;
    e.targets = Bosses._pickTargets(e);
    Bosses._attack(e);
    assert.ok(e.anchorsMax >= max0, 'en fase 2 puede crecer (cap 4)');
    assert.ok(e.anchorsMax <= 4);
    // Derrota: devuelve TODO lo devorado.
    const devoured = e.devoured.length;
    const before = State.iconCount;
    Bosses._anchorIdx().forEach((i) => { Bosses.onAnchorHit(i); State.tiles[i] = null; });
    assert.equal(Bosses.enc, null);
    assert.equal(State.iconCount, before + devoured, 'el Vacío colapsa y lo devuelve todo');
  } finally { cleanup(); }
});

test('JF-ε: el Titiritero enhebra tipos, converger uno LE CURA y al caer corta los hilos', () => {
  freshRun(26);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(30);
    const e = Bosses.startEncounter('puppeteer');
    assert.ok(e);
    e.targets = null;
    Bosses._attack(e); // enhebra
    assert.ok(e.threads && e.threads.length === 2, 'dos tipos enhebrados');
    assert.ok(Bosses.isThreaded(e.threads[0]) && Bosses.isThreaded(e.threads[1]));
    // Converger un tipo enhebrado cura (si le falta vida).
    const idx = Bosses._anchorIdx().find((i) => !State.tiles[i].hits); // ancla expuesta
    Bosses.onAnchorHit(idx); State.tiles[idx] = null;
    const left0 = e.anchorsLeft;
    const cellOfThread = State.board.findIndex((v, i) => v === e.threads[0] && !State.tiles[i]);
    assert.ok(cellOfThread >= 0);
    Bosses.onThreadedConverge([cellOfThread]);
    assert.equal(e.anchorsLeft, left0 + 1, 'converger el hilo lo cura 1 ancla');
    // Derrota: hilos fuera.
    Bosses._anchorIdx().forEach((i) => { Bosses.onAnchorHit(i); State.tiles[i] = null; });
    assert.equal(Bosses.enc, null);
    assert.equal(Bosses.isThreaded('x'), false);
    assert.equal(State.board.filter((v) => v !== null).length, State.iconCount, 'conteo consistente tras cortar hilos');
  } finally { cleanup(); }
});

test('JF-ε: bestiario vitalicio y hazañas de caza (cazador, ronda_maestra, domaecos)', () => {
  freshRun(6);
  try {
    const s = cv.Meta.survData();
    s.bossDex = {}; s.masterRounds = 0; s.feats = {};
    State.status = 'playing'; Survival.lives = 2;
    // seen al arrancar encuentro.
    Bosses.ENCOUNTERS = true; fillIcons(20);
    Bosses.startEncounter('frost');
    assert.equal(cv.Meta.survBossDex().frost.seen, 1);
    Bosses.abort();
    // Kills de los 5 Señores → cazador.
    ['meteor', 'tide', 'frost', 'lockdown'].forEach((id) => cv.Meta.survBossKill(id, 1, false));
    Survival._encounterEnd({ id: 'quake', lvl: 2, flawless: false, eco: false }, 'defeat');
    Survival._bossSurvived();
    assert.equal(cv.Meta.survFeatDone('cazador'), true, 'cazador al derrotar a los 5');
    // 3 Rondas maestras → ronda_maestra (2 previas + 1 flawless ahora).
    s.masterRounds = 2;
    Survival._encounterEnd({ id: 'frost', lvl: 1, flawless: true, eco: false }, 'defeat');
    Survival.lives = 2; Survival._bossSurvived();
    assert.equal(cv.Meta.survMasterRounds(), 3);
    assert.equal(cv.Meta.survFeatDone('ronda_maestra'), true);
    // Eco de nivel III → domaecos.
    Survival._encounterEnd({ id: 'meteor', lvl: 3, flawless: false, eco: true }, 'defeat');
    Survival._bossSurvived();
    assert.equal(cv.Meta.survFeatDone('domaecos'), true);
    assert.ok(cv.Meta.survBossKillsTotal() >= 7, 'el bestiario acumula kills');
    s.bossDex = {}; s.masterRounds = 0; s.feats = {};
  } finally { cleanup(); }
});

test('JF-α: la re-encarnación repone el icono de un ancla vaciada por vías indirectas', () => {
  freshRun(6);
  try {
    Bosses.ENCOUNTERS = true;
    fillIcons(20);
    const e = Bosses.startEncounter('meteor');
    assert.ok(e);
    const idx = Bosses._anchorIdx()[0];
    State.board[idx] = null; State.iconCount--; // p. ej. el imán se llevó el icono
    Bosses.tick(950); // supera la cadencia de re-encarnación
    assert.notEqual(State.board[idx], null, 'el ancla recupera icono (nunca invulnerable)');
  } finally { cleanup(); }
});

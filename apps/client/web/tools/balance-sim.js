#!/usr/bin/env node
/* Simulador de balance headless (GM-30, ver docs/GAME_MODES_MASTER_PLAN.md §10).
 *
 * Carga game.js REAL sobre el stub de DOM de tests con un RELOJ VIRTUAL
 * (performance.now parcheado) y conduce el Loop del juego tick a tick, con un
 * bot parametrizable (política, tiempo de reacción, tasa de error) que juega
 * partidas seedeadas. Mismo seed + mismo perfil ⇒ misma partida, siempre:
 * el gameplay entero tira de RNG (mulberry32 seedeado) y del reloj virtual.
 *
 * Uso:
 *   node tools/balance-sim.js                       # batería estándar (baseline)
 *   node tools/balance-sim.js --runs 60             # más runs por configuración
 *   node tools/balance-sim.js --modes contrarreloj  # solo un modo
 *   node tools/balance-sim.js --json out.json       # además, volcado JSON
 *
 * Límites honestos (documentados): el bot no siente — valida rangos y
 * regresiones, no diversión. Los setTimeout reales del juego (p. ej. el
 * asentamiento del terremoto) disparan en tiempo real, no virtual: sus efectos
 * se aplican igualmente porque el estado se comprueba al disparar.
 */
'use strict';

/* ---------- Reloj virtual: DEBE instalarse antes de cargar el juego ---------- */
const VCLOCK = { t: 0 };
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => VCLOCK.t },
  configurable: true, writable: true,
});

require('../tests/dom-stub.js');
require('../game.js');

const cv = globalThis.window.__cv;
if (!cv) throw new Error('game.js no expuso window.__cv (¿location.search sin ?dev en el stub?)');

/* Arranque mínimo (init() del juego no corre en Node: DOMContentLoaded nunca dispara). */
cv.Render.buildBoard();
if (typeof cv.FX.init === 'function') cv.FX.init();
/* FX y Sound son visual/audio puro (cero reglas): se anulan por velocidad y robustez. */
for (const k of Object.keys(cv.FX)) if (typeof cv.FX[k] === 'function') cv.FX[k] = () => {};
for (const k of Object.keys(cv.Sound)) if (typeof cv.Sound[k] === 'function') cv.Sound[k] = () => {};
/* Aventura: las intros de capítulo pausan esperando un tap que en Node no llega. */
for (let c = 0; c < 120; c++) cv.Meta.markAdvChapterSeen(c);
/* Mutador semanal de Supervivencia (GM-22): fijar 'none' para que la batería sea
 * reproducible en cualquier semana del calendario. */
cv.Survival._mutOverride = 'none';

/* ---------- PRNG propio del bot (independiente del RNG del juego) ---------- */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Perfiles de bot (modelan niveles de habilidad) ----------
 * lapse = lapsos de atención (prob. por acción de "quedarse mirando" ~ms):
 * es lo que rompe combos y mata partidas en humanos; sin lapsos, cualquier
 * bot consistente es inmortal en Contrarreloj/Supervivencia (hallazgo del
 * primer baseline: la dificultad de esos modos es cognitiva, no mecánica). */
const PROFILES = {
  //           reacción(ms)  política   errores        lapsos                      caza de anclas (JF-04, B-J2)
  skilled: { reaction: 550, policy: 'greedy', errorRate: 0.03, lapse: { p: 0.04, ms: 2200 }, bossAware: 0.7 },
  average: { reaction: 900, policy: 'greedy', errorRate: 0.08, lapse: { p: 0.10, ms: 2800 }, bossAware: 0.35 },
  casual:  { reaction: 1400, policy: 'random', errorRate: 0.15, lapse: { p: 0.18, ms: 3400 }, bossAware: 0.1 },
};

/* ---------- Bot ---------- */
function listPlays() {
  const { State, Engine } = cv;
  const plays = [];
  for (let i = 0; i < State.board.length; i++) {
    if (State.board[i] !== null || State.tiles[i]) continue;
    const n = Engine.converging(i).length;
    if (n >= 2) plays.push([i, n]);
  }
  return plays;
}
function listBadTaps() {
  const { State, Engine } = cv;
  const bad = [];
  for (let i = 0; i < State.board.length; i++) {
    if (State.board[i] !== null || State.tiles[i]) continue;
    if (Engine.converging(i).length < 2) bad.push(i);
  }
  return bad;
}
function botAct(profile, rng, stats) {
  const { State } = cv;
  const plays = listPlays();
  stats.polls++;
  if (!plays.length) {
    stats.noMove++;
    // Sin convergencia posible: liberar un tile rompible si lo hay (hielo/cadenas/
    // telaraña) — imprescindible para poder vaciar tableros de Clásico/biomas.
    for (let i = 0; i < State.tiles.length; i++) {
      const t = State.tiles[i];
      if (t && t.breakable) { cv.Game.activate(i); return; }
    }
    return;
  }
  // Error humano: con prob. errorRate toca una casilla que no converge.
  if (rng() < profile.errorRate) {
    const bad = listBadTaps();
    if (bad.length) { cv.Game.activate(bad[(rng() * bad.length) | 0]); return; }
  }
  // Bot boss-aware (JF-04, B-J2): con un encuentro activo, prioriza con prob.
  // `bossAware` las jugadas que golpean un ancla del jefe (converger un icono que
  // vive sobre un tile `boss` expuesto). Sin esto el sim no ve el sistema de jefes.
  if (cv.Bosses && cv.Bosses.enc && profile.bossAware && rng() < profile.bossAware) {
    const { State } = cv;
    let bestA = null;
    for (const p of plays) {
      const hits = cv.Engine.converging(p[0]).some((j) => { const t = State.tiles[j]; return t && t.type === 'boss'; });
      if (hits && (!bestA || p[1] > bestA[1])) bestA = p;
    }
    if (bestA) { cv.Game.activate(bestA[0]); return; }
  }
  let pick;
  if (profile.policy === 'random') pick = plays[(rng() * plays.length) | 0][0];
  else { // greedy: la convergencia que más iconos elimina
    let best = plays[0];
    for (const p of plays) if (p[1] > best[1]) best = p;
    pick = best[0];
  }
  cv.Game.activate(pick);
}

/* ---------- Una partida ---------- */
const STEP = 100; // ms por tick (el dt del Loop clampa a 100)
function runOne(cfg) {
  const { Game, State, Loop, Survival } = cv;
  const profile = PROFILES[cfg.profile];
  const rng = mulberry32((cfg.seed ^ 0x9e3779b9) >>> 0);
  VCLOCK.t = 0;

  if (cfg.mode === 'clasico') { State.world = cfg.world || 'bosque'; State.worldLevel = cfg.level || 1; }
  Game.start(cfg.mode, cfg.diff || 'normal', cfg.mode === 'clasico' ? (cfg.level || 1) : undefined, cfg.seed);
  if (cfg.mode === 'aventura') { // aislar runs: advMax crece entre runs del mismo proceso
    if (cv.Picker.pending) cv.Picker.cancel(); // ruta ofrecida para el nivel de reanudación: descartar
    State.status = 'playing'; State.level = cfg.level || 1;
    cv.Adventure.resetRun();
    Game.setupLevel();
    cv.Adventure.maybeOfferRoute(State.level); // el bot elegirá en el bucle
  }

  const stats = { polls: 0, noMove: 0 };
  const maxMs = (cfg.maxMinutes || 6) * 60000;
  let nextActAt = profile.reaction;
  let sessionScore = 0, levelsCleared = 0;

  while (VCLOCK.t < maxMs) {
    VCLOCK.t += STEP;
    Loop.tick(VCLOCK.t);
    if (State.status === 'levelComplete') { // Clásico/Aventura: encadenar niveles
      sessionScore += cv.State.score;
      levelsCleared++;
      if (cfg.mode === 'clasico' && (State.worldLevel || 1) >= 50) break;
      Game.nextLevel();
      continue;
    }
    if (State.status === 'paused') {
      // Elecciones en partida (GM-γ): el bot rechaza gastos (continuar con gemas,
      // ofertas con cancelar) y toma la PRIMERA opción en bendiciones/rutas/reliquias.
      const pk = cv.Picker && cv.Picker.pending;
      if (pk) {
        if (pk.onCancel) cv.Picker.cancel();
        else if (pk.options && pk.options.length) cv.Picker.pick(pk.options[0].id);
        else cv.Picker.cancel();
        continue;
      }
      // Supervivencia: modal de revivir → el bot no paga
      if (cfg.mode === 'supervivencia') { Survival.giveUp(); }
      else break;
    }
    if (State.status !== 'playing') break;
    if (VCLOCK.t >= nextActAt) {
      // Lapso de atención: el bot "se queda mirando" (rompe combos, drena el reloj).
      if (profile.lapse && rng() < profile.lapse.p) nextActAt += profile.lapse.ms * (0.6 + 0.8 * rng());
      else { nextActAt += profile.reaction; botAct(profile, rng, stats); }
    }
  }
  const timedOut = State.status === 'playing'; // Zen o bot "inmortal": corte por tiempo

  return {
    score: (cfg.mode === 'clasico' ? sessionScore : 0) + State.score,
    elapsed: State.elapsed,
    maxCombo: State.maxCombo,
    mistakes: State.mistakes,
    fever: State.feverEver,
    progress: cfg.mode === 'supervivencia' ? Survival.wave : (cfg.mode === 'clasico' ? levelsCleared : State.level),
    // Encuentros de jefe (JF-γ): visibles para las puertas B-J1/B-J2 (no se imprimen
    // en la tabla; los consume el análisis de gates y el JSON).
    kills: cfg.mode === 'supervivencia' ? (Survival._bossesDefeated || 0) : 0,
    encounters: cfg.mode === 'supervivencia' ? (Survival._bossesSurvived || 0) : 0,
    minis: cfg.mode === 'supervivencia' ? (Survival._minisSeen || 0) : 0,
    miniKills: cfg.mode === 'supervivencia' ? (Survival._minisKilled || 0) : 0,
    deadAir: stats.polls ? stats.noMove / stats.polls : 0,
    coins: State.coinsRun + ((Game.metaResult && Game.metaResult.coinsGained) || 0),
    timedOut,
  };
}

/* ---------- Batería ---------- */
function pct(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; }
function agg(rows, key) {
  const v = rows.map((r) => +r[key]).sort((a, b) => a - b);
  return { p50: pct(v, 0.5), p90: pct(v, 0.9), avg: v.reduce((a, b) => a + b, 0) / v.length };
}

function runBatch(cfg, runs) {
  const rows = [];
  for (let i = 0; i < runs; i++) rows.push(runOne(Object.assign({ seed: (cfg.seedBase || 1000) + i * 7919 }, cfg)));
  const timedOut = rows.filter((r) => r.timedOut).length;
  return {
    cfg, runs,
    score: agg(rows, 'score'), elapsed: agg(rows, 'elapsed'), maxCombo: agg(rows, 'maxCombo'),
    progress: agg(rows, 'progress'),
    deadAir: agg(rows, 'deadAir').avg, mistakes: agg(rows, 'mistakes').avg, coins: agg(rows, 'coins').avg,
    feverRate: rows.filter((r) => r.fever).length / rows.length,
    timedOutRate: timedOut / rows.length,
    rows,
  };
}

/* ---------- Economía de cofres (CH-4/CH-5, aislada de las partidas) ----------
 * Usa las APIs reales de Meta para que tier-ups, multi-tiradas, fallbacks y futuros
 * drops persistentes pasen por exactamente el mismo código que en producción.
 * Cada muestra parte del mismo perfil canónico (sin cosméticos poseídos) y cada
 * fila tipo/nivel recibe un stream RNG propio: cambiar el orden de las filas no
 * cambia sus resultados. El estado Meta, localStorage y Math.random se restauran
 * incluso si una apertura lanza una excepción. */
function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }

function restoreMetaState(snapshot) {
  const state = cv.Meta.state;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, cloneJson(snapshot));
}

function mixChestSeed(seed, type, level) {
  let h = (seed >>> 0) ^ Math.imul(Math.max(1, level | 0), 0x9e3779b1);
  for (let i = 0; i < type.length; i++) {
    h ^= type.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function sumNumericLeaves(value) {
  if (Number.isFinite(value)) return Math.max(0, Number(value));
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, child) => sum + sumNumericLeaves(child), 0);
}

function metaBoosterTotal(state) {
  const candidates = [
    state && state.boosterStock,
    state && state.boosterInventory,
    state && state.boosters,
    state && state.inventory && state.inventory.boosters,
  ];
  return candidates.reduce((sum, candidate) => sum + sumNumericLeaves(candidate), 0);
}

function rewardItems(reward) {
  return reward && Array.isArray(reward.items) && reward.items.length ? reward.items : (reward ? [reward] : []);
}

function rewardBoosterUnits(items) {
  const defs = (cv.Boosters && cv.Boosters.DEFS) || {};
  return items.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const kind = String(item.kind || '').toLowerCase();
    const id = item.id || item.boosterId;
    const isBooster = kind === 'booster' || kind === 'boosters'
      || item.category === 'booster' || (kind === 'item' && id && defs[id]);
    if (!isBooster) return sum;
    const units = Number(item.amount ?? item.count ?? item.quantity ?? 1);
    return sum + (Number.isFinite(units) ? Math.max(0, units) : 1);
  }, 0);
}

function resetChestSample(baseSnapshot, level) {
  restoreMetaState(baseSnapshot);
  const state = cv.Meta.state;
  state.level = Math.max(1, level | 0);
  state.coins = 0;
  state.gems = 0;
  state.tickets = 0;
  state.chests = 0;
  state.chestInventory = [];
  state.chestUnlock = null;
  state.chestReady = [];
  state.chestNotifiedReady = [];
  state.chestSeq = 0;
  // Perfil canónico: evita que el EV dependa del localStorage de quien ejecuta
  // el sim y mantiene disponible el mismo pool cosmético en cada apertura.
  state.cosmetics = { owned: {}, theme: 'default', skin: 'default', fx: 'default' };
  state.boards = { owned: { classic: 1 }, equipped: 'classic' };
  if (state.boosterStock && typeof state.boosterStock === 'object') {
    state.boosterStock = Object.fromEntries(Object.keys(state.boosterStock).map((id) => [id, 0]));
  }
  if (Object.prototype.hasOwnProperty.call(state, 'boosterInventory')) state.boosterInventory = {};
  if (Object.prototype.hasOwnProperty.call(state, 'boosters')) state.boosters = {};
  if (state.inventory && typeof state.inventory === 'object' && Object.prototype.hasOwnProperty.call(state.inventory, 'boosters')) {
    state.inventory = Object.assign({}, state.inventory, { boosters: {} });
  }
}

function normalizeList(value, fallback) {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
  return fallback.slice();
}

function runChestEconomy(options = {}) {
  const runs = Math.max(1, Number(options.runs) | 0 || 40);
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : 0xc0ffee;
  const types = normalizeList(options.types, cv.CHEST_TYPE_ORDER)
    .filter((type, index, all) => cv.CHEST_TYPES[type] && all.indexOf(type) === index);
  const levels = normalizeList(options.levels, [1, 10, 20, 31])
    .map((level) => Math.max(1, Number(level) | 0))
    .filter((level, index, all) => Number.isFinite(level) && all.indexOf(level) === index);
  if (!types.length) throw new Error('runChestEconomy: ningún tipo de cofre válido');
  if (!levels.length) throw new Error('runChestEconomy: ningún nivel válido');

  const originalRandom = Math.random;
  const originalMeta = cloneJson(cv.Meta.state);
  const storage = typeof localStorage !== 'undefined' ? localStorage : null;
  const originalStoredMeta = storage ? storage.getItem('cv_meta') : null;
  const rows = [];

  try {
    for (const type of types) {
      for (const level of levels) {
        Math.random = mulberry32(mixChestSeed(seed, type, level));
        const total = { coins: 0, gems: 0, tickets: 0, boosters: 0, prizes: 0, tierUps: 0 };
        for (let sample = 0; sample < runs; sample++) {
          resetChestSample(originalMeta, level);
          // En producción los cofres event siempre nacen de una fuente semanal
          // real y llevan un snapshot con booster temático garantizado (CH-5).
          if (type === 'event') cv.Meta.addEventChest('balance-sim');
          else cv.Meta.addChest(1, type, 'balance-sim');
          const chest = cv.Meta.chestInventory()[0];
          const before = {
            coins: cv.Meta.coins(), gems: cv.Meta.gems(), tickets: cv.Meta.tickets(),
            boosters: metaBoosterTotal(cv.Meta.state),
          };
          const reward = cv.Meta.openChest(chest && chest.uid);
          if (!reward) throw new Error(`runChestEconomy: openChest devolvió null para ${type} L${level}`);
          const items = rewardItems(reward);
          const afterBoosters = metaBoosterTotal(cv.Meta.state);
          const appliedBoosters = Math.max(0, afterBoosters - before.boosters);
          total.coins += Math.max(0, cv.Meta.coins() - before.coins);
          total.gems += Math.max(0, cv.Meta.gems() - before.gems);
          total.tickets += Math.max(0, cv.Meta.tickets() - before.tickets);
          total.boosters += appliedBoosters || rewardBoosterUnits(items);
          total.prizes += items.length;
          total.tierUps += reward.tierUp ? 1 : 0;
        }
        rows.push({
          type, level, samples: runs,
          ev: {
            coins: total.coins / runs,
            gems: total.gems / runs,
            tickets: total.tickets / runs,
            boosters: total.boosters / runs,
          },
          avgPrizes: total.prizes / runs,
          tierUps: total.tierUps,
          tierUpRate: total.tierUps / runs,
        });
      }
    }
  } finally {
    Math.random = originalRandom;
    restoreMetaState(originalMeta);
    if (storage) {
      if (originalStoredMeta === null) storage.removeItem('cv_meta');
      else storage.setItem('cv_meta', originalStoredMeta);
    }
  }

  return { seed, runs, types, levels, rows };
}

const STANDARD = [];
for (const profile of ['skilled', 'average', 'casual']) {
  STANDARD.push({ mode: 'clasico', diff: 'normal', profile, maxMinutes: 6 });
  STANDARD.push({ mode: 'aventura', diff: 'normal', profile, maxMinutes: 6 });
  STANDARD.push({ mode: 'contrarreloj', diff: 'normal', profile, maxMinutes: 4 });
  STANDARD.push({ mode: 'supervivencia', diff: 'normal', profile, maxMinutes: 8 });
}
STANDARD.push({ mode: 'supervivencia', diff: 'dificil', profile: 'skilled', maxMinutes: 8 });
STANDARD.push({ mode: 'zen', diff: 'normal', profile: 'casual', maxMinutes: 4 });

function fmtRow(r) {
  const c = r.cfg;
  const prog = c.mode === 'supervivencia' ? `oleada ${r.progress.p50}` : c.mode === 'clasico' ? `${r.progress.p50} nvl` : `nvl ${r.progress.p50}`;
  return [
    c.mode.padEnd(13), (c.diff || 'normal').padEnd(8), c.profile.padEnd(8),
    String(r.score.p50).padStart(6), String(r.score.p90).padStart(7),
    String(Math.round(r.elapsed.p50)).padStart(5) + 's',
    ('x' + r.maxCombo.p50).padStart(5),
    prog.padStart(10),
    (r.deadAir * 100).toFixed(0).padStart(6) + '%',
    r.mistakes.toFixed(1).padStart(5),
    String(Math.round(r.coins)).padStart(5),
    (r.timedOutRate * 100).toFixed(0).padStart(4) + '%',
  ].join('  ');
}

function fmtChestValue(value) {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function printChestSummary(report) {
  console.log(`chest-economy · ${report.runs} aperturas/tipo-nivel · seed ${report.seed}`);
  console.log('C/G/T/B = EV monedas/gemas/tickets/boosters · P = premios/cofre · U = tier-ups');
  for (const type of report.types) {
    const cells = report.rows.filter((row) => row.type === type).map((row) => {
      const ev = row.ev;
      return `L${row.level} C${fmtChestValue(ev.coins)} G${fmtChestValue(ev.gems)} T${fmtChestValue(ev.tickets)} B${fmtChestValue(ev.boosters)} P${row.avgPrizes.toFixed(2)} U${(row.tierUpRate * 100).toFixed(1)}%`;
    });
    console.log(type.padEnd(9) + ' ' + cells.join(' | '));
  }
}

/* Exportable para tests (guardarraíl de medallas del reto diario). */
module.exports = { runOne, runBatch, runChestEconomy, PROFILES, cv, VCLOCK };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
  const runs = +opt('runs', 40);
  const modes = opt('modes', '').split(',').filter(Boolean);
  const jsonOut = opt('json', '');
  const chestMode = args.includes('--chests');

  if (chestMode) {
    const types = opt('chest-types', '').split(',').filter(Boolean);
    const levels = opt('chest-levels', '').split(',').filter(Boolean);
    const report = runChestEconomy({
      runs,
      seed: +opt('seed', 0xc0ffee),
      types: types.length ? types : undefined,
      levels: levels.length ? levels : undefined,
    });
    printChestSummary(report);
    if (jsonOut) { require('fs').writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log('\nJSON → ' + jsonOut); }
  } else {
    const configs = STANDARD.filter((c) => !modes.length || modes.includes(c.mode));
    const header = ['modo'.padEnd(13), 'diff'.padEnd(8), 'perfil'.padEnd(8), 'sc p50'.padStart(6), 'sc p90'.padStart(7), 'dur50'.padStart(6), 'combo'.padStart(5), 'progreso'.padStart(10), 'deadAir'.padStart(7), 'err'.padStart(5), 'coins'.padStart(5), 'cap'.padStart(5)].join('  ');
    console.log(`balance-sim · ${runs} runs/config · versión ${(() => { try { return require('fs').readFileSync(__dirname + '/../game.js', 'utf8').match(/VERSION = '([^']+)'/)[1]; } catch (_) { return '?'; } })()}`);
    console.log(header);
    console.log('-'.repeat(header.length));
    const results = [];
    for (const cfg of configs) {
      const r = runBatch(cfg, runs);
      delete r.rows; // el volcado agregado basta
      results.push(r);
      console.log(fmtRow(r));
    }
    if (jsonOut) { require('fs').writeFileSync(jsonOut, JSON.stringify(results, null, 2)); console.log('\nJSON → ' + jsonOut); }
  }
}
